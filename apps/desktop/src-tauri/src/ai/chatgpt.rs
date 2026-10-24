//! Sign in with ChatGPT, using the user's ChatGPT plan for TL;DRs (OpenAI's open-source app
//! integration: developers.openai.com/siwc, "token sharing, open-source app").
//!
//! - **Host id:** `urn:uuid:<v4>`, made once per computer and kept across sign-ins.
//! - **Client id:** the first sign-in registers with `client_id=dynamic_agent_client`; the browser
//!   comes back with the real client id, which is saved and reused (a new registration each time
//!   would give the user a new app with its own usage settings in ChatGPT).
//! - **Flow:** authorization code with PKCE (S256), `state` and `nonce`, back to a listener on
//!   `127.0.0.1` (OpenAI refuses `localhost`), port 1455 when free.
//! - **ID token:** checked for issuer, audience (our client id), expiry and nonce. It comes straight
//!   from the token endpoint over TLS in answer to our own code, so, as OpenID Connect Core 3.1.3.7
//!   allows, its signature isn't checked again here.
//! - **Plan usage** needs the `chatgpt.tokens.use.direct` scope, which the user can untick on the
//!   consent page; without it the sign-in is kept but TL;DRs aren't sent.
//! - **Tokens** live in `chatgpt_auth.json` in the app data folder, never in the webview. Access
//!   tokens last an hour; refresh tokens rotate on every use, so refreshes run one at a time.
//! - **Inference:** `POST https://api.openai.com/v1/responses` with `store: false`, `stream: true`
//!   and `instructions`; the answer counts only after `response.completed`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tiny_http::{Response, Server};

use super::{read_json, write_json, AiError, ModelInfo, USER_AGENT};
use crate::commands::auth::{escape_html, page, parse_query_param};

const AUTH_FILE: &str = "chatgpt_auth.json";
const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const REVOKE_URL: &str = "https://auth.openai.com/api/accounts/oauth/revoke";
const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const DYNAMIC_CLIENT: &str = "dynamic_agent_client";
const AGENT_NAME: &str = "Sourcefold";
const SCOPES: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const PREFERRED_PORT: u16 = 1455;
const CALLBACK_PATH: &str = "/auth/callback";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
pub const USAGE_URL: &str = "https://chatgpt.com/settings/usage";

/// Refresh errors after which the refresh token can never work again.
const TERMINAL_REFRESH_ERRORS: [&str; 7] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
struct StoredAuth {
    #[serde(default)]
    host_id: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    tokens: Option<Tokens>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Tokens {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds.
    expires_at: i64,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    plan_usage: bool,
}

fn load() -> StoredAuth {
    read_json(AUTH_FILE).unwrap_or_default()
}

fn save(auth: &StoredAuth) -> Result<(), AiError> {
    write_json(AUTH_FILE, auth).map_err(AiError::other)
}

/// The signed-in account, as the webview may see it.
pub struct Account {
    pub email: Option<String>,
    pub plan_usage: bool,
}

pub fn account() -> Option<Account> {
    load().tokens.map(|t| Account { email: t.email, plan_usage: t.plan_usage })
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// `n` random bytes from the operating system (through v4 UUIDs, as agent.rs does), base64url.
fn random_b64(n: usize) -> String {
    let mut bytes = Vec::with_capacity(n + 16);
    while bytes.len() < n {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    bytes.truncate(n);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn ensure_host_id(auth: &mut StoredAuth) -> String {
    if let Some(id) = auth.host_id.as_ref().filter(|id| id.starts_with("urn:uuid:")) {
        return id.clone();
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    auth.host_id = Some(id.clone());
    id
}

pub struct AuthorizeRequest<'a> {
    pub client_id: Option<&'a str>,
    pub host_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub code_challenge: &'a str,
}

pub fn authorize_url(req: &AuthorizeRequest) -> String {
    let mut params: Vec<(&str, &str)> = vec![("client_id", req.client_id.unwrap_or(DYNAMIC_CLIENT))];
    if req.client_id.is_none() {
        params.push(("agent_name_hint", AGENT_NAME));
    }
    params.extend([
        ("ext_agent_host_id", req.host_id),
        ("response_type", "code"),
        ("redirect_uri", req.redirect_uri),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", req.state),
        ("nonce", req.nonce),
        ("code_challenge", req.code_challenge),
        ("code_challenge_method", "S256"),
    ]);
    reqwest::Url::parse_with_params(AUTHORIZE_URL, &params)
        .map(|u| u.to_string())
        .unwrap_or_else(|_| AUTHORIZE_URL.to_string())
}

// -----------------------------------------------------------------------------
// ID token
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct IdClaims {
    pub email: Option<String>,
    pub scopes: Vec<String>,
}

/// Checks the ID token's claims (see the module comment for why not its signature).
pub fn check_id_token(token: &str, client_id: &str, nonce: &str, now: i64) -> Result<IdClaims, String> {
    let payload = token.split('.').nth(1).ok_or("The sign-in answer had no ID token.")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| "The ID token couldn't be read.")?;
    let claims: Value = serde_json::from_slice(&bytes).map_err(|_| "The ID token couldn't be read.")?;

    if claims.get("iss").and_then(Value::as_str) != Some(ISSUER) {
        return Err("The ID token came from the wrong issuer.".into());
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(a)) => a == client_id,
        Some(Value::Array(list)) => list.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        return Err("The ID token is for another app.".into());
    }
    if claims.get("nonce").and_then(Value::as_str) != Some(nonce) {
        return Err("The sign-in answer didn't match this sign-in. Try again.".into());
    }
    let exp = claims.get("exp").and_then(Value::as_i64).unwrap_or(0);
    if exp + 300 < now {
        return Err("The ID token has expired. Try again.".into());
    }
    let mut scopes: Vec<String> = Vec::new();
    for key in ["scope", "scp", "scopes"] {
        match claims.get(key) {
            Some(Value::String(s)) => scopes.extend(s.split_whitespace().map(String::from)),
            Some(Value::Array(list)) => scopes.extend(list.iter().filter_map(|v| v.as_str().map(String::from))),
            _ => {}
        }
    }
    Ok(IdClaims {
        email: claims.get("email").and_then(Value::as_str).map(String::from),
        scopes,
    })
}

// -----------------------------------------------------------------------------
// Sign-in
// -----------------------------------------------------------------------------

static ACTIVE_SERVER: Mutex<Option<Arc<Server>>> = Mutex::new(None);

fn take_active() -> Option<Arc<Server>> {
    ACTIVE_SERVER.lock().unwrap_or_else(|p| p.into_inner()).take()
}

/// Stops a sign-in that is waiting for the browser.
pub fn cancel_sign_in() {
    if let Some(server) = take_active() {
        server.unblock();
    }
}

struct Callback {
    code: String,
    state: String,
    client_id: Option<String>,
}

fn bind_listener() -> Result<(Server, u16), AiError> {
    let server = Server::http(("127.0.0.1", PREFERRED_PORT))
        .or_else(|_| Server::http("127.0.0.1:0"))
        .map_err(|e| AiError::other(format!("Couldn't start the sign-in listener: {}", e)))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| AiError::other("Couldn't start the sign-in listener."))?;
    Ok((server, port))
}

fn wait_for_callback(server: Arc<Server>) -> Result<Callback, AiError> {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(AiError::new("cancelled", "Sign-in timed out. Try again."));
        }
        match server.recv_timeout((deadline - now).min(Duration::from_millis(500))) {
            Ok(Some(request)) => {
                let url = request.url().to_string();
                let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
                if path != CALLBACK_PATH {
                    let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
                    continue;
                }
                if let (Some(code), Some(state)) = (
                    parse_query_param(query, "code").filter(|c| !c.trim().is_empty()),
                    parse_query_param(query, "state"),
                ) {
                    let _ = request.respond(page(
                        "Signed in to ChatGPT",
                        "You can close this tab and go back to Sourcefold.",
                        true,
                        200,
                    ));
                    return Ok(Callback {
                        code: code.trim().to_string(),
                        state,
                        client_id: parse_query_param(query, "client_id").filter(|c| !c.trim().is_empty()),
                    });
                }
                let error = parse_query_param(query, "error").unwrap_or_default();
                let message = parse_query_param(query, "error_description")
                    .filter(|m| !m.trim().is_empty())
                    .unwrap_or_else(|| "The sign-in didn't finish.".to_string());
                let _ = request.respond(page(
                    "Sign-in failed",
                    &format!("{} You can close this tab.", escape_html(&message)),
                    false,
                    400,
                ));
                let code = if error == "access_denied" { "cancelled" } else { "auth" };
                return Err(AiError::new(code, message));
            }
            Ok(None) => {
                let still_active = ACTIVE_SERVER
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .as_ref()
                    .map(|s| Arc::ptr_eq(s, &server))
                    .unwrap_or(false);
                if !still_active {
                    return Err(AiError::new("cancelled", "Sign-in cancelled"));
                }
            }
            Err(_) => return Err(AiError::new("cancelled", "Sign-in cancelled")),
        }
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
}

fn http_client() -> Result<reqwest::Client, AiError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(AiError::network)
}

/// `{ error, error_description }` from the auth server.
fn oauth_error(body: &str) -> (String, String) {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = value
        .get("error")
        .and_then(|e| e.as_str().map(String::from).or_else(|| e.get("code").and_then(Value::as_str).map(String::from)))
        .unwrap_or_default();
    let description = value
        .get("error_description")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/error/message").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    (error, description)
}

async fn post_token(form: &[(&str, &str)]) -> Result<Result<TokenResponse, (u16, String)>, AiError> {
    let res = http_client()?.post(TOKEN_URL).form(form).send().await.map_err(AiError::network)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(AiError::network)?;
    if !(200..300).contains(&status) {
        return Ok(Err((status, text)));
    }
    serde_json::from_str::<TokenResponse>(&text)
        .map(Ok)
        .map_err(|_| AiError::other("ChatGPT's sign-in answer couldn't be read."))
}

/// Opens the browser at ChatGPT's sign-in, waits for it to come back, and keeps the tokens.
pub async fn sign_in(open: impl FnOnce(&str) -> Result<(), String>) -> Result<(), AiError> {
    cancel_sign_in();

    let mut auth = load();
    let host_id = ensure_host_id(&mut auth);
    save(&auth)?;

    let (server, port) = bind_listener()?;
    let server = Arc::new(server);
    *ACTIVE_SERVER.lock().unwrap_or_else(|p| p.into_inner()) = Some(server.clone());

    let redirect_uri = format!("http://127.0.0.1:{}{}", port, CALLBACK_PATH);
    let state = random_b64(32);
    let nonce = random_b64(32);
    let verifier = random_b64(48);
    let url = authorize_url(&AuthorizeRequest {
        client_id: auth.client_id.as_deref(),
        host_id: &host_id,
        redirect_uri: &redirect_uri,
        state: &state,
        nonce: &nonce,
        code_challenge: &pkce_challenge(&verifier),
    });
    if let Err(e) = open(&url) {
        cancel_sign_in();
        return Err(AiError::other(format!("Couldn't open the browser: {}", e)));
    }

    let waiting = server.clone();
    let callback = tokio::task::spawn_blocking(move || wait_for_callback(waiting))
        .await
        .map_err(|e| AiError::other(e.to_string()))?;
    {
        let mut active = ACTIVE_SERVER.lock().unwrap_or_else(|p| p.into_inner());
        if active.as_ref().map(|s| Arc::ptr_eq(s, &server)).unwrap_or(false) {
            *active = None;
        }
    }
    let callback = callback?;

    if callback.state != state {
        return Err(AiError::new("auth", "The sign-in answer didn't match this sign-in. Try again."));
    }
    let client_id = callback
        .client_id
        .or(auth.client_id.clone())
        .ok_or_else(|| AiError::new("auth", "ChatGPT didn't register Sourcefold. Try again."))?;

    let exchanged = post_token(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &callback.code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect_uri),
        ("resource", RESOURCE),
    ])
    .await?;
    let tokens = match exchanged {
        Ok(t) => t,
        Err((_, body)) => {
            let (error, description) = oauth_error(&body);
            let detail = if description.is_empty() { error } else { description };
            return Err(AiError::new("auth", format!("ChatGPT refused the sign-in. {}", detail).trim().to_string()));
        }
    };

    let id_token = tokens.id_token.as_deref().ok_or_else(|| AiError::new("auth", "The sign-in answer had no ID token."))?;
    let claims = check_id_token(id_token, &client_id, &nonce, now()).map_err(|m| AiError::new("auth", m))?;
    let granted: Vec<&str> = tokens.scope.as_deref().unwrap_or("").split_whitespace().collect();
    let plan_usage = granted.contains(&PLAN_SCOPE) || claims.scopes.iter().any(|s| s == PLAN_SCOPE);

    let mut auth = load();
    auth.host_id = Some(host_id);
    auth.client_id = Some(client_id);
    auth.tokens = Some(Tokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: now() + tokens.expires_in.unwrap_or(3600),
        email: claims.email,
        plan_usage,
    });
    save(&auth)?;
    super::adopt_provider_if_unset(super::Provider::Chatgpt).map_err(AiError::other)?;
    Ok(())
}

/// Forgets the tokens (and tells OpenAI, best effort). The host id and client id stay, so signing
/// in again reuses the same app registration and its usage settings.
pub async fn sign_out() -> Result<(), AiError> {
    let mut auth = load();
    if let (Some(tokens), Some(client_id)) = (auth.tokens.as_ref(), auth.client_id.as_deref()) {
        let token = tokens.refresh_token.clone().unwrap_or_else(|| tokens.access_token.clone());
        if let Ok(client) = http_client() {
            let _ = client
                .post(REVOKE_URL)
                .form(&[("token", token.as_str()), ("client_id", client_id)])
                .timeout(Duration::from_secs(10))
                .send()
                .await;
        }
    }
    auth.tokens = None;
    save(&auth)
}

// -----------------------------------------------------------------------------
// Access tokens
// -----------------------------------------------------------------------------

static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const SIGN_IN_AGAIN: &str = "Your ChatGPT sign-in ended. Sign in again in Settings → TL;DR.";

/// A fresh access token, refreshing it first when it expires within a minute.
async fn access_token() -> Result<String, AiError> {
    let _guard = REFRESH_LOCK.lock().await;
    let mut auth = load();
    let tokens = auth
        .tokens
        .clone()
        .ok_or_else(|| AiError::new("not_configured", "Sign in with ChatGPT in Settings → TL;DR."))?;
    if !tokens.plan_usage {
        return Err(AiError::new(
            "not_eligible",
            "Using your ChatGPT plan wasn't allowed. Sign in again and allow \"Use your ChatGPT plan\".",
        ));
    }
    if tokens.expires_at > now() + 60 {
        return Ok(tokens.access_token);
    }
    let (Some(refresh), Some(client_id)) = (tokens.refresh_token.clone(), auth.client_id.clone()) else {
        auth.tokens = None;
        save(&auth)?;
        return Err(AiError::new("auth", SIGN_IN_AGAIN));
    };
    match post_token(&[
        ("grant_type", "refresh_token"),
        ("client_id", &client_id),
        ("refresh_token", &refresh),
        ("resource", RESOURCE),
    ])
    .await?
    {
        Ok(fresh) => {
            let access = fresh.access_token.clone();
            auth.tokens = Some(Tokens {
                access_token: fresh.access_token,
                refresh_token: fresh.refresh_token.or(Some(refresh)),
                expires_at: now() + fresh.expires_in.unwrap_or(3600),
                email: tokens.email,
                plan_usage: tokens.plan_usage,
            });
            save(&auth)?;
            Ok(access)
        }
        Err((status, body)) => {
            let (error, _) = oauth_error(&body);
            if TERMINAL_REFRESH_ERRORS.contains(&error.as_str()) || status == 401 {
                auth.tokens = None;
                save(&auth)?;
                Err(AiError::new("auth", SIGN_IN_AGAIN))
            } else {
                Err(AiError::new("unavailable", "ChatGPT's sign-in service is having trouble. Try again soon."))
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Models and answers
// -----------------------------------------------------------------------------

/// `{ models: [{ slug, display_name, visibility }] }`, keeping `visibility == "list"` in the
/// server's order; an OpenAI-style `{ data: [{ id }] }` is read too.
pub fn parse_models(body: &Value) -> Vec<ModelInfo> {
    let entry = |id: &str, name: Option<&str>| ModelInfo {
        id: id.to_string(),
        name: name.filter(|n| !n.trim().is_empty()).unwrap_or(id).to_string(),
        free: false,
        price_in: None,
        price_out: None,
        context: None,
    };
    if let Some(models) = body.get("models").and_then(Value::as_array) {
        return models
            .iter()
            .filter(|m| m.get("visibility").and_then(Value::as_str).map(|v| v == "list").unwrap_or(true))
            .filter_map(|m| {
                let slug = m.get("slug").or_else(|| m.get("id"))?.as_str()?;
                Some(entry(slug, m.get("display_name").and_then(Value::as_str)))
            })
            .collect();
    }
    body.get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(|id| entry(id, None)))
                .collect()
        })
        .unwrap_or_default()
}

/// A plan-usage error as something the user can act on (OpenAI's "Errors and recovery").
pub fn plan_error(status: u16, body: &str) -> AiError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let code = value
        .pointer("/error/code")
        .or_else(|| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let message = value
        .pointer("/error/message")
        .or_else(|| value.get("detail"))
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    error_for_code(code, status, &message)
}

fn error_for_code(code: &str, status: u16, message: &str) -> AiError {
    match code {
        "subscription_sharing_usage_limit_exceeded" => {
            AiError::new("limit", "Your ChatGPT usage limit is reached, so TL;DRs are paused.")
        }
        "subscription_sharing_user_not_eligible" => AiError::new(
            "not_eligible",
            "This ChatGPT account can't use its plan in other apps. ChatGPT Plus or Pro is needed.",
        ),
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            AiError::new("unavailable", "ChatGPT can't take requests right now. Try again soon.")
        }
        "subscription_sharing_unsupported_capability" => {
            AiError::bad_request(format!("ChatGPT can't use this model or request. {}", message).trim().to_string())
        }
        "subscription_sharing_invalid_user" => AiError::new("auth", "ChatGPT didn't accept the sign-in. Sign in again in Settings → TL;DR."),
        _ => match status {
            401 => AiError::new("auth", "ChatGPT didn't accept the sign-in. Sign in again in Settings → TL;DR."),
            403 => AiError::new(
                "not_eligible",
                if message.is_empty() { "ChatGPT refused this request.".to_string() } else { format!("ChatGPT refused this request: {}", message) },
            ),
            429 => AiError::new("limit", "Your ChatGPT usage limit is reached, so TL;DRs are paused."),
            500..=599 => AiError::new("unavailable", "ChatGPT can't take requests right now. Try again soon."),
            400 | 404 => AiError::bad_request(if message.is_empty() { "ChatGPT couldn't use this model.".to_string() } else { message.to_string() }),
            _ => AiError::other(if message.is_empty() { format!("ChatGPT answered with status {}.", status) } else { message.to_string() }),
        },
    }
}

pub async fn list_models() -> Result<Vec<ModelInfo>, AiError> {
    let token = access_token().await?;
    let res = http_client()?
        .get(format!("{}/models", RESOURCE))
        .bearer_auth(token)
        .send()
        .await
        .map_err(AiError::network)?;
    let status = res.status().as_u16();
    let text = res.text().await.map_err(AiError::network)?;
    if !(200..300).contains(&status) {
        return Err(plan_error(status, &text));
    }
    let body: Value = serde_json::from_str(&text).map_err(|_| AiError::other("ChatGPT's model list couldn't be read."))?;
    Ok(parse_models(&body))
}

/// Collects a Responses stream. Text from `response.output_text.delta` events; done only on
/// `response.completed` (or `response.incomplete` with some text).
#[derive(Default)]
pub struct StreamReader {
    buffer: String,
    text: String,
    done: bool,
    error: Option<AiError>,
}

impl StreamReader {
    pub fn push(&mut self, chunk: &str) {
        self.buffer.push_str(chunk);
        while let Some(at) = self.buffer.find('\n') {
            let line: String = self.buffer.drain(..=at).collect();
            self.line(line.trim_end_matches(['\r', '\n']));
        }
    }

    fn line(&mut self, line: &str) {
        let Some(data) = line.strip_prefix("data:") else { return };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else { return };
        match event.get("type").and_then(Value::as_str).unwrap_or("") {
            "response.output_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    self.text.push_str(delta);
                }
            }
            "response.completed" | "response.incomplete" => {
                if self.text.trim().is_empty() {
                    self.text = output_text(event.get("response").unwrap_or(&Value::Null));
                }
                self.done = true;
            }
            "response.failed" => {
                let err = event.pointer("/response/error").cloned().unwrap_or(Value::Null);
                self.error = Some(error_for_code(
                    err.get("code").and_then(Value::as_str).unwrap_or(""),
                    500,
                    err.get("message").and_then(Value::as_str).unwrap_or(""),
                ));
            }
            "error" => {
                let err = event.get("error").cloned().unwrap_or(event.clone());
                self.error = Some(error_for_code(
                    err.get("code").and_then(Value::as_str).unwrap_or(""),
                    500,
                    err.get("message").and_then(Value::as_str).unwrap_or(""),
                ));
            }
            _ => {}
        }
    }

    pub fn finish(mut self) -> Result<String, AiError> {
        let rest = std::mem::take(&mut self.buffer);
        if !rest.trim().is_empty() {
            self.line(rest.trim());
        }
        if let Some(err) = self.error {
            return Err(err);
        }
        let text = self.text.trim().to_string();
        if !self.done || text.is_empty() {
            return Err(AiError::new("unavailable", "ChatGPT's answer stopped before it finished. Try again."));
        }
        Ok(text)
    }
}

/// The text parts of a finished response's `output` messages.
fn output_text(response: &Value) -> String {
    response
        .get("output")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("content").and_then(Value::as_array))
                .flatten()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

pub async fn complete(model: &str, instructions: &str, input: &str) -> Result<String, AiError> {
    let token = access_token().await?;
    let body = json!({
        "model": model,
        "instructions": instructions,
        "input": [{ "role": "user", "content": input }],
        "store": false,
        "stream": true,
    });
    let mut res = http_client()?
        .post(format!("{}/responses", RESOURCE))
        .bearer_auth(token)
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(AiError::network)?;
    let status = res.status().as_u16();
    if !(200..300).contains(&status) {
        let text = res.text().await.unwrap_or_default();
        return Err(plan_error(status, &text));
    }
    let mut reader = StreamReader::default();
    let mut pending: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(AiError::network)? {
        pending.extend_from_slice(&chunk);
        // Hand over whole UTF-8 characters only; a chunk can end inside one.
        let valid = match std::str::from_utf8(&pending) {
            Ok(s) => s.len(),
            Err(e) => e.valid_up_to(),
        };
        if valid > 0 {
            let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
            reader.push(&text);
            pending.drain(..valid);
        }
    }
    if !pending.is_empty() {
        reader.push(&String::from_utf8_lossy(&pending));
    }
    reader.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(claims: Value) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
    }

    #[test]
    fn pkce_matches_the_rfc_example() {
        // RFC 7636, appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn authorize_url_registers_once_then_reuses_the_client() {
        let first = authorize_url(&AuthorizeRequest {
            client_id: None,
            host_id: "urn:uuid:1",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "s",
            nonce: "n",
            code_challenge: "c",
        });
        assert!(first.starts_with(AUTHORIZE_URL));
        assert!(first.contains("client_id=dynamic_agent_client"));
        assert!(first.contains("agent_name_hint=Sourcefold"));
        assert!(first.contains("chatgpt.tokens.use.direct"));
        assert!(first.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
        assert!(first.contains("code_challenge_method=S256"));

        let later = authorize_url(&AuthorizeRequest {
            client_id: Some("client_123"),
            host_id: "urn:uuid:1",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "s",
            nonce: "n",
            code_challenge: "c",
        });
        assert!(later.contains("client_id=client_123"));
        assert!(!later.contains("agent_name_hint"));
    }

    #[test]
    fn id_token_checks() {
        let good = json!({ "iss": ISSUER, "aud": "c1", "nonce": "n1", "exp": 2_000, "email": "a@b.c", "scope": "openid chatgpt.tokens.use.direct" });
        let claims = check_id_token(&jwt(good.clone()), "c1", "n1", 1_000).unwrap();
        assert_eq!(claims.email.as_deref(), Some("a@b.c"));
        assert!(claims.scopes.iter().any(|s| s == PLAN_SCOPE));

        let mut aud_list = good.clone();
        aud_list["aud"] = json!(["x", "c1"]);
        assert!(check_id_token(&jwt(aud_list), "c1", "n1", 1_000).is_ok());

        assert!(check_id_token(&jwt(good.clone()), "other", "n1", 1_000).is_err());
        assert!(check_id_token(&jwt(good.clone()), "c1", "wrong", 1_000).is_err());
        assert!(check_id_token(&jwt(good.clone()), "c1", "n1", 10_000).is_err());
        let mut bad_iss = good;
        bad_iss["iss"] = json!("https://evil.example");
        assert!(check_id_token(&jwt(bad_iss), "c1", "n1", 1_000).is_err());
        assert!(check_id_token("not-a-jwt", "c1", "n1", 1_000).is_err());
    }

    #[test]
    fn reads_the_model_list() {
        let body = json!({ "models": [
            { "slug": "gpt-6-luna", "display_name": "GPT-6 Luna", "visibility": "list" },
            { "slug": "hidden", "display_name": "Hidden", "visibility": "hide" },
            { "slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list" },
        ]});
        let models = parse_models(&body);
        assert_eq!(models.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["GPT-6 Luna", "GPT-6.1 Sol"]);
        assert_eq!(parse_models(&json!({ "data": [{ "id": "x" }] }))[0].id, "x");
    }

    #[test]
    fn maps_plan_errors() {
        let limit = plan_error(429, r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"x"}}"#);
        assert_eq!(limit.code, "limit");
        assert_eq!(plan_error(403, r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#).code, "not_eligible");
        assert_eq!(plan_error(503, r#"{"detail":"down"}"#).code, "unavailable");
        assert_eq!(plan_error(400, r#"{"error":{"code":"subscription_sharing_unsupported_capability","param":"temperature"}}"#).code, "bad_request");
        assert_eq!(plan_error(401, "").code, "auth");
    }

    #[test]
    fn reads_a_stream_split_anywhere() {
        let stream = concat!(
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"gist\\\": \"}\n\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"\\\"Turbos é\\\"}\"}\n\n",
            "data: {\"type\":\"response.completed\",\"response\":{}}\n\n",
        );
        for split in [1, 7, 40, stream.len()] {
            let mut reader = StreamReader::default();
            let (a, b) = stream.split_at(split.min(stream.len()));
            reader.push(a);
            reader.push(b);
            assert_eq!(reader.finish().unwrap(), "{\"gist\": \"Turbos é\"}");
        }
    }

    #[test]
    fn a_stream_without_completed_or_with_a_failure_fails() {
        let mut cut = StreamReader::default();
        cut.push("data: {\"type\":\"response.output_text.delta\",\"delta\":\"half\"}\n\n");
        assert_eq!(cut.finish().unwrap_err().code, "unavailable");

        let mut failed = StreamReader::default();
        failed.push("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n");
        assert_eq!(failed.finish().unwrap_err().code, "limit");

        let mut whole = StreamReader::default();
        whole.push("data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"content\":[{\"type\":\"output_text\",\"text\":\"done\"}]}]}}\n");
        assert_eq!(whole.finish().unwrap(), "done");
    }

    #[test]
    fn the_host_id_is_made_once() {
        let mut auth = StoredAuth::default();
        let first = ensure_host_id(&mut auth);
        assert!(first.starts_with("urn:uuid:"));
        assert_eq!(ensure_host_id(&mut auth), first);
    }
}
