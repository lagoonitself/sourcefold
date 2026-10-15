use std::sync::{Arc, Mutex};
use std::time::Duration;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use tiny_http::{Header, Response, Server};

use crate::db::Database;
use crate::session::{self, Session};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub signed_in: bool,
    pub web_url: Option<String>,
    pub email: Option<String>,
    pub token: Option<String>,
    pub offline: bool,
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

pub fn validate_web_url(web_url: &str) -> Result<String, String> {
    let trimmed = web_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Web URL is required".to_string());
    }

    let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("Invalid URL: {}", e))?;
    let host = parsed.host_str().unwrap_or("");
    let is_local = host == "localhost" || host == "127.0.0.1";
    let is_valid_scheme = parsed.scheme() == "https" || (parsed.scheme() == "http" && is_local);

    if !is_valid_scheme {
        return Err("Web URL must use https (or http for localhost/127.0.0.1)".to_string());
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Web URL must not contain username or password credentials".to_string());
    }

    if parsed.query().is_some() {
        return Err("Web URL must not contain query parameters".to_string());
    }

    if parsed.fragment().is_some() {
        return Err("Web URL must not contain URL fragments".to_string());
    }

    Ok(trimmed.to_string())
}

fn html_response(html: String, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = Response::from_string(html).with_status_code(status);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
        resp.add_header(header);
    }
    resp
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
            web_url: Some(s.web_url),
            email: s.email,
            token: Some(s.token),
            offline: false,
        })
    } else {
        Ok(SessionStatus {
            signed_in: false,
            web_url: None,
            email: None,
            token: None,
            offline,
        })
    }
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

#[tauri::command]
pub async fn start_sign_in(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    auth_state: State<'_, Arc<AuthFlowState>>,
    web_url: String,
) -> Result<(), String> {
    let validated_url = validate_web_url(&web_url)?;

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

    let state = uuid::Uuid::new_v4().to_string();
    let server_arc = Arc::new(server);

    {
        let mut guard = match auth_state.active_server.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        *guard = Some(server_arc.clone());
    }

    let connect_url = format!(
        "{}/desktop/connect?callback=http%3A%2F%2F127.0.0.1%3A{}%2Fauth%2Fcallback&state={}",
        validated_url, port, state
    );

    // Open browser with system default
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&connect_url, None::<&str>)
        .map_err(|e| format!("Failed to open system browser: {}", e))?;

    let app_clone = app.clone();
    let db_clone = db.inner().clone();
    let auth_state_arc = auth_state.inner().clone();

    // Spawn waiting thread (timeout: 5 minutes = 300 seconds)
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

                    if path != "/auth/callback" {
                        let resp = Response::from_string("Not Found").with_status_code(404);
                        let _ = request.respond(resp);
                        continue;
                    }

                    let rec_state = parse_query_param(query, "state");
                    let rec_token = parse_query_param(query, "token");
                    let rec_email = parse_query_param(query, "email");

                    if rec_state.as_deref() != Some(&state) {
                        let html = "<!DOCTYPE html><html><body style=\"font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa;\"><div style=\"background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px 32px; text-align: center;\"><h1 style=\"color: #e11d48; font-size: 20px; margin: 0 0 8px;\">Sign-in Failed</h1><p style=\"color: #666; margin: 0;\">State parameter mismatch. You can close this tab.</p></div></body></html>".to_string();
                        let resp = html_response(html, 400);
                        let _ = request.respond(resp);
                        continue;
                    }

                    let token = match rec_token {
                        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
                        _ => {
                            let html = "<!DOCTYPE html><html><body style=\"font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa;\"><div style=\"background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px 32px; text-align: center;\"><h1 style=\"color: #e11d48; font-size: 20px; margin: 0 0 8px;\">Sign-in Failed</h1><p style=\"color: #666; margin: 0;\">Missing authentication token. You can close this tab.</p></div></body></html>".to_string();
                            let resp = html_response(html, 400);
                            let _ = request.respond(resp);
                            continue;
                        }
                    };

                    // Save session
                    let sess = Session {
                        web_url: validated_url.clone(),
                        token,
                        email: rec_email.filter(|e| !e.trim().is_empty()),
                        signed_in_at: Utc::now().to_rfc3339(),
                    };

                    if let Err(e) = session::save_session(&sess) {
                        let err_msg = format!("Failed to save session: {}", e);
                        let _ = app_clone.emit("auth-error", &err_msg);
                        let html = format!(
                            "<!DOCTYPE html><html><body style=\"font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa;\"><div style=\"background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px 32px; text-align: center;\"><h1 style=\"color: #e11d48; font-size: 20px; margin: 0 0 8px;\">Sign-in Failed</h1><p style=\"color: #666; margin: 0;\">{}</p></div></body></html>",
                            err_msg
                        );
                        let resp = html_response(html, 500);
                        let _ = request.respond(resp);
                        continue;
                    }

                    // Success response with plain wording
                    let html = "<!DOCTYPE html><html><body style=\"font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa;\"><div style=\"background: white; border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px 32px; text-align: center;\"><h1 style=\"color: #16a34a; font-size: 20px; margin: 0 0 8px;\">Signed in to Sourcefold Desktop</h1><p style=\"color: #666; margin: 0;\">You're signed in. You can close this tab and go back to Sourcefold.</p></div></body></html>".to_string();
                    let resp = html_response(html, 200);
                    let _ = request.respond(resp);

                    let _ = db_clone.set_setting("offline_mode", "false");

                    // Emit auth-changed
                    let _ = app_clone.emit("auth-changed", ());

                    // Bring window to front
                    if let Some(window) = app_clone.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
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

    Ok(())
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

    #[test]
    fn test_validate_web_url() {
        // Valid https URLs
        assert!(validate_web_url("https://app.sourcefold.com").is_ok());
        assert!(validate_web_url("https://sourcefold.app/").is_ok());

        // Valid http for localhost/127.0.0.1
        assert!(validate_web_url("http://localhost:5173").is_ok());
        assert!(validate_web_url("http://127.0.0.1:3000").is_ok());

        // Invalid http for remote host
        assert!(validate_web_url("http://evil.com").is_err());

        // Invalid with credentials
        assert!(validate_web_url("https://user:pass@sourcefold.app").is_err());

        // Invalid with query or fragment
        assert!(validate_web_url("https://sourcefold.app?query=1").is_err());
        assert!(validate_web_url("https://sourcefold.app#fragment").is_err());
    }
}
