use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tiny_http::{Header, Response, Server};

use crate::db::Database;
use crate::session::{self, Session};

// Sign-in goes straight to Supabase (Google), without the website (docs/dev/handoff-no-website.md):
// `start_sign_in` opens a listener on 127.0.0.1 and returns its port; the webview asks Supabase
// for the Google sign-in address with `http://127.0.0.1:<port>/callback` as the way back and opens
// it. Supabase sends the browser back with `?code=…`, which goes to the webview as
// `oauth-callback`; the webview finishes the sign-in (PKCE) and reports the session with
// `session_set`.

pub const OAUTH_CALLBACK_EVENT: &str = "oauth-callback";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub signed_in: bool,
    pub email: Option<String>,
    pub user_id: Option<String>,
    pub offline: bool,
}

/// What the webview reports after sign-in and on every token refresh.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub supabase_url: String,
    pub publishable_key: String,
    pub access_token: String,
    pub expires_at: i64,
    pub user_id: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct CallbackPayload {
    code: String,
}

pub struct AuthFlowState {
    pub active_server: Mutex<Option<Arc<Server>>>,
}

impl Default for AuthFlowState {
    fn default() -> Self {
        Self {
            active_server: Mutex::new(None),
        }
    }
}

fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            if let (Some(h1), Some(h2)) = (chars.next(), chars.next()) {
                let hex_slice = [h1, h2];
                if let Ok(s) = std::str::from_utf8(&hex_slice) {
                    if let Ok(byte) = u8::from_str_radix(s, 16) {
                        bytes.push(byte);
                        continue;
                    }
                }
                bytes.push(b'%');
                bytes.push(h1);
                bytes.push(h2);
            } else {
                bytes.push(b'%');
            }
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

pub fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

/// Checks what the webview reports before it is written for the extension and Claude.
pub fn session_from_input(input: SessionInput, previous: Option<&Session>) -> Result<Session, String> {
    let supabase_url = input.supabase_url.trim().trim_end_matches('/').to_string();
    let parsed = reqwest::Url::parse(&supabase_url).map_err(|_| "Invalid Supabase address.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    let is_local = host == "localhost" || host == "127.0.0.1";
    if !(parsed.scheme() == "https" || (parsed.scheme() == "http" && is_local)) {
        return Err("The Supabase address must use https.".to_string());
    }
    if input.access_token.trim().is_empty() || input.user_id.trim().is_empty() {
        return Err("The sign-in is incomplete.".to_string());
    }
    // Keep the first sign-in time across token refreshes.
    let signed_in_at = previous
        .filter(|p| p.user_id == input.user_id)
        .map(|p| p.signed_in_at.clone())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    Ok(Session {
        supabase_url,
        publishable_key: input.publishable_key.trim().to_string(),
        access_token: input.access_token.trim().to_string(),
        expires_at: input.expires_at,
        user_id: input.user_id.trim().to_string(),
        email: input.email.filter(|e| !e.trim().is_empty()),
        signed_in_at,
    })
}

fn html_response(html: String, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = Response::from_string(html).with_status_code(status);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
        resp.add_header(header);
    }
    resp
}

fn page(title: &str, message: &str, ok: bool, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let color = if ok { "#16a34a" } else { "#e11d48" };
    let html = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Sourcefold</title></head><body style=\"font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa;\"><div style=\"background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px 32px; text-align: center;\"><h1 style=\"color: {}; font-size: 20px; margin: 0 0 8px;\">{}</h1><p style=\"color: #666; margin: 0;\">{}</p></div></body></html>",
        color, title, message
    );
    html_response(html, status)
}

/// Escapes text from the query string before it goes into the page.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[tauri::command]
pub async fn get_session(db: State<'_, Database>) -> Result<SessionStatus, String> {
    let offline = db
        .get_setting("offline_mode")
        .map_err(|e| e.to_string())?
        .map(|v| v == "true")
        .unwrap_or(false);

    if let Some(s) = session::load_session() {
        Ok(SessionStatus {
            signed_in: true,
            email: s.email,
            user_id: Some(s.user_id),
            offline: false,
        })
    } else {
        Ok(SessionStatus {
            signed_in: false,
            email: None,
            user_id: None,
            offline,
        })
    }
}

/// The webview reports its Supabase session: after sign-in and on every token refresh.
#[tauri::command]
pub async fn session_set(session: SessionInput) -> Result<(), String> {
    let previous = session::load_session();
    let next = session_from_input(session, previous.as_ref())?;
    session::save_session(&next).map_err(|e| format!("Couldn't save the sign-in: {}", e))
}

#[tauri::command]
pub async fn sign_out(app: tauri::AppHandle, db: State<'_, Database>) -> Result<(), String> {
    session::clear_session().map_err(|e| e.to_string())?;
    let _ = db.set_setting("offline_mode", "false");
    let _ = app.emit("auth-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn set_offline_mode(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    offline: bool,
) -> Result<(), String> {
    db.set_setting("offline_mode", if offline { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    let _ = app.emit("auth-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn cancel_sign_in(auth_state: State<'_, Arc<AuthFlowState>>) -> Result<(), String> {
    let mut guard = match auth_state.active_server.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(srv) = guard.take() {
        srv.unblock();
    }
    Ok(())
}

/// Opens the listener the browser comes back to and returns its port. The webview then opens the
/// Supabase sign-in address with `http://127.0.0.1:<port>/callback` as the way back.
#[tauri::command]
pub async fn start_sign_in(
    app: tauri::AppHandle,
    auth_state: State<'_, Arc<AuthFlowState>>,
) -> Result<u16, String> {
    // Cancel any previous sign-in attempt
    {
        let mut guard = match auth_state.active_server.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(prev) = guard.take() {
            prev.unblock();
        }
    }

    let server = Server::http("127.0.0.1:0").map_err(|e| format!("Failed to bind loopback server: {}", e))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|addr| addr.port())
        .ok_or_else(|| "Failed to get loopback server port".to_string())?;

    let server_arc = Arc::new(server);
    {
        let mut guard = match auth_state.active_server.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(server_arc.clone());
    }

    let app_clone = app.clone();
    let auth_state_arc = auth_state.inner().clone();

    // Wait for the browser to come back (5 minutes at most).
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        let mut timed_out = false;

        loop {
            let now = std::time::Instant::now();
            if now >= deadline {
                timed_out = true;
                break;
            }
            let remaining = deadline - now;
            let check_timeout = remaining.min(Duration::from_millis(500));

            match server_arc.recv_timeout(check_timeout) {
                Ok(Some(request)) => {
                    let url_raw = request.url().to_string();
                    let (path, query) = match url_raw.split_once('?') {
                        Some((p, q)) => (p, q),
                        None => (url_raw.as_str(), ""),
                    };

                    if path != "/callback" {
                        let resp = Response::from_string("Not Found").with_status_code(404);
                        let _ = request.respond(resp);
                        continue;
                    }

                    if let Some(code) = parse_query_param(query, "code").filter(|c| !c.trim().is_empty()) {
                        let _ = request.respond(page(
                            "Signed in",
                            "You can close this tab and go back to Sourcefold.",
                            true,
                            200,
                        ));
                        let _ = app_clone.emit(OAUTH_CALLBACK_EVENT, CallbackPayload { code: code.trim().to_string() });
                        if let Some(window) = app_clone.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        break;
                    }

                    // Supabase (or Google) refused: `?error=…&error_description=…`.
                    let message = parse_query_param(query, "error_description")
                        .or_else(|| parse_query_param(query, "error"))
                        .filter(|m| !m.trim().is_empty())
                        .unwrap_or_else(|| "The sign-in didn't finish.".to_string());
                    let _ = request.respond(page(
                        "Sign-in failed",
                        &format!("{} You can close this tab.", escape_html(&message)),
                        false,
                        400,
                    ));
                    let _ = app_clone.emit("auth-error", &message);
                    break;
                }
                Ok(None) => {
                    // Server unblocked or timed out
                    let is_active = {
                        let guard = match auth_state_arc.active_server.lock() {
                            Ok(g) => g,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        guard.as_ref().map(|s| Arc::ptr_eq(s, &server_arc)).unwrap_or(false)
                    };
                    if !is_active {
                        break;
                    }
                }
                Err(_) => {
                    break;
                }
            }
        }

        if timed_out {
            let _ = app_clone.emit("auth-error", "Sign-in timed out. Try again.");
        }

        // Clean up active server if it matches
        let mut guard = match auth_state_arc.active_server.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(active) = guard.as_ref() {
            if Arc::ptr_eq(active, &server_arc) {
                *guard = None;
            }
        }
    });

    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_query_param() {
        let q = "state=test_state_123&token=sf_abc123&email=test%40example.com";
        assert_eq!(parse_query_param(q, "state"), Some("test_state_123".to_string()));
        assert_eq!(parse_query_param(q, "token"), Some("sf_abc123".to_string()));
        assert_eq!(parse_query_param(q, "email"), Some("test@example.com".to_string()));
        assert_eq!(parse_query_param(q, "missing"), None);
    }

    fn input(user_id: &str) -> SessionInput {
        SessionInput {
            supabase_url: "https://project.supabase.co/".into(),
            publishable_key: "sb_publishable_x".into(),
            access_token: "eyJ.a.b".into(),
            expires_at: 1_800_000_000,
            user_id: user_id.into(),
            email: Some("me@example.com".into()),
        }
    }

    #[test]
    fn session_input_is_checked_and_keeps_the_first_sign_in_time() {
        let first = session_from_input(input("u1"), None).unwrap();
        assert_eq!(first.supabase_url, "https://project.supabase.co");
        assert_eq!(first.user_id, "u1");

        let mut earlier = first.clone();
        earlier.signed_in_at = "2026-01-01T00:00:00Z".into();
        let refreshed = session_from_input(input("u1"), Some(&earlier)).unwrap();
        assert_eq!(refreshed.signed_in_at, "2026-01-01T00:00:00Z");
        let other = session_from_input(input("u2"), Some(&earlier)).unwrap();
        assert_ne!(other.signed_in_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn session_input_refuses_bad_addresses_and_empty_tokens() {
        let mut bad = input("u1");
        bad.supabase_url = "http://evil.example".into();
        assert!(session_from_input(bad, None).is_err());

        let mut local = input("u1");
        local.supabase_url = "http://127.0.0.1:54321".into();
        assert!(session_from_input(local, None).is_ok());

        let mut empty = input("u1");
        empty.access_token = " ".into();
        assert!(session_from_input(empty, None).is_err());
    }

    #[test]
    fn page_text_from_the_query_is_escaped() {
        assert_eq!(escape_html("<b>\"x\" & y</b>"), "&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;");
    }
}
