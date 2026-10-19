use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use serde::Deserialize;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::agent::{self, AgentContext};
use crate::db::Database;
use crate::native_installer;
use crate::service::{self, CapturePayload, ServiceError, XPostCapture};

pub const DEFAULT_PORT: u16 = 23456;

// -----------------------------------------------------------------------------
// Security Guards: Host & Origin
// -----------------------------------------------------------------------------

pub fn is_valid_host(host: &str) -> bool {
    let lower = host.trim().to_ascii_lowercase();
    if lower == "localhost" || lower == "127.0.0.1" {
        return true;
    }
    if let Some((h, p)) = lower.split_once(':') {
        if (h == "localhost" || h == "127.0.0.1") && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    false
}

pub fn is_allowed_origin(origin: &str) -> bool {
    let o = origin.trim();
    if let Some(rest) = o.strip_prefix("chrome-extension://") {
        let clean_id = rest.trim_end_matches('/');
        return native_installer::is_allowed_extension_id(clean_id);
    }
    if o == "tauri://localhost" || o == "http://tauri.localhost" || o == "https://tauri.localhost" {
        return true;
    }
    if o == "http://localhost:3000" || o == "http://127.0.0.1:3000" {
        return true;
    }
    #[cfg(debug_assertions)]
    {
        if o == "http://localhost:5173" || o == "http://127.0.0.1:5173" {
            return true;
        }
    }
    false
}

pub fn get_header<'a>(headers: &'a [Header], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

pub fn forbidden_response() -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&json!({
        "error": {
            "message": "Forbidden"
        }
    })
    ).unwrap_or_default();
    let body_len = body.len();
    let headers = vec![
        Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    ];
    Response::new(
        StatusCode(403),
        headers,
        Cursor::new(body),
        Some(body_len),
        None,
    )
}

// -----------------------------------------------------------------------------
// Response Helpers
// -----------------------------------------------------------------------------

pub fn json_response(
    status: u16,
    data: Value,
    origin: Option<&str>,
) -> Response<Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(&data).unwrap_or_default();
    let body_len = body.len();

    let mut headers = Vec::new();
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        headers.push(h);
    }
    if let Some(orig) = origin {
        if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], orig.as_bytes()) {
            headers.push(h);
        }
        if let Ok(h) = Header::from_bytes(&b"Vary"[..], &b"Origin"[..]) {
            headers.push(h);
        }
    }

    Response::new(
        StatusCode(status),
        headers,
        Cursor::new(body),
        Some(body_len),
        None,
    )
}

pub fn error_response(
    status: u16,
    message: &str,
    code: &str,
    origin: Option<&str>,
) -> Response<Cursor<Vec<u8>>> {
    json_response(
        status,
        json!({
            "error": {
                "message": message,
                "code": code
            }
        }),
        origin,
    )
}

pub fn service_error_response(err: ServiceError, origin: Option<&str>) -> Response<Cursor<Vec<u8>>> {
    let status = match err.code.as_str() {
        "not_found" => 404,
        "duplicate" => 409,
        "invalid_request" | "invalid_url" => 400,
        _ => 500,
    };
    json_response(status, json!({ "error": err }), origin)
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

fn parse_query_param(query: &str, key: &str) -> Option<String> {
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

/// Tests must never write the real manifest, launcher script or registry keys.
#[cfg(not(test))]
fn install_native_host(ids: &[String]) -> Result<String, String> {
    native_installer::install_native_host(ids)
}

#[cfg(test)]
fn install_native_host(_ids: &[String]) -> Result<String, String> {
    Ok("test install skipped".to_string())
}

// -----------------------------------------------------------------------------
// Request Payloads
// -----------------------------------------------------------------------------

#[derive(Deserialize)]
struct CreateFolderPayload {
    name: String,
    #[serde(default)]
    parent_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateItemPayload {
    folder_id: String,
    #[serde(default = "default_item_kind")]
    kind: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    canonical_url: Option<String>,
    #[serde(default)]
    markdown: Option<String>,
    #[serde(default)]
    meta: Option<Value>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    position: Option<i32>,
}

fn default_item_kind() -> String {
    "note".to_string()
}

#[derive(Deserialize)]
struct CheckUrlPayload {
    url: String,
    folder_id: String,
}

#[derive(Deserialize)]
struct GrokipediaPayload {
    url: String,
    folder_id: String,
    #[serde(default)]
    html: Option<String>,
}

#[derive(Deserialize)]
struct AddXPostPayload {
    post: XPostCapture,
    #[serde(default)]
    parent_post_url: Option<String>,
}

// -----------------------------------------------------------------------------
// Request Routing
// -----------------------------------------------------------------------------

pub fn handle_request(
    db_arc: &Arc<Mutex<Database>>,
    method: &Method,
    path: &str,
    query: &str,
    body: &[u8],
    headers: &[Header],
) -> Response<Cursor<Vec<u8>>> {
    handle_request_with_agent(db_arc, method, path, query, body, headers, None)
}

/// `handle_request` plus the `/api/agent/*` routes. Without an agent context (no running app, or
/// `agent.json` could not be written) those routes answer 403.
pub fn handle_request_with_agent(
    db_arc: &Arc<Mutex<Database>>,
    method: &Method,
    path: &str,
    query: &str,
    body: &[u8],
    headers: &[Header],
    agent_ctx: Option<&AgentContext>,
) -> Response<Cursor<Vec<u8>>> {
    // 1. Host Header Validation
    let host = match get_header(headers, "Host") {
        Some(h) if is_valid_host(h) => h,
        _ => return forbidden_response(),
    };
    let _ = host;

    // 1b. Agent routes (the MCP server): their own key and Origin rules, no CORS, nothing else is
    // reachable with the key.
    if agent::is_agent_path(path) {
        return match agent_ctx {
            Some(ctx) => agent::handle(ctx, db_arc, method, path, body, headers),
            None => forbidden_response(),
        };
    }

    // 2. Origin / extension identity validation.
    //
    // The `X-Sourcefold-Extension` header can only be set by a cross-origin page after a CORS
    // preflight, which is rejected below for every origin that is not allowed. A request without
    // an `Origin` is therefore accepted only when that header names an allowed extension ID
    // (health checks are the one exception). Whenever the header is present it must be allowed.
    let origin = get_header(headers, "Origin");
    let ext_header = get_header(headers, "X-Sourcefold-Extension");
    let is_health_or_status =
        (method == &Method::Get) && (path == "/api/health" || path == "/api/status");

    if let Some(ext_id) = ext_header {
        if !native_installer::is_allowed_extension_id(ext_id) {
            return forbidden_response();
        }
    }

    let allowed_origin = match origin {
        Some(orig) => {
            if !is_allowed_origin(orig) {
                return forbidden_response();
            }
            if path == "/api/session" && !orig.starts_with("chrome-extension://") {
                return forbidden_response();
            }
            Some(orig)
        }
        None if is_health_or_status => None,
        None if ext_header.is_some() && method != &Method::Options => None,
        None => return forbidden_response(),
    };

    // 3. Preflight OPTIONS Handling
    if method == &Method::Options {
        let orig = match allowed_origin {
            Some(o) => o,
            None => return forbidden_response(),
        };

        let mut custom_headers = Vec::new();
        if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], orig.as_bytes()) {
            custom_headers.push(h);
        }
        if let Ok(h) = Header::from_bytes(&b"Vary"[..], &b"Origin"[..]) {
            custom_headers.push(h);
        }
        if let Ok(h) = Header::from_bytes(
            &b"Access-Control-Allow-Methods"[..],
            &b"GET, POST, PUT, PATCH, DELETE, OPTIONS"[..],
        ) {
            custom_headers.push(h);
        }
        // Only Sourcefold extension origins may send the identity header.
        let allow_headers = if orig.starts_with("chrome-extension://") {
            "Content-Type, Authorization, Accept, X-Sourcefold-Extension"
        } else {
            "Content-Type, Authorization, Accept"
        };
        if let Ok(h) = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], allow_headers.as_bytes()) {
            custom_headers.push(h);
        }

        return Response::new(
            StatusCode(204),
            custom_headers,
            Cursor::new(Vec::new()),
            Some(0),
            None,
        );
    }

    // 4. API Endpoints
    match (method, path) {
        // Health & Status
        (&Method::Get, "/api/health") | (&Method::Get, "/api/status") => {
            json_response(200, json!({ "status": "ok", "app": "sourcefold-desktop" }), allowed_origin)
        }

        // Extension session contract
        (&Method::Get, "/api/session") => {
            let session_data = if let Some(session) = crate::session::load_session() {
                json!({
                    "signedIn": true,
                    "webUrl": session.web_url,
                    "token": session.token,
                    "email": session.email,
                })
            } else {
                json!({
                    "signedIn": false
                })
            };

            json_response(200, json!({ "data": session_data }), allowed_origin)
        }

        // Native messaging host status
        (&Method::Get, "/api/native-host/status") => {
            let exists = native_installer::is_native_host_installed();
            let manifest_path = native_installer::get_manifest_path();
            let host_path = native_installer::get_host_binary_path();
            json_response(
                200,
                json!({
                    "installed": exists,
                    "manifest_path": if exists { Some(manifest_path.to_string_lossy().to_string()) } else { None },
                    "host_path": host_path.to_string_lossy().to_string(),
                    "message": if exists { "Native host manifest registered" } else { "Native host manifest not registered" },
                }),
                allowed_origin,
            )
        }

        // Dynamic registration of extension ID
        (&Method::Post, "/api/native-host/register") => {
            #[derive(Deserialize)]
            struct RegisterPayload {
                #[serde(default)]
                extension_id: Option<String>,
                #[serde(default)]
                extension_ids: Option<Vec<String>>,
            }

            let payload: RegisterPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let mut ids: Vec<String> = Vec::new();
            if let Some(id) = payload.extension_id {
                let trimmed = id.trim().to_string();
                if !trimmed.is_empty() {
                    ids.push(trimmed);
                }
            }
            if let Some(list) = payload.extension_ids {
                for id in list {
                    let trimmed = id.trim().to_string();
                    if !trimmed.is_empty() && !ids.contains(&trimmed) {
                        ids.push(trimmed);
                    }
                }
            }

            if ids.is_empty() {
                return error_response(400, "extension_id or extension_ids is required", "invalid_request", allowed_origin);
            }

            for id in &ids {
                if !native_installer::is_allowed_extension_id(id) {
                    return forbidden_response();
                }
            }

            match install_native_host(&ids) {
                Ok(msg) => {
                    let manifest_path = native_installer::get_manifest_path();
                    let host_path = native_installer::get_host_binary_path();
                    json_response(
                        200,
                        json!({
                            "installed": true,
                            "manifest_path": manifest_path.to_string_lossy().to_string(),
                            "host_path": host_path.to_string_lossy().to_string(),
                            "message": msg,
                        }),
                        allowed_origin,
                    )
                }
                Err(e) => error_response(400, &e, "native_host_install_failed", allowed_origin),
            }
        }

        // List Folders
        (&Method::Get, "/api/folders") => {
            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::list_folders(&db_guard) {
                Ok(folders) => {
                    let list: Vec<Value> = folders
                        .into_iter()
                        .map(|f| {
                            json!({
                                "id": f.id,
                                "parent_id": f.parent_id,
                                "name": f.name,
                                "position": f.position,
                                "item_count": f.item_count.unwrap_or(0),
                            })
                        })
                        .collect();
                    json_response(200, json!(list), allowed_origin)
                }
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Create Folder
        (&Method::Post, "/api/folders") => {
            let payload: CreateFolderPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let trimmed = payload.name.trim();
            if trimmed.is_empty() {
                return error_response(400, "Folder name cannot be empty", "invalid_name", allowed_origin);
            }

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::create_folder(&db_guard, trimmed, payload.parent_id.as_deref()) {
                Ok(folder) => json_response(201, json!(folder), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Check URL
        (&Method::Post, "/api/check-url") | (&Method::Post, "/api/items/check") => {
            let payload: CheckUrlPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::check_url(&db_guard, &payload.url, &payload.folder_id) {
                Ok(check_result) => json_response(200, json!(check_result), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Save Grokipedia Article
        (&Method::Post, "/api/grokipedia") => {
            let payload: GrokipediaPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::save_grokipedia(&db_guard, &payload.url, &payload.folder_id, payload.html.as_deref()) {
                Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Capture Substack or X
        (&Method::Post, "/api/capture") => {
            let capture_req: CapturePayload = match serde_json::from_slice(body) {
                Ok(c) => c,
                Err(e) => return error_response(400, &format!("Invalid capture payload: {}", e), "invalid_request", allowed_origin),
            };

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };

            match capture_req {
                CapturePayload::Substack { folder_id, capture } => {
                    match service::save_substack(&db_guard, &folder_id, capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::SubstackUnavailable { folder_id, url, title } => {
                    match service::save_substack_unavailable(&db_guard, &folder_id, &url, &title) {
                        Ok(item) => json_response(200, json!({ "item": item, "unavailable": true }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Wikipedia { folder_id, capture } => {
                    match service::save_wikipedia(&db_guard, &folder_id, capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::YouTube { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "youtube", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Web { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "web", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Reddit { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "reddit", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Pdf { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "pdf", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::HackerNews { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "hackernews", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Bluesky { folder_id, capture } => {
                    match service::save_source(&db_guard, &folder_id, "bluesky", capture) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::SourceUnavailable {
                    folder_id,
                    source,
                    url,
                    title,
                    reason,
                } => {
                    match service::save_source_unavailable(
                        &db_guard,
                        &folder_id,
                        &source,
                        &url,
                        &title,
                        &reason,
                    ) {
                        Ok(item) => json_response(
                            200,
                            json!({ "item": item, "unavailable": true }),
                            allowed_origin,
                        ),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::X { folder_id, posts } => {
                    match service::save_x_thread(&db_guard, &folder_id, posts) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
                CapturePayload::Grokipedia { folder_id, url, html } => {
                    match service::save_grokipedia(&db_guard, &url, &folder_id, html.as_deref()) {
                        Ok(item) => json_response(200, json!({ "item": item }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    }
                }
            }
        }

        // Direct Item Creation (generic note or markdown document)
        (&Method::Post, "/api/items") => {
            let payload: CreateItemPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let title = payload.title.unwrap_or_else(|| "Untitled Note".to_string());
            let canonical = payload.canonical_url.or_else(|| {
                payload.source_url.as_ref().and_then(|u| service::canonicalize_url(u).ok())
            });

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };

            match service::save_generic_item(
                &db_guard,
                &payload.folder_id,
                &payload.kind,
                &title,
                payload.source_url,
                canonical,
                payload.markdown.as_deref(),
                payload.meta,
                payload.note.as_deref(),
                payload.position,
            ) {
                Ok(item) => json_response(201, json!(item), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // List Items
        (&Method::Get, "/api/items") => {
            let folder_id = parse_query_param(query, "folder_id")
                .or_else(|| parse_query_param(query, "folder"))
                .unwrap_or_else(|| "general".to_string());

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::list_items(&db_guard, &folder_id) {
                Ok(items) => json_response(200, json!(items), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Search Items
        (&Method::Get, "/api/items/search") => {
            let q = parse_query_param(query, "q").unwrap_or_default();
            let project_id = parse_query_param(query, "project_id")
                .or_else(|| parse_query_param(query, "folder_id"));

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::search_items(&db_guard, &q, project_id.as_deref()) {
                Ok(items) => json_response(200, json!(items), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Recent X Items
        (&Method::Get, "/api/x/recent") => {
            let folder_id = parse_query_param(query, "folder_id")
                .or_else(|| parse_query_param(query, "folder"))
                .unwrap_or_else(|| "general".to_string());

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::recent_x_items(&db_guard, &folder_id) {
                Ok(items) => json_response(200, json!(items), allowed_origin),
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Add Post to Existing X Thread (supports both /api/x/post?item_id=... and /api/x/:itemId/posts)
        (Method::Post, p) if p == "/api/x/post" || (p.starts_with("/api/x/") && p.ends_with("/posts")) => {
            let item_id = if p == "/api/x/post" {
                match parse_query_param(query, "item_id") {
                    Some(id) if !id.trim().is_empty() => id,
                    _ => return error_response(400, "Missing item_id query parameter", "invalid_request", allowed_origin),
                }
            } else {
                let stripped = p.strip_prefix("/api/x/").unwrap();
                let id = stripped.strip_suffix("/posts").unwrap_or(stripped);
                if id.trim().is_empty() {
                    return error_response(400, "Missing item_id in route path", "invalid_request", allowed_origin);
                }
                id.to_string()
            };

            let payload: AddXPostPayload = match serde_json::from_slice(body) {
                Ok(p) => p,
                Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
            };

            let db_guard = match db_arc.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::add_x_post(&db_guard, &item_id, payload.post, payload.parent_post_url) {
                Ok((returned_item_id, post_id)) => {
                    json_response(200, json!({ "item_id": returned_item_id, "post_id": post_id }), allowed_origin)
                }
                Err(e) => service_error_response(e, allowed_origin),
            }
        }

        // Dynamic Routes: /api/items/:id and /api/folders/:id
        _ => {
            if let Some(item_id) = path.strip_prefix("/api/items/") {
                let db_guard = match db_arc.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };

                match *method {
                    Method::Get => match service::get_item(&db_guard, item_id) {
                        Ok(item) => json_response(200, json!(item), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    },
                    Method::Delete => match service::delete_item(&db_guard, item_id) {
                        Ok(()) => json_response(200, json!({ "success": true }), allowed_origin),
                        Err(e) => service_error_response(e, allowed_origin),
                    },
                    Method::Patch => {
                        #[derive(Deserialize)]
                        struct PatchItemPayload {
                            #[serde(default)]
                            title: Option<String>,
                            #[serde(default)]
                            note: Option<String>,
                            #[serde(default)]
                            folder_id: Option<String>,
                            #[serde(default)]
                            markdown: Option<String>,
                        }

                        let payload: PatchItemPayload = match serde_json::from_slice(body) {
                            Ok(p) => p,
                            Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
                        };

                        if let Some(fid) = payload.folder_id.as_deref() {
                            if let Err(e) = service::move_item(&db_guard, item_id, fid) {
                                return error_response(400, &format!("Failed to move item: {}", e.message), "move_failed", allowed_origin);
                            }
                        }
                        if let Some(note_str) = payload.note.as_deref() {
                            let _ = service::update_item_note(&db_guard, item_id, Some(note_str));
                        }
                        if let Some(md) = payload.markdown.as_deref() {
                            let _ = service::update_note(&db_guard, item_id, payload.title.as_deref(), md);
                        } else if let Some(t) = payload.title.as_deref() {
                            let _ = service::rename_item(&db_guard, item_id, t);
                        }

                        match service::get_item(&db_guard, item_id) {
                            Ok(item) => json_response(200, json!(item), allowed_origin),
                            Err(e) => service_error_response(e, allowed_origin),
                        }
                    }
                    _ => error_response(404, "Endpoint not found", "not_found", allowed_origin),
                }
            } else if let Some(folder_id) = path.strip_prefix("/api/folders/") {
                let db_guard = match db_arc.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };

                match *method {
                    Method::Delete => {
                        if folder_id == "general" || folder_id == "inbox" {
                            return error_response(400, "Cannot delete default folder", "cannot_delete_default", allowed_origin);
                        }
                        match service::delete_folder(&db_guard, folder_id) {
                            Ok(()) => json_response(200, json!({ "success": true }), allowed_origin),
                            Err(e) => service_error_response(e, allowed_origin),
                        }
                    }
                    Method::Patch => {
                        #[derive(Deserialize)]
                        struct PatchFolderPayload {
                            #[serde(default)]
                            name: Option<String>,
                            #[serde(default)]
                            parent_id: Option<String>,
                            #[serde(default)]
                            position: Option<i32>,
                            #[serde(default)]
                            archived: Option<bool>,
                        }

                        let payload: PatchFolderPayload = match serde_json::from_slice(body) {
                            Ok(p) => p,
                            Err(e) => return error_response(400, &format!("Invalid JSON: {}", e), "invalid_json", allowed_origin),
                        };

                        if let Some(name) = payload.name.as_deref() {
                            let _ = service::rename_folder(&db_guard, folder_id, name);
                        }
                        if payload.parent_id.is_some() || payload.position.is_some() {
                            let current_folder = db_guard.get_folder(folder_id).ok();
                            let target_parent = payload.parent_id.as_deref().or(current_folder.as_ref().and_then(|f| f.parent_id.as_deref()));
                            let target_pos = payload.position.unwrap_or_else(|| current_folder.as_ref().map(|f| f.position).unwrap_or(0));
                            let _ = service::move_folder(&db_guard, folder_id, target_parent, target_pos);
                        }
                        if let Some(arch) = payload.archived {
                            let _ = db_guard.archive_project(folder_id, arch);
                        }

                        match db_guard.get_folder(folder_id) {
                            Ok(folder) => json_response(200, json!(folder), allowed_origin),
                            Err(e) => error_response(404, &format!("Folder not found: {}", e), "not_found", allowed_origin),
                        }
                    }
                    _ => error_response(404, "Endpoint not found", "not_found", allowed_origin),
                }
            } else {
                error_response(404, "Endpoint not found", "not_found", allowed_origin)
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Server Lifecycle & Loop
// -----------------------------------------------------------------------------

pub fn start_local_server(
    db: Arc<Mutex<Database>>,
    port: u16,
    app_handle: Option<tauri::AppHandle>,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        run_server(db, port, app_handle);
    })
}

/// Agent requests run on their own thread: a slow search or Substack fetch must not hold up the
/// extension's requests. More than this many at once are turned away.
const MAX_AGENT_REQUESTS: usize = 8;
static AGENT_REQUESTS_IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);

struct InFlightGuard;

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        AGENT_REQUESTS_IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
    }
}

pub fn run_server(db_arc: Arc<Mutex<Database>>, port: u16, app_handle: Option<tauri::AppHandle>) {
    let addr = format!("127.0.0.1:{}", port);
    let server = match Server::http(&addr) {
        Ok(s) => {
            eprintln!("[Sourcefold] Local HTTP server listening on http://{}", addr);
            s
        }
        Err(e) => {
            eprintln!("[Sourcefold] Failed to bind HTTP server to {}: {}", addr, e);
            return;
        }
    };

    // The agent routes need the running app and this run's key. The key is published in agent.json
    // only now that the port is ours, so a second app instance never replaces the first one's key.
    let agent_ctx: Option<AgentContext> = match (&app_handle, agent::current_key()) {
        (Some(app), Some(key)) => match agent::publish(port) {
            Ok(()) => Some(AgentContext {
                key: key.to_string(),
                host: Arc::new(agent::TauriHost { app: app.clone() }),
            }),
            Err(e) => {
                eprintln!("[Sourcefold] Couldn't write agent.json: {}", e);
                None
            }
        },
        _ => None,
    };

    for mut request in server.incoming_requests() {
        let url_raw = request.url().to_string();
        let (path, query) = match url_raw.split_once('?') {
            Some((p, q)) => (p, q),
            None => (url_raw.as_str(), ""),
        };

        // Read body if POST / PUT / PATCH
        let mut body_bytes = Vec::new();
        if request.method() == &Method::Post
            || request.method() == &Method::Put
            || request.method() == &Method::Patch
        {
            let mut reader = request.as_reader();
            let _ = std::io::copy(&mut reader, &mut body_bytes);
        }

        if let (Some(ctx), true) = (&agent_ctx, agent::is_agent_path(path)) {
            if AGENT_REQUESTS_IN_FLIGHT.fetch_add(1, Ordering::SeqCst) >= MAX_AGENT_REQUESTS {
                AGENT_REQUESTS_IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
                let _ = request.respond(error_response(
                    503,
                    "The app is busy. Try again in a moment.",
                    "busy",
                    None,
                ));
                continue;
            }
            let ctx = ctx.clone();
            let db = db_arc.clone();
            let method = request.method().clone();
            let path = path.to_string();
            let query = query.to_string();
            let headers: Vec<Header> = request.headers().to_vec();
            std::thread::spawn(move || {
                let _in_flight = InFlightGuard;
                let response = handle_request_with_agent(
                    &db,
                    &method,
                    &path,
                    &query,
                    &body_bytes,
                    &headers,
                    Some(&ctx),
                );
                let _ = request.respond(response);
            });
            continue;
        }

        let is_mutating = matches!(
            request.method(),
            &Method::Post | &Method::Put | &Method::Patch | &Method::Delete
        );

        let response = handle_request_with_agent(
            &db_arc,
            request.method(),
            path,
            query,
            &body_bytes,
            request.headers(),
            agent_ctx.as_ref(),
        );

        if is_mutating {
            if let Some(app) = &app_handle {
                use tauri::Emitter;
                let _ = app.emit("data-changed", ());
            }
        }

        let _ = request.respond(response);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn create_test_db() -> Arc<Mutex<Database>> {
        Arc::new(Mutex::new(Database::open_in_memory().unwrap()))
    }

    fn read_json_response(resp: Response<Cursor<Vec<u8>>>) -> Value {
        let mut body_str = String::new();
        resp.into_reader().read_to_string(&mut body_str).unwrap();
        serde_json::from_str(&body_str).unwrap_or(Value::Null)
    }

    fn standard_headers() -> Vec<Header> {
        let ext_origin = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);
        vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], ext_origin.as_bytes()).unwrap(),
        ]
    }

    #[test]
    fn test_server_session_endpoint() {
        let _guard = crate::session::TEST_SESSION_MUTEX.lock().unwrap();
        let db = create_test_db();
        let temp_dir = std::env::temp_dir().join(format!("srv_sess_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("session.json");
        crate::session::set_session_path_override(Some(session_file.clone()));

        // Case 1: Missing Origin without fallback header -> 403 Forbidden
        let headers_no_origin = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_no_origin);
        assert_eq!(resp.status_code().0, 403);
        assert!(!resp.headers().iter().any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Access-Control-Allow-Origin")));

        // Case 1b: Missing Origin WITH valid X-Sourcefold-Extension header -> 200 OK
        let headers_fallback_valid = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"X-Sourcefold-Extension"[..], native_installer::PINNED_EXTENSION_ID.as_bytes()).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_fallback_valid);
        assert_eq!(resp.status_code().0, 200);

        // Case 1c: Missing Origin WITH invalid X-Sourcefold-Extension header -> 403 Forbidden
        let headers_fallback_bad = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"X-Sourcefold-Extension"[..], &b"unauthorized_ext_id"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_fallback_bad);
        assert_eq!(resp.status_code().0, 403);

        // Case 2: Forbidden Origin -> 403 Forbidden without CORS header
        let headers_evil = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"https://evil.com"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_evil);
        assert_eq!(resp.status_code().0, 403);
        assert!(!resp.headers().iter().any(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Access-Control-Allow-Origin")));

        // Case 2b: Unauthorized extension Origin -> 403 Forbidden
        let headers_bad_ext = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"chrome-extension://unauthorized_ext_id"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_bad_ext);
        assert_eq!(resp.status_code().0, 403);

        // Case 3: Localhost Origin (valid for other endpoints, but session strictly requires chrome-extension)
        let headers_localhost = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"http://localhost:5173"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers_localhost);
        assert_eq!(resp.status_code().0, 403);

        // Case 4: Signed out state with valid extension Origin
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let json_body = read_json_response(resp);
        assert_eq!(json_body["data"]["signedIn"], false);

        // Case 5: Signed in state with valid extension Origin
        let sess = crate::session::Session {
            web_url: "https://web.sourcefold.app".to_string(),
            token: "valid_session_token_123".to_string(),
            email: Some("user@sourcefold.app".to_string()),
            signed_in_at: "2026-10-15T00:00:00Z".to_string(),
        };
        crate::session::save_session_to(&session_file, &sess).unwrap();

        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let json_body = read_json_response(resp);
        assert_eq!(json_body["data"]["signedIn"], true);
        assert_eq!(json_body["data"]["webUrl"], "https://web.sourcefold.app");
        assert_eq!(json_body["data"]["token"], "valid_session_token_123");
        assert_eq!(json_body["data"]["email"], "user@sourcefold.app");

        crate::session::clear_session_from(&session_file).unwrap();
        crate::session::set_session_path_override(None);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_server_cors_options_preflight() {
        let db = create_test_db();
        let ext_origin = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);

        // Preflight with valid extension origin
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], ext_origin.as_bytes()).unwrap(),
            Header::from_bytes(&b"Access-Control-Request-Method"[..], &b"POST"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Options, "/api/folders", "", &[], &headers);
        assert_eq!(resp.status_code().0, 204);

        let allow_origin = resp
            .headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Access-Control-Allow-Origin"))
            .map(|h| h.value.as_str().to_string());
        assert_eq!(allow_origin, Some(ext_origin));

        // Preflight with evil origin -> 403
        let headers_evil = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"https://evil.com"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Options, "/api/folders", "", &[], &headers_evil);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_server_folder_crud() {
        let db = create_test_db();

        // 1. List initial folders -> contains default inbox and general
        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let initial_folders = read_json_response(resp);
        assert!(initial_folders.is_array());
        let folders_arr = initial_folders.as_array().unwrap();
        assert!(folders_arr.iter().any(|f| f["id"] == "inbox"));
        assert!(folders_arr.iter().any(|f| f["id"] == "general"));

        // 2. Create project folder
        let create_body = serde_json::to_vec(&json!({ "name": "AI Safety" })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &create_body, &standard_headers());
        assert_eq!(resp.status_code().0, 201);
        let created_folder = read_json_response(resp);
        assert_eq!(created_folder["name"], "AI Safety");
        let project_id = created_folder["id"].as_str().unwrap().to_string();

        // 3. Create subfolder inside project
        let sub_body = serde_json::to_vec(&json!({ "name": "Alignment", "parent_id": project_id })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &sub_body, &standard_headers());
        assert_eq!(resp.status_code().0, 201);
        let sub_folder = read_json_response(resp);
        assert_eq!(sub_folder["name"], "Alignment");
        assert_eq!(sub_folder["parent_id"], project_id);
    }

    #[test]
    fn test_server_folders_crud() {
        let db = create_test_db();

        // 1. Create folder
        let create_body = serde_json::to_vec(&json!({
            "name": "Design Systems"
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &create_body, &standard_headers());
        assert_eq!(resp.status_code().0, 201);
        let folder = read_json_response(resp);
        assert_eq!(folder["name"], "Design Systems");
        let folder_id = folder["id"].as_str().unwrap().to_string();

        // 2. List folders
        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let list = read_json_response(resp);
        assert!(list.is_array());
        assert!(list.as_array().unwrap().iter().any(|f| f["id"] == folder_id));

        // 3. Rename folder via PATCH /api/folders/:id
        let patch_body = serde_json::to_vec(&json!({
            "name": "UI/UX Design Systems"
        })).unwrap();
        let patch_path = format!("/api/folders/{}", folder_id);
        let resp = handle_request(&db, &Method::Patch, &patch_path, "", &patch_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let updated = read_json_response(resp);
        assert_eq!(updated["name"], "UI/UX Design Systems");

        // 4. Archive folder
        let arch_body = serde_json::to_vec(&json!({
            "archived": true
        })).unwrap();
        let resp = handle_request(&db, &Method::Patch, &patch_path, "", &arch_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);

        // 5. Delete folder
        let resp = handle_request(&db, &Method::Delete, &patch_path, "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);

        // 6. Delete General folder must fail
        let resp = handle_request(&db, &Method::Delete, "/api/folders/general", "", &[], &standard_headers());
        assert_ne!(resp.status_code().0, 200);
    }

    #[test]
    fn test_server_check_url_workflow() {
        let db = create_test_db();

        // Create folder A
        let create_body_a = serde_json::to_vec(&json!({ "name": "Folder A", "parent_id": "inbox" })).unwrap();
        let resp_a = handle_request(&db, &Method::Post, "/api/folders", "", &create_body_a, &standard_headers());
        let folder_a_id = read_json_response(resp_a)["id"].as_str().unwrap().to_string();

        // Create folder B
        let create_body_b = serde_json::to_vec(&json!({ "name": "Folder B", "parent_id": "inbox" })).unwrap();
        let resp_b = handle_request(&db, &Method::Post, "/api/folders", "", &create_body_b, &standard_headers());
        let folder_b_id = read_json_response(resp_b)["id"].as_str().unwrap().to_string();

        let article_url = "https://example.com/deep-dive";

        // Check URL initially -> does not exist
        let check_body = serde_json::to_vec(&json!({
            "url": article_url,
            "folder_id": folder_a_id
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/check-url", "", &check_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_res = read_json_response(resp);
        assert_eq!(check_res["exists"], false);

        // Save article in folder A
        let cap_body = serde_json::to_vec(&json!({
            "kind": "substack",
            "folder_id": folder_a_id,
            "capture": {
                "url": article_url,
                "title": "Deep Dive Article",
                "markdown": "Detailed exploration."
            }
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &cap_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let item_id = read_json_response(resp)["item"]["id"].as_str().unwrap().to_string();

        // Check URL in folder A -> exists
        let resp = handle_request(&db, &Method::Post, "/api/items/check", "", &check_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_a = read_json_response(resp);
        assert_eq!(check_a["exists"], true);
        assert_eq!(check_a["item_id"], item_id);
        assert_eq!(check_a["folder_id"], folder_a_id);

        // Check URL from folder B -> duplicate detected, points to folder A
        let check_body_from_b = serde_json::to_vec(&json!({
            "url": article_url,
            "folder_id": folder_b_id
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/check-url", "", &check_body_from_b, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_b = read_json_response(resp);
        assert_eq!(check_b["exists"], false);
        assert_eq!(check_b["elsewhere"]["item_id"], item_id);
        assert_eq!(check_b["elsewhere"]["folder_id"], folder_a_id);
        assert_eq!(check_b["elsewhere"]["folder_path"], "Folder A");
    }

    #[test]
    fn test_server_items_check_url_and_duplicate_detection() {
        let db = create_test_db();

        // Create folder A
        let create_body = serde_json::to_vec(&json!({ "name": "Folder A", "parent_id": "inbox" })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &create_body, &standard_headers());
        let folder_a_id = read_json_response(resp)["id"].as_str().unwrap().to_string();

        // Create folder B
        let create_body_b = serde_json::to_vec(&json!({ "name": "Folder B", "parent_id": "inbox" })).unwrap();
        let resp_b = handle_request(&db, &Method::Post, "/api/folders", "", &create_body_b, &standard_headers());
        let folder_b_id = read_json_response(resp_b)["id"].as_str().unwrap().to_string();

        let article_url = "https://example.com/deep-dive";

        // Check URL initially -> does not exist
        let check_body = serde_json::to_vec(&json!({
            "url": article_url,
            "folder_id": folder_a_id
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/check-url", "", &check_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_res = read_json_response(resp);
        assert_eq!(check_res["exists"], false);

        // Save article in folder A
        let cap_body = serde_json::to_vec(&json!({
            "kind": "substack",
            "folder_id": folder_a_id,
            "capture": {
                "url": article_url,
                "title": "Deep Dive Article",
                "markdown": "Detailed exploration."
            }
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &cap_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let item_id = read_json_response(resp)["item"]["id"].as_str().unwrap().to_string();

        // Check URL in folder A -> exists
        let resp = handle_request(&db, &Method::Post, "/api/items/check", "", &check_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_a = read_json_response(resp);
        assert_eq!(check_a["exists"], true);
        assert_eq!(check_a["item_id"], item_id);
        assert_eq!(check_a["folder_id"], folder_a_id);

        // Check URL from folder B -> duplicate detected, points to folder A
        let check_body_from_b = serde_json::to_vec(&json!({
            "url": article_url,
            "folder_id": folder_b_id
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/check-url", "", &check_body_from_b, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let check_b = read_json_response(resp);
        assert_eq!(check_b["exists"], false);
        assert_eq!(check_b["elsewhere"]["item_id"], item_id);
        assert_eq!(check_b["elsewhere"]["folder_id"], folder_a_id);
        assert_eq!(check_b["elsewhere"]["folder_path"], "Folder A");
    }

    #[test]
    fn test_server_grokipedia_capture_from_html() {
        let db = create_test_db();
        let article_url = "https://grokipedia.com/page/Rust_Programming";
        let html_content = "<article><h1>Rust Programming</h1><p>Rust is memory safe.</p></article>";

        // Post Grokipedia article with HTML body
        let req_body = serde_json::to_vec(&json!({
            "url": article_url,
            "folder_id": "general",
            "html": html_content
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/grokipedia", "", &req_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let saved_item = read_json_response(resp)["item"].clone();
        assert_eq!(saved_item["title"], "Rust Programming");
        assert_eq!(saved_item["status"], "saved");
        assert!(saved_item["markdown"].as_str().unwrap().contains("Rust is memory safe."));

        // Posting duplicate URL returns 409 Conflict
        let resp_dup = handle_request(&db, &Method::Post, "/api/grokipedia", "", &req_body, &standard_headers());
        assert_eq!(resp_dup.status_code().0, 409);
        let dup_err = read_json_response(resp_dup);
        assert_eq!(dup_err["error"]["code"], "duplicate");

        // Also test through /api/capture with kind: "grokipedia"
        let cap_body = serde_json::to_vec(&json!({
            "kind": "grokipedia",
            "url": "https://grokipedia.com/page/Cargo_Tool",
            "folder_id": "general",
            "html": "<article><h1>Cargo Tool</h1><p>Cargo builds Rust code.</p></article>"
        })).unwrap();
        let resp_cap = handle_request(&db, &Method::Post, "/api/capture", "", &cap_body, &standard_headers());
        assert_eq!(resp_cap.status_code().0, 200);
        let cargo_item = read_json_response(resp_cap)["item"].clone();
        assert_eq!(cargo_item["title"], "Cargo Tool");
    }

    #[test]
    fn test_server_x_thread_capture_and_reply_and_recent() {
        let db = create_test_db();

        // 1. Capture initial thread
        let cap_body = serde_json::to_vec(&json!({
            "kind": "x",
            "folder_id": "general",
            "posts": [{
                "id": "2001",
                "post_url": "https://x.com/carol/status/2001",
                "author_name": "Carol",
                "handle": "carol",
                "author_url": "https://x.com/carol",
                "text": "Initial insight on distributed systems"
            }]
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &cap_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let item_id = read_json_response(resp)["item"]["id"].as_str().unwrap().to_string();

        // 2. Add reply post via POST /api/x/:itemId/posts
        let reply_body = serde_json::to_vec(&json!({
            "post": {
                "id": "2002",
                "post_url": "https://x.com/carol/status/2002",
                "author_name": "Carol",
                "handle": "carol",
                "author_url": "https://x.com/carol",
                "text": "Follow up reply with implementation details"
            },
            "parent_post_url": "https://x.com/carol/status/2001"
        })).unwrap();
        let reply_path = format!("/api/x/{}/posts", item_id);
        let resp = handle_request(&db, &Method::Post, &reply_path, "", &reply_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let add_res = read_json_response(resp);
        assert_eq!(add_res["item_id"], item_id);
        assert!(add_res["post_id"].as_str().is_some());

        // 3. Add second reply post via POST /api/x/post?item_id=...
        let reply_body_2 = serde_json::to_vec(&json!({
            "post": {
                "id": "2003",
                "post_url": "https://x.com/carol/status/2003",
                "author_name": "Carol",
                "handle": "carol",
                "author_url": "https://x.com/carol",
                "text": "Third tweet in thread"
            },
            "parent_post_url": "https://x.com/carol/status/2002"
        })).unwrap();
        let query_str = format!("item_id={}", item_id);
        let resp = handle_request(&db, &Method::Post, "/api/x/post", &query_str, &reply_body_2, &standard_headers());
        assert_eq!(resp.status_code().0, 200);

        // 4. Query /api/x/recent
        let resp = handle_request(&db, &Method::Get, "/api/x/recent", "folder_id=general", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let recent_items = read_json_response(resp);
        assert!(recent_items.is_array());
        assert_eq!(recent_items.as_array().unwrap().len(), 1);
        assert_eq!(recent_items[0]["id"], item_id);
    }

    #[test]
    fn test_server_substack_capture_and_unavailable_path() {
        let db = create_test_db();

        // 1. Success path
        let sub_body = serde_json::to_vec(&json!({
            "kind": "substack",
            "folder_id": "general",
            "capture": {
                "url": "https://newsletter.com/p/first",
                "title": "Newsletter First",
                "markdown": "Newsletter content."
            }
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &sub_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let sub_res = read_json_response(resp);
        assert_eq!(sub_res["item"]["status"], "saved");

        // 2. Unavailable error path
        let unavail_body = serde_json::to_vec(&json!({
            "kind": "substack_unavailable",
            "folder_id": "general",
            "url": "https://newsletter.com/p/paywalled",
            "title": "Paywalled Newsletter"
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &unavail_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let unavail_res = read_json_response(resp);
        assert_eq!(unavail_res["unavailable"], true);
        assert_eq!(unavail_res["item"]["status"], "unavailable");

        // 3. Invalid payload path
        let invalid_body = serde_json::to_vec(&json!({
            "kind": "unknown_format"
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &invalid_body, &standard_headers());
        assert_eq!(resp.status_code().0, 400);
    }

    #[test]
    fn test_server_item_rename_move_delete() {
        let db = create_test_db();

        // Create secondary folder
        let folder_b_body = serde_json::to_vec(&json!({ "name": "Archive Folder", "parent_id": "inbox" })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &folder_b_body, &standard_headers());
        let folder_b_id = read_json_response(resp)["id"].as_str().unwrap().to_string();

        // Save item in general folder
        let save_body = serde_json::to_vec(&json!({
            "kind": "substack",
            "folder_id": "general",
            "capture": {
                "url": "https://example.org/item-to-modify",
                "title": "Original Item Title",
                "markdown": "Original markdown content."
            }
        })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/capture", "", &save_body, &standard_headers());
        let item_id = read_json_response(resp)["item"]["id"].as_str().unwrap().to_string();
        let item_path = format!("/api/items/{}", item_id);

        // Get item
        let resp = handle_request(&db, &Method::Get, &item_path, "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);

        // Patch rename and note
        let patch_body = serde_json::to_vec(&json!({
            "title": "Renamed Item Title",
            "note": "Added research note"
        })).unwrap();
        let resp = handle_request(&db, &Method::Patch, &item_path, "", &patch_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let updated = read_json_response(resp);
        assert_eq!(updated["title"], "Renamed Item Title");
        assert_eq!(updated["note"], "Added research note");

        // Move to folder B
        let move_body = serde_json::to_vec(&json!({
            "folder_id": folder_b_id
        })).unwrap();
        let resp = handle_request(&db, &Method::Patch, &item_path, "", &move_body, &standard_headers());
        assert_eq!(resp.status_code().0, 200);
        let moved = read_json_response(resp);
        assert_eq!(moved["folder_id"], folder_b_id);

        // Delete item
        let resp = handle_request(&db, &Method::Delete, &item_path, "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 200);

        // Fetching deleted item returns 404
        let resp = handle_request(&db, &Method::Get, &item_path, "", &[], &standard_headers());
        assert_eq!(resp.status_code().0, 404);
    }

    #[test]
    fn test_is_valid_host() {
        assert!(is_valid_host("127.0.0.1:23456"));
        assert!(is_valid_host("localhost:23456"));
        assert!(is_valid_host("127.0.0.1"));
        assert!(is_valid_host("localhost"));

        assert!(!is_valid_host("evil.com:23456"));
        assert!(!is_valid_host("evil.com"));
        assert!(!is_valid_host("192.168.1.1:23456"));
        assert!(!is_valid_host(""));
    }

    #[test]
    fn test_is_allowed_origin() {
        let pinned = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);
        assert!(is_allowed_origin(&pinned));
        assert!(is_allowed_origin(&format!("{}/", pinned)));
        assert!(!is_allowed_origin("chrome-extension://malicious-extension-id"));

        assert!(is_allowed_origin("tauri://localhost"));
        assert!(is_allowed_origin("http://tauri.localhost"));
        assert!(is_allowed_origin("https://tauri.localhost"));
        assert!(is_allowed_origin("http://localhost:3000"));
        assert!(is_allowed_origin("http://127.0.0.1:3000"));

        #[cfg(debug_assertions)]
        {
            assert!(is_allowed_origin("http://localhost:5173"));
            assert!(is_allowed_origin("http://127.0.0.1:5173"));
        }

        assert!(!is_allowed_origin("https://evil.com"));
        assert!(!is_allowed_origin("http://attacker.com"));
        assert!(!is_allowed_origin("null"));
    }

    #[test]
    fn test_security_bad_host_rejected() {
        let db = create_test_db();
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"evil.com:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID).as_bytes()).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &headers);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_evil_origin_post_rejected() {
        let db = create_test_db();
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"https://evil.com"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", b"{}", &headers);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_extension_origin_allowed() {
        let db = create_test_db();
        let ext_origin = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], ext_origin.as_bytes()).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &headers);
        assert_eq!(resp.status_code().0, 200);

        let allow_origin = resp
            .headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Access-Control-Allow-Origin"))
            .map(|h| h.value.as_str().to_string());
        assert_eq!(allow_origin, Some(ext_origin));

        let vary = resp
            .headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Vary"))
            .map(|h| h.value.as_str().to_string());
        assert_eq!(vary, Some("Origin".to_string()));
    }

    #[test]
    fn test_security_unauthorized_extension_rejected() {
        let db = create_test_db();
        let bad_ext_origin = "chrome-extension://unauthorized_extension_id_here";
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], bad_ext_origin.as_bytes()).unwrap(),
        ];

        // 1. Session endpoint rejected
        let resp_sess = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers);
        assert_eq!(resp_sess.status_code().0, 403);

        // 2. Reading endpoint rejected
        let resp_read = handle_request(&db, &Method::Get, "/api/folders", "", &[], &headers);
        assert_eq!(resp_read.status_code().0, 403);

        // 3. Mutating endpoint rejected
        let check_body = serde_json::to_vec(&json!({
            "url": "https://example.com/test",
            "folder_id": "general"
        })).unwrap();
        let resp_post = handle_request(&db, &Method::Post, "/api/items/check", "", &check_body, &headers);
        assert_eq!(resp_post.status_code().0, 403);
    }

    #[test]
    fn test_security_native_host_register_allowed_and_unauthorized() {
        let db = create_test_db();

        // 1. Unauthorized extension ID in register -> 403 Forbidden
        let bad_payload = serde_json::to_vec(&json!({
            "extension_id": "unauthorized_extension_id_here"
        })).unwrap();
        let resp_bad = handle_request(&db, &Method::Post, "/api/native-host/register", "", &bad_payload, &standard_headers());
        assert_eq!(resp_bad.status_code().0, 403);

        // 2. Authorized extension ID in register -> 200 OK
        let good_payload = serde_json::to_vec(&json!({
            "extension_id": native_installer::PINNED_EXTENSION_ID
        })).unwrap();
        let resp_good = handle_request(&db, &Method::Post, "/api/native-host/register", "", &good_payload, &standard_headers());
        assert_eq!(resp_good.status_code().0, 200);
        let good_json = read_json_response(resp_good);
        assert_eq!(good_json["installed"], true);
    }

    #[test]
    fn test_security_no_origin_post_rejected() {
        let db = create_test_db();
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", b"{}", &headers);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_health_works_without_origin() {
        let db = create_test_db();
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/health", "", &[], &headers);
        assert_eq!(resp.status_code().0, 200);

        let status_resp = handle_request(&db, &Method::Get, "/api/status", "", &[], &headers);
        assert_eq!(status_resp.status_code().0, 200);
    }

    #[test]
    fn test_security_options_preflight_checked() {
        let db = create_test_db();

        // Valid OPTIONS preflight with pinned extension origin
        let ext_origin = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);
        let headers_valid = vec![
            Header::from_bytes(&b"Host"[..], &b"localhost:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], ext_origin.as_bytes()).unwrap(),
        ];
        let resp_valid = handle_request(&db, &Method::Options, "/api/folders", "", &[], &headers_valid);
        assert_eq!(resp_valid.status_code().0, 204);

        // Evil OPTIONS preflight
        let headers_evil = vec![
            Header::from_bytes(&b"Host"[..], &b"localhost:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"https://malicious-site.com"[..]).unwrap(),
        ];
        let resp_evil = handle_request(&db, &Method::Options, "/api/folders", "", &[], &headers_evil);
        assert_eq!(resp_evil.status_code().0, 403);

        // Unauthorized extension OPTIONS preflight
        let headers_bad_ext = vec![
            Header::from_bytes(&b"Host"[..], &b"localhost:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"chrome-extension://unauthorized-ext"[..]).unwrap(),
        ];
        let resp_bad_ext = handle_request(&db, &Method::Options, "/api/folders", "", &[], &headers_bad_ext);
        assert_eq!(resp_bad_ext.status_code().0, 403);
    }

    fn header_value(resp: &Response<Cursor<Vec<u8>>>, name: &str) -> Option<String> {
        resp.headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str().to_string())
    }

    fn header_only_identity(id: &str) -> Vec<Header> {
        vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"X-Sourcefold-Extension"[..], id.as_bytes()).unwrap(),
        ]
    }

    #[test]
    fn test_security_identity_header_without_origin_on_all_routes() {
        let db = create_test_db();
        let allowed = header_only_identity(native_installer::PINNED_EXTENSION_ID);
        let other = header_only_identity("someotherextensionidthatisnotallowed");

        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &allowed);
        assert_eq!(resp.status_code().0, 200);

        let body = serde_json::to_vec(&json!({ "name": "Header Folder" })).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &body, &allowed);
        assert_eq!(resp.status_code().0, 201);

        let resp = handle_request(&db, &Method::Get, "/api/folders", "", &[], &other);
        assert_eq!(resp.status_code().0, 403);
        let resp = handle_request(&db, &Method::Post, "/api/folders", "", &body, &other);
        assert_eq!(resp.status_code().0, 403);
        // Health checks are rejected too when they claim a non-allowed identity.
        let resp = handle_request(&db, &Method::Get, "/api/health", "", &[], &other);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_allowed_origin_with_foreign_identity_header_rejected() {
        let db = create_test_db();
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(
                &b"Origin"[..],
                format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID).as_bytes(),
            )
            .unwrap(),
            Header::from_bytes(&b"X-Sourcefold-Extension"[..], &b"foreignextensionid"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Get, "/api/session", "", &[], &headers);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_preflight_allows_identity_header_only_for_extensions() {
        let db = create_test_db();
        let ext_origin = format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID);
        let headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], ext_origin.as_bytes()).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Options, "/api/session", "", &[], &headers);
        assert_eq!(resp.status_code().0, 204);
        assert!(header_value(&resp, "Access-Control-Allow-Headers")
            .unwrap()
            .contains("X-Sourcefold-Extension"));

        // The Sourcefold web app's own origin never gets to send the identity header.
        let web_headers = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"http://localhost:3000"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Options, "/api/folders", "", &[], &web_headers);
        assert_eq!(resp.status_code().0, 204);
        assert!(!header_value(&resp, "Access-Control-Allow-Headers")
            .unwrap()
            .contains("X-Sourcefold-Extension"));

        // A preflight without an Origin is never answered, even with the identity header.
        let no_origin = header_only_identity(native_installer::PINNED_EXTENSION_ID);
        let resp = handle_request(&db, &Method::Options, "/api/folders", "", &[], &no_origin);
        assert_eq!(resp.status_code().0, 403);

        // A foreign extension cannot even preflight the identity header.
        let foreign = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"chrome-extension://foreignextensionid"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Options, "/api/session", "", &[], &foreign);
        assert_eq!(resp.status_code().0, 403);
    }

    #[test]
    fn test_security_register_rejects_foreign_ids_and_origins() {
        let db = create_test_db();
        let mixed = serde_json::to_vec(&json!({
            "extension_ids": [native_installer::PINNED_EXTENSION_ID, "foreignextensionid"]
        }))
        .unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/native-host/register", "", &mixed, &standard_headers());
        assert_eq!(resp.status_code().0, 403);

        // A foreign extension origin cannot register, even for the pinned ID.
        let pinned_only = serde_json::to_vec(&json!({
            "extension_id": native_installer::PINNED_EXTENSION_ID
        }))
        .unwrap();
        let foreign = vec![
            Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap(),
            Header::from_bytes(&b"Origin"[..], &b"chrome-extension://foreignextensionid"[..]).unwrap(),
        ];
        let resp = handle_request(&db, &Method::Post, "/api/native-host/register", "", &pinned_only, &foreign);
        assert_eq!(resp.status_code().0, 403);

        // No usable ID at all is a plain bad request.
        let empty = serde_json::to_vec(&json!({})).unwrap();
        let resp = handle_request(&db, &Method::Post, "/api/native-host/register", "", &empty, &standard_headers());
        assert_eq!(resp.status_code().0, 400);
    }

    struct NoopHost;

    impl agent::AgentHost for NoopHost {
        fn emit(&self, _event: &str, _payload: Value) {}
        fn focus_main_window(&self) {}
        fn search(&self, _request: &crate::search::query::SearchRequest) -> Result<Value, String> {
            Err("not used".to_string())
        }
        fn substack_fetch(&self, _url: &str, _with_cookie: bool) -> Result<Value, String> {
            Err("not used".to_string())
        }
    }

    #[test]
    fn test_agent_routes_are_gated_by_host_key_and_origin() {
        let db = create_test_db();
        let key = "k".repeat(64);
        let ctx = AgentContext { key: key.clone(), host: Arc::new(NoopHost) };
        let bearer = Header::from_bytes(&b"Authorization"[..], format!("Bearer {}", key).as_bytes()).unwrap();
        let host = Header::from_bytes(&b"Host"[..], &b"127.0.0.1:23456"[..]).unwrap();
        let call = |headers: &[Header], agent: Option<&AgentContext>| {
            handle_request_with_agent(&db, &Method::Post, "/api/agent/changed", "", b"{}", headers, agent)
                .status_code()
                .0
        };

        // Key and no Origin: allowed.
        assert_eq!(call(&[host.clone(), bearer.clone()], Some(&ctx)), 200);
        // The Host check still comes first.
        let bad_host = Header::from_bytes(&b"Host"[..], &b"evil.com"[..]).unwrap();
        assert_eq!(call(&[bad_host, bearer.clone()], Some(&ctx)), 403);
        // Any Origin, even an allowed extension's, is refused on agent routes.
        let origin = Header::from_bytes(
            &b"Origin"[..],
            format!("chrome-extension://{}", native_installer::PINNED_EXTENSION_ID).as_bytes(),
        )
        .unwrap();
        assert_eq!(call(&[host.clone(), bearer.clone(), origin], Some(&ctx)), 403);
        // No key, and no agent context at all.
        assert_eq!(call(&[host.clone()], Some(&ctx)), 403);
        assert_eq!(call(&[host.clone(), bearer.clone()], None), 403);
        // The plain entry point has no agent routes.
        let resp = handle_request(&db, &Method::Post, "/api/agent/changed", "", b"{}", &[host.clone(), bearer.clone()]);
        assert_eq!(resp.status_code().0, 403);

        // The key opens nothing else: other routes still need an allowed Origin or extension id.
        let resp = handle_request_with_agent(&db, &Method::Get, "/api/folders", "", &[], &[host, bearer], Some(&ctx));
        assert_eq!(resp.status_code().0, 403);
    }
}
