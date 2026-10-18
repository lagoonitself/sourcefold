//! The desktop side of the Sourcefold MCP server (docs/dev/handoff-mcp.md, "Desktop bridge").
//!
//! The MCP server runs inside Claude Desktop and reads `agent.json` from the app data folder to find
//! this app. The file holds a key that is new on every start. The loopback server (`server.rs`)
//! hands every `/api/agent/*` request to [`handle`], which answers only when the request has no
//! `Origin` header (agents are not browsers; a web page always sends one) and
//! `Authorization: Bearer <key>` matches the key (compared in constant time).
//!
//! The key opens these routes and nothing else. Replies never carry CORS headers.
//!
//! Everything that needs the running app (events, window focus, the search index, the network) goes
//! through [`AgentHost`], so the routes are tested with a fake host and no Tauri runtime.

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use serde::Deserialize;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Response};

use crate::db::Database;
use crate::search::query::SearchRequest;
use crate::server::{forbidden_response, get_header, json_response};
use crate::session;

pub const AGENT_FILE_NAME: &str = "agent.json";
const ROUTE_PREFIX: &str = "/api/agent/";
const KEY_BYTES: usize = 32;

static AGENT_KEY: OnceLock<String> = OnceLock::new();
static AGENT_FILE_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

// -----------------------------------------------------------------------------
// Key and agent.json
// -----------------------------------------------------------------------------

/// 32 random bytes as 64 lowercase hex characters. Each v4 UUID carries 122 random bits from the
/// operating system; the six fixed bits of each (version and variant) are dropped, and three UUIDs
/// give 42 usable bytes, of which 32 are kept.
pub fn generate_key() -> String {
    let mut bytes: Vec<u8> = Vec::with_capacity(42);
    for _ in 0..3 {
        let uuid = uuid::Uuid::new_v4();
        for (index, byte) in uuid.as_bytes().iter().enumerate() {
            if index != 6 && index != 8 {
                bytes.push(*byte);
            }
        }
    }
    bytes.truncate(KEY_BYTES);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Makes this run's key. Called once, in the app process only (never in the native-messaging one).
pub fn init() -> &'static str {
    AGENT_KEY.get_or_init(generate_key).as_str()
}

pub fn current_key() -> Option<&'static str> {
    AGENT_KEY.get().map(|k| k.as_str())
}

pub fn set_agent_file_override(path: Option<PathBuf>) {
    if let Ok(mut lock) = AGENT_FILE_OVERRIDE.write() {
        *lock = path;
    }
}

pub fn agent_file_path() -> PathBuf {
    if let Ok(lock) = AGENT_FILE_OVERRIDE.read() {
        if let Some(p) = lock.as_ref() {
            return p.clone();
        }
    }
    session::app_data_dir().join(AGENT_FILE_NAME)
}

/// Writes `{ port, key, version }` through a temporary file, so a reader never sees half of it.
/// Unix: the file is created with mode 0600.
pub fn write_agent_file_to(path: &Path, port: u16, key: &str) -> std::io::Result<()> {
    use std::io::Write;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_string_pretty(&json!({
        "port": port,
        "key": key,
        "version": env!("CARGO_PKG_VERSION"),
    }))
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let tmp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&tmp)?;
    file.write_all(data.as_bytes())?;
    file.sync_all()?;
    drop(file);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }

    std::fs::rename(&tmp, path)
}

/// Publishes this run's key and port for the MCP server. Called by the loopback server once it is
/// listening, so a second app instance that couldn't bind the port never replaces the first one's key.
pub fn publish(port: u16) -> Result<(), String> {
    let key = current_key().ok_or_else(|| "The agent key was not made.".to_string())?;
    write_agent_file_to(&agent_file_path(), port, key).map_err(|e| e.to_string())
}

// -----------------------------------------------------------------------------
// The app, as the routes see it
// -----------------------------------------------------------------------------

pub trait AgentHost: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
    /// Unminimizes, shows and focuses the main window.
    fn focus_main_window(&self);
    /// Keyword search in the local index; the JSON of `SearchResponse`.
    fn search(&self, request: &SearchRequest) -> Result<Value, String>;
    /// `substack::fetch`, as the JSON of `FetchResult`.
    fn substack_fetch(&self, url: &str, with_cookie: bool) -> Result<Value, String>;
}

#[derive(Clone)]
pub struct AgentContext {
    pub key: String,
    pub host: Arc<dyn AgentHost>,
}

/// The real host: the running Tauri app.
pub struct TauriHost {
    pub app: tauri::AppHandle,
}

impl AgentHost for TauriHost {
    fn emit(&self, event: &str, payload: Value) {
        use tauri::Emitter;
        let _ = self.app.emit(event, payload);
    }

    fn focus_main_window(&self) {
        use tauri::Manager;
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    fn search(&self, request: &SearchRequest) -> Result<Value, String> {
        let response = crate::search::query::run(crate::search::store::global(), request)?;
        serde_json::to_value(response).map_err(|e| e.to_string())
    }

    fn substack_fetch(&self, url: &str, with_cookie: bool) -> Result<Value, String> {
        let result = tauri::async_runtime::block_on(crate::substack::fetch(url, with_cookie))?;
        serde_json::to_value(result).map_err(|e| e.to_string())
    }
}

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

pub fn is_agent_path(path: &str) -> bool {
    path.starts_with(ROUTE_PREFIX)
}

/// Compares without stopping at the first different byte.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as usize;
    }
    std::hint::black_box(diff) == 0
}

fn bearer_token(headers: &[Header]) -> Option<&str> {
    let value = get_header(headers, "Authorization")?.trim();
    let (scheme, token) = value.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") {
        Some(token.trim())
    } else {
        None
    }
}

fn error_reply(status: u16, message: &str) -> Response<Cursor<Vec<u8>>> {
    json_response(status, json!({ "error": { "message": message } }), None)
}

fn ok_reply() -> Response<Cursor<Vec<u8>>> {
    json_response(200, json!({ "ok": true }), None)
}

fn parse_body<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, Response<Cursor<Vec<u8>>>> {
    serde_json::from_slice(body)
        .map_err(|e| error_reply(400, &format!("The request body isn't valid: {}", e)))
}

#[derive(Deserialize)]
struct SearchBody {
    query: String,
    scope: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Deserialize)]
struct SubstackBody {
    url: String,
    #[serde(default)]
    with_cookie: Option<bool>,
}

fn mode_of(db: &Arc<Mutex<Database>>) -> &'static str {
    let offline = {
        let guard = match db.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        guard
            .get_setting("offline_mode")
            .ok()
            .flatten()
            .map(|v| v == "true")
            .unwrap_or(false)
    };
    if offline {
        "offline"
    } else if session::load_session().is_some() {
        "signed_in"
    } else {
        "signed_out"
    }
}

fn status_reply(db: &Arc<Mutex<Database>>) -> Response<Cursor<Vec<u8>>> {
    let session = session::load_session();
    json_response(
        200,
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "mode": mode_of(db),
            "web_url": session.as_ref().map(|s| s.web_url.clone()),
            "email": session.as_ref().and_then(|s| s.email.clone()),
        }),
        None,
    )
}

fn search_reply(ctx: &AgentContext, body: &[u8]) -> Response<Cursor<Vec<u8>>> {
    let parsed: SearchBody = match parse_body(body) {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    let project_id = parsed.project_id.filter(|id| !id.trim().is_empty());
    match parsed.scope.as_str() {
        "all" => {}
        "project" => {
            if project_id.is_none() {
                return error_reply(400, "project_id is required when scope is \"project\".");
            }
        }
        _ => return error_reply(400, "scope must be \"project\" or \"all\"."),
    }

    // Keywords only: no query vector, so no model either.
    let request = SearchRequest {
        query: parsed.query,
        scope: parsed.scope,
        project_id,
        query_vector: None,
        model: None,
        limit: parsed.limit,
    };
    match ctx.host.search(&request) {
        Ok(value) => json_response(200, value, None),
        Err(message) => error_reply(500, &message),
    }
}

/// Exactly one of `{ group_id }`, `{ source_id }`, `{ source_id, highlight_id }`. The event carries
/// only those keys.
fn show_target(body: &[u8]) -> Result<Value, Response<Cursor<Vec<u8>>>> {
    let value: Value = parse_body(body)?;
    let Some(object) = value.as_object() else {
        return Err(error_reply(400, "The request body must be an object."));
    };
    let text = |key: &str| -> Result<Option<String>, Response<Cursor<Vec<u8>>>> {
        match object.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) if !s.trim().is_empty() => Ok(Some(s.trim().to_string())),
            Some(_) => Err(error_reply(400, &format!("{} must be a non-empty string.", key))),
        }
    };
    let group_id = text("group_id")?;
    let source_id = text("source_id")?;
    let highlight_id = text("highlight_id")?;

    match (group_id, source_id, highlight_id) {
        (Some(group_id), None, None) => Ok(json!({ "group_id": group_id })),
        (None, Some(source_id), None) => Ok(json!({ "source_id": source_id })),
        (None, Some(source_id), Some(highlight_id)) => {
            Ok(json!({ "source_id": source_id, "highlight_id": highlight_id }))
        }
        _ => Err(error_reply(
            400,
            "Send exactly one of group_id, source_id, or source_id with highlight_id.",
        )),
    }
}

fn show_reply(ctx: &AgentContext, body: &[u8]) -> Response<Cursor<Vec<u8>>> {
    let target = match show_target(body) {
        Ok(t) => t,
        Err(resp) => return resp,
    };
    ctx.host.emit("agent-show", target);
    ctx.host.focus_main_window();
    ok_reply()
}

fn changed_reply(ctx: &AgentContext, body: &[u8]) -> Response<Cursor<Vec<u8>>> {
    if !body.iter().all(|b| b.is_ascii_whitespace()) {
        let value: Value = match parse_body(body) {
            Ok(v) => v,
            Err(resp) => return resp,
        };
        if !value.is_object() {
            return error_reply(400, "The request body must be an object.");
        }
    }
    ctx.host.emit("agent-changed", json!({}));
    ok_reply()
}

fn substack_reply(ctx: &AgentContext, body: &[u8]) -> Response<Cursor<Vec<u8>>> {
    let parsed: SubstackBody = match parse_body(body) {
        Ok(p) => p,
        Err(resp) => return resp,
    };
    let url = parsed.url.trim();
    match reqwest::Url::parse(url) {
        Ok(u) if u.scheme() == "http" || u.scheme() == "https" => {}
        _ => return error_reply(400, "url must be a web link."),
    }
    match ctx.host.substack_fetch(url, parsed.with_cookie.unwrap_or(false)) {
        Ok(value) => json_response(200, value, None),
        Err(message) => error_reply(502, &message),
    }
}

/// Answers one `/api/agent/*` request. The caller has already checked the Host header.
pub fn handle(
    ctx: &AgentContext,
    db: &Arc<Mutex<Database>>,
    method: &Method,
    path: &str,
    body: &[u8],
    headers: &[Header],
) -> Response<Cursor<Vec<u8>>> {
    if get_header(headers, "Origin").is_some() {
        return forbidden_response();
    }
    match bearer_token(headers) {
        Some(token) if constant_time_eq(token.as_bytes(), ctx.key.as_bytes()) => {}
        _ => return forbidden_response(),
    }

    let route = path.strip_prefix(ROUTE_PREFIX).unwrap_or("");
    let expected = match route {
        "status" => Method::Get,
        "search" | "show" | "changed" | "substack-fetch" => Method::Post,
        _ => return error_reply(404, "Endpoint not found"),
    };
    if method != &expected {
        return error_reply(405, "Method not allowed");
    }

    match route {
        "status" => status_reply(db),
        "search" => search_reply(ctx, body),
        "show" => show_reply(ctx, body),
        "changed" => changed_reply(ctx, body),
        _ => substack_reply(ctx, body),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// What the fake saw: query, scope, project id, whether a vector or model got through, limit.
    type SeenSearch = (String, String, Option<String>, bool, Option<u32>);

    #[derive(Default)]
    struct FakeHost {
        events: Mutex<Vec<(String, Value)>>,
        focused: Mutex<u32>,
        searches: Mutex<Vec<SeenSearch>>,
        fetches: Mutex<Vec<(String, bool)>>,
        fail_fetch: bool,
    }

    impl AgentHost for FakeHost {
        fn emit(&self, event: &str, payload: Value) {
            self.events.lock().unwrap().push((event.to_string(), payload));
        }
        fn focus_main_window(&self) {
            *self.focused.lock().unwrap() += 1;
        }
        fn search(&self, request: &SearchRequest) -> Result<Value, String> {
            self.searches.lock().unwrap().push((
                request.query.clone(),
                request.scope.clone(),
                request.project_id.clone(),
                request.query_vector.is_some() || request.model.is_some(),
                request.limit,
            ));
            Ok(json!({ "passages": [], "notes": [], "meaning": "off", "took_ms": 1 }))
        }
        fn substack_fetch(&self, url: &str, with_cookie: bool) -> Result<Value, String> {
            self.fetches.lock().unwrap().push((url.to_string(), with_cookie));
            if self.fail_fetch {
                return Err("Couldn't reach Substack. Check your connection.".to_string());
            }
            Ok(json!({
                "status": 200,
                "url": url,
                "text": "<html></html>",
                "retry_after": null,
                "cookie_sent": with_cookie,
            }))
        }
    }

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn setup() -> (AgentContext, Arc<FakeHost>, Arc<Mutex<Database>>) {
        let host = Arc::new(FakeHost::default());
        let ctx = AgentContext { key: KEY.to_string(), host: host.clone() };
        (ctx, host, Arc::new(Mutex::new(Database::open_in_memory().unwrap())))
    }

    fn header(name: &str, value: &str) -> Header {
        Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
    }

    fn auth() -> Vec<Header> {
        vec![
            header("Host", "127.0.0.1:23456"),
            header("Authorization", &format!("Bearer {}", KEY)),
        ]
    }

    fn call(
        ctx: &AgentContext,
        db: &Arc<Mutex<Database>>,
        method: Method,
        path: &str,
        body: &str,
        headers: &[Header],
    ) -> (u16, Value, Vec<String>) {
        let response = handle(ctx, db, &method, path, body.as_bytes(), headers);
        let status = response.status_code().0;
        let names: Vec<String> =
            response.headers().iter().map(|h| h.field.as_str().as_str().to_ascii_lowercase()).collect();
        let mut text = String::new();
        response.into_reader().read_to_string(&mut text).unwrap();
        (status, serde_json::from_str(&text).unwrap_or(Value::Null), names)
    }

    #[test]
    fn key_is_64_lowercase_hex_and_new_each_time() {
        let a = generate_key();
        let b = generate_key();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_ne!(a, b);
    }

    #[test]
    fn constant_time_eq_compares_whole_values() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn rejects_requests_without_the_right_key_or_with_an_origin() {
        let (ctx, host, db) = setup();
        let path = "/api/agent/changed";

        // No Authorization header.
        let no_key = vec![header("Host", "127.0.0.1:23456")];
        assert_eq!(call(&ctx, &db, Method::Post, path, "{}", &no_key).0, 403);

        // Wrong key, wrong scheme, empty bearer.
        for value in ["Bearer nope", &format!("Basic {}", KEY), "Bearer", KEY, "Bearer "] {
            let headers = vec![header("Host", "127.0.0.1:23456"), header("Authorization", value)];
            assert_eq!(call(&ctx, &db, Method::Post, path, "{}", &headers).0, 403, "{value}");
        }

        // A key that differs only in its last character.
        let almost = format!("{}0", &KEY[..63]);
        let headers = vec![header("Authorization", &format!("Bearer {}", almost))];
        assert_eq!(call(&ctx, &db, Method::Post, path, "{}", &headers).0, 403);

        // The right key with any Origin is refused (a web page can't use the key).
        for origin in ["https://evil.com", "http://localhost:3000", "null", "tauri://localhost"] {
            let mut headers = auth();
            headers.push(header("Origin", origin));
            let (status, _, names) = call(&ctx, &db, Method::Post, path, "{}", &headers);
            assert_eq!(status, 403, "{origin}");
            assert!(!names.iter().any(|n| n.starts_with("access-control")));
        }

        assert!(host.events.lock().unwrap().is_empty());

        // The right key, no Origin.
        let (status, body, names) = call(&ctx, &db, Method::Post, path, "{}", &auth());
        assert_eq!(status, 200);
        assert_eq!(body, json!({ "ok": true }));
        assert!(!names.iter().any(|n| n.starts_with("access-control") || n == "vary"));
    }

    #[test]
    fn unknown_routes_and_wrong_methods() {
        let (ctx, _host, db) = setup();
        assert_eq!(call(&ctx, &db, Method::Get, "/api/agent/nope", "", &auth()).0, 404);
        assert_eq!(call(&ctx, &db, Method::Post, "/api/agent/status", "{}", &auth()).0, 405);
        assert_eq!(call(&ctx, &db, Method::Get, "/api/agent/search", "", &auth()).0, 405);
        // Unknown routes still need the key.
        let none = vec![header("Host", "127.0.0.1:23456")];
        assert_eq!(call(&ctx, &db, Method::Get, "/api/agent/nope", "", &none).0, 403);
    }

    #[test]
    fn status_reports_the_mode_and_sign_in() {
        let _guard = session::TEST_SESSION_MUTEX.lock().unwrap();
        let (ctx, _host, db) = setup();
        let dir = std::env::temp_dir().join(format!("sf_agent_status_{}", uuid::Uuid::new_v4()));
        let session_file = dir.join("session.json");
        session::set_session_path_override(Some(session_file.clone()));

        let (status, body, _) = call(&ctx, &db, Method::Get, "/api/agent/status", "", &auth());
        assert_eq!(status, 200);
        assert_eq!(
            body,
            json!({
                "version": env!("CARGO_PKG_VERSION"),
                "mode": "signed_out",
                "web_url": null,
                "email": null,
            })
        );

        let sess = session::Session {
            web_url: "https://web.sourcefold.app".to_string(),
            token: "tok".to_string(),
            email: Some("me@example.com".to_string()),
            signed_in_at: "2026-10-18T00:00:00Z".to_string(),
        };
        session::save_session_to(&session_file, &sess).unwrap();
        let (_, body, _) = call(&ctx, &db, Method::Get, "/api/agent/status", "", &auth());
        assert_eq!(body["mode"], "signed_in");
        assert_eq!(body["web_url"], "https://web.sourcefold.app");
        assert_eq!(body["email"], "me@example.com");

        // Offline wins even when a session file is still there.
        db.lock().unwrap().set_setting("offline_mode", "true").unwrap();
        let (_, body, _) = call(&ctx, &db, Method::Get, "/api/agent/status", "", &auth());
        assert_eq!(body["mode"], "offline");

        session::clear_session_from(&session_file).unwrap();
        let (_, body, _) = call(&ctx, &db, Method::Get, "/api/agent/status", "", &auth());
        assert_eq!(body["mode"], "offline");
        assert_eq!(body["email"], Value::Null);

        db.lock().unwrap().set_setting("offline_mode", "false").unwrap();
        let (_, body, _) = call(&ctx, &db, Method::Get, "/api/agent/status", "", &auth());
        assert_eq!(body["mode"], "signed_out");

        session::set_session_path_override(None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_runs_keywords_only_and_validates_the_body() {
        let (ctx, host, db) = setup();
        let path = "/api/agent/search";

        let body = r#"{"query":"turbo lag","scope":"project","project_id":"p1","limit":5}"#;
        let (status, reply, _) = call(&ctx, &db, Method::Post, path, body, &auth());
        assert_eq!(status, 200);
        assert_eq!(reply["meaning"], "off");
        assert!(reply["passages"].is_array());
        assert!(reply["notes"].is_array());
        assert!(reply["took_ms"].is_number());

        let body = r#"{"query":"x","scope":"all","project_id":null,"query_vector":[0.1],"model":"m"}"#;
        assert_eq!(call(&ctx, &db, Method::Post, path, body, &auth()).0, 200);

        {
            let searches = host.searches.lock().unwrap();
            assert_eq!(searches.len(), 2);
            assert_eq!(
                searches[0],
                ("turbo lag".to_string(), "project".to_string(), Some("p1".to_string()), false, Some(5))
            );
            // A vector or model in the body is ignored.
            assert_eq!(searches[1], ("x".to_string(), "all".to_string(), None, false, None));
        }

        for bad in [
            "not json",
            "{}",
            r#"{"query":"x"}"#,
            r#"{"query":"x","scope":"everywhere"}"#,
            r#"{"query":"x","scope":"project"}"#,
            r#"{"query":"x","scope":"project","project_id":"  "}"#,
            r#"{"query":"x","scope":"all","limit":"ten"}"#,
        ] {
            let (status, reply, _) = call(&ctx, &db, Method::Post, path, bad, &auth());
            assert_eq!(status, 400, "{bad}");
            assert!(reply["error"]["message"].as_str().is_some_and(|m| !m.is_empty()));
        }
        assert_eq!(host.searches.lock().unwrap().len(), 2);
    }

    #[test]
    fn show_emits_the_target_and_focuses_the_window() {
        let (ctx, host, db) = setup();
        let path = "/api/agent/show";

        for (body, expected) in [
            (r#"{"group_id":"g1"}"#, json!({ "group_id": "g1" })),
            (r#"{"source_id":"s1"}"#, json!({ "source_id": "s1" })),
            (
                r#"{"source_id":"s1","highlight_id":"h1"}"#,
                json!({ "source_id": "s1", "highlight_id": "h1" }),
            ),
            (r#"{"source_id":"s1","highlight_id":null}"#, json!({ "source_id": "s1" })),
        ] {
            let (status, reply, _) = call(&ctx, &db, Method::Post, path, body, &auth());
            assert_eq!(status, 200, "{body}");
            assert_eq!(reply, json!({ "ok": true }));
            let events = host.events.lock().unwrap();
            assert_eq!(events.last().unwrap(), &("agent-show".to_string(), expected));
        }
        assert_eq!(*host.focused.lock().unwrap(), 4);

        let before = host.events.lock().unwrap().len();
        for bad in [
            "",
            "nope",
            "[]",
            "{}",
            r#"{"group_id":"g1","source_id":"s1"}"#,
            r#"{"highlight_id":"h1"}"#,
            r#"{"group_id":"g1","highlight_id":"h1"}"#,
            r#"{"source_id":""}"#,
            r#"{"source_id":7}"#,
        ] {
            let (status, reply, _) = call(&ctx, &db, Method::Post, path, bad, &auth());
            assert_eq!(status, 400, "{bad}");
            assert!(reply["error"]["message"].is_string());
        }
        assert_eq!(host.events.lock().unwrap().len(), before);
        assert_eq!(*host.focused.lock().unwrap(), 4);
    }

    #[test]
    fn changed_emits_agent_changed() {
        let (ctx, host, db) = setup();
        let path = "/api/agent/changed";
        for body in ["{}", "", "  "] {
            let (status, reply, _) = call(&ctx, &db, Method::Post, path, body, &auth());
            assert_eq!(status, 200);
            assert_eq!(reply, json!({ "ok": true }));
        }
        assert_eq!(host.events.lock().unwrap().len(), 3);
        assert!(host.events.lock().unwrap().iter().all(|(name, _)| name == "agent-changed"));

        assert_eq!(call(&ctx, &db, Method::Post, path, "nope", &auth()).0, 400);
        assert_eq!(call(&ctx, &db, Method::Post, path, "[]", &auth()).0, 400);
        assert_eq!(host.events.lock().unwrap().len(), 3);
        // Changing the library doesn't pull the window forward.
        assert_eq!(*host.focused.lock().unwrap(), 0);
    }

    #[test]
    fn substack_fetch_passes_through_the_result() {
        let (ctx, host, db) = setup();
        let path = "/api/agent/substack-fetch";

        let body = r#"{"url":"https://example.substack.com/p/post","with_cookie":true}"#;
        let (status, reply, _) = call(&ctx, &db, Method::Post, path, body, &auth());
        assert_eq!(status, 200);
        assert_eq!(reply["status"], 200);
        assert_eq!(reply["url"], "https://example.substack.com/p/post");
        assert_eq!(reply["cookie_sent"], true);
        assert!(reply.get("retry_after").is_some());
        assert!(reply.get("text").is_some());

        // The cookie is off unless asked for.
        let body = r#"{"url":"https://example.substack.com/p/post"}"#;
        assert_eq!(call(&ctx, &db, Method::Post, path, body, &auth()).0, 200);
        assert_eq!(
            *host.fetches.lock().unwrap(),
            vec![
                ("https://example.substack.com/p/post".to_string(), true),
                ("https://example.substack.com/p/post".to_string(), false),
            ]
        );

        for bad in ["", "{}", r#"{"url":7}"#, r#"{"url":"not a url"}"#, r#"{"url":"file:///etc/passwd"}"#] {
            let (status, reply, _) = call(&ctx, &db, Method::Post, path, bad, &auth());
            assert_eq!(status, 400, "{bad}");
            assert!(reply["error"]["message"].is_string());
        }
        assert_eq!(host.fetches.lock().unwrap().len(), 2);

        // A failed fetch is reported with its message.
        let failing = Arc::new(FakeHost { fail_fetch: true, ..Default::default() });
        let ctx = AgentContext { key: KEY.to_string(), host: failing };
        let (status, reply, _) = call(&ctx, &db, Method::Post, path, body, &auth());
        assert_eq!(status, 502);
        assert_eq!(reply["error"]["message"], "Couldn't reach Substack. Check your connection.");
    }

    #[test]
    fn writes_agent_json_to_the_given_path_only() {
        let dir = std::env::temp_dir().join(format!("sf_agent_file_{}", uuid::Uuid::new_v4()));
        let path = dir.join("nested").join(AGENT_FILE_NAME);
        let key = generate_key();

        write_agent_file_to(&path, 23456, &key).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["port"], 23456);
        assert_eq!(value["key"], key.as_str());
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value.as_object().unwrap().len(), 3);
        assert!(!path.with_extension("json.tmp").exists());

        // A new write replaces the old one.
        let second = generate_key();
        write_agent_file_to(&path, 23457, &second).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["key"], second.as_str());
        assert_eq!(value["port"], 23457);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_file_path_honours_the_override() {
        // Runs with the override set, so nothing here can touch the real app data folder.
        let dir = std::env::temp_dir().join(format!("sf_agent_override_{}", uuid::Uuid::new_v4()));
        let path = dir.join(AGENT_FILE_NAME);
        set_agent_file_override(Some(path.clone()));
        assert_eq!(agent_file_path(), path);

        // `publish` writes the run's key and the port it was given.
        let key = init();
        publish(23999).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["key"], key);
        assert_eq!(value["port"], 23999);
        assert_eq!(current_key(), Some(key));

        set_agent_file_override(None);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(agent_file_path().ends_with(AGENT_FILE_NAME));
        assert!(agent_file_path().parent().unwrap().ends_with("Sourcefold"));
    }
}
