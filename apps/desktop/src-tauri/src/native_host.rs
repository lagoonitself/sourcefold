use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use serde_json::{json, Value};

use crate::db::Database;
use crate::service::{self, CapturePayload, ServiceError, XPostCapture};

// -----------------------------------------------------------------------------
// Chrome Native Messaging I/O Protocol
// -----------------------------------------------------------------------------

/// Reads a single native message from stdin.
/// Chrome sends: 4 bytes length (u32, native endian), then exact `len` bytes of UTF-8 JSON.
/// Returns Ok(None) on EOF (browser closed native messaging pipe).
pub fn read_native_message<R: Read>(reader: &mut R) -> io::Result<Option<Value>> {
    let mut len_bytes = [0u8; 4];
    match reader.read_exact(&mut len_bytes) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => {
            return Ok(None);
        }
        Err(e) => return Err(e),
    }

    let len = u32::from_ne_bytes(len_bytes) as usize;
    if len == 0 {
        return Ok(Some(Value::Null));
    }

    let mut buffer = vec![0u8; len];
    reader.read_exact(&mut buffer)?;

    let val = serde_json::from_slice(&buffer)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    Ok(Some(val))
}

/// Writes a single JSON native message to stdout.
/// Protocol: 4 bytes length (u32, native endian), followed by exact UTF-8 bytes.
pub fn write_native_message<W: Write>(writer: &mut W, value: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let len = bytes.len() as u32;
    writer.write_all(&len.to_ne_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()?;
    Ok(())
}

fn error_response(message: &str, code: &str) -> Value {
    json!({
        "error": {
            "message": message,
            "code": code
        }
    })
}

fn service_error_response(err: ServiceError) -> Value {
    json!({
        "error": err
    })
}

// -----------------------------------------------------------------------------
// Native Request Dispatcher
// -----------------------------------------------------------------------------

pub fn handle_native_request(db_mutex: &Arc<Mutex<Database>>, req: Value) -> Value {
    let action = match req
        .get("action")
        .or_else(|| req.get("type"))
        .and_then(Value::as_str)
    {
        Some(a) => a,
        None => return error_response("Missing 'action' or 'type' field", "invalid_request"),
    };

    match action {
        "ping" => json!({
            "status": "ok",
            "app": "sourcefold"
        }),

        "get_session" => {
            if let Some(session) = crate::session::load_session() {
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
            }
        }

        "list_folders" => {
            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::list_folders(&db) {
                Ok(folders) => {
                    let result: Vec<Value> = folders
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
                    json!(result)
                }
                Err(e) => service_error_response(e),
            }
        }

        "create_folder" => {
            let name = match req.get("name").and_then(Value::as_str) {
                Some(n) if !n.trim().is_empty() => n.trim(),
                _ => return error_response("Folder name is required", "invalid_request"),
            };
            let parent_id = req.get("parent_id").and_then(Value::as_str);

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::create_folder(&db, name, parent_id) {
                Ok(folder) => json!({
                    "id": folder.id,
                    "parent_id": folder.parent_id,
                    "name": folder.name,
                    "position": folder.position,
                    "item_count": folder.item_count.unwrap_or(0),
                    "created_at": folder.created_at,
                    "updated_at": folder.updated_at,
                }),
                Err(e) => service_error_response(e),
            }
        }

        "check_url" => {
            let raw_url = match req.get("url").and_then(Value::as_str) {
                Some(u) if !u.trim().is_empty() => u.trim(),
                _ => return error_response("URL is required", "invalid_request"),
            };
            let folder_id = match req.get("folder_id").and_then(Value::as_str) {
                Some(f) if !f.trim().is_empty() => f.trim(),
                _ => return error_response("Folder ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::check_url(&db, raw_url, folder_id) {
                Ok(check) => json!(check),
                Err(e) => service_error_response(e),
            }
        }

        "save_grokipedia" => {
            let raw_url = match req.get("url").and_then(Value::as_str) {
                Some(u) if !u.trim().is_empty() => u.trim(),
                _ => return error_response("URL is required", "invalid_request"),
            };
            let folder_id = match req.get("folder_id").and_then(Value::as_str) {
                Some(f) if !f.trim().is_empty() => f.trim(),
                _ => return error_response("Folder ID is required", "invalid_request"),
            };
            let html_override = req.get("html").and_then(Value::as_str);

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::save_grokipedia(&db, raw_url, folder_id, html_override) {
                Ok(item) => json!({ "item": item }),
                Err(e) => service_error_response(e),
            }
        }

        "capture" => {
            let payload_value = req.get("body").unwrap_or(&req).clone();
            let parsed_capture: Result<CapturePayload, _> = serde_json::from_value(payload_value);

            let capture_req = match parsed_capture {
                Ok(c) => c,
                Err(e) => return error_response(&format!("Invalid capture payload: {}", e), "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };

            match capture_req {
                CapturePayload::Substack { folder_id, capture } => {
                    match service::save_substack(&db, &folder_id, capture) {
                        Ok(item) => json!({ "item": item }),
                        Err(e) => service_error_response(e),
                    }
                }
                CapturePayload::SubstackUnavailable { folder_id, url, title } => {
                    match service::save_substack_unavailable(&db, &folder_id, &url, &title) {
                        Ok(item) => json!({ "item": item, "unavailable": true }),
                        Err(e) => service_error_response(e),
                    }
                }
                CapturePayload::X { folder_id, posts } => {
                    match service::save_x_thread(&db, &folder_id, posts) {
                        Ok(item) => json!({ "item": item }),
                        Err(e) => service_error_response(e),
                    }
                }
                CapturePayload::Grokipedia { folder_id, url, html } => {
                    match service::save_grokipedia(&db, &url, &folder_id, html.as_deref()) {
                        Ok(item) => json!({ "item": item }),
                        Err(e) => service_error_response(e),
                    }
                }
            }
        }

        "recent_x_items" => {
            let folder_id = match req.get("folder_id").and_then(Value::as_str) {
                Some(f) if !f.trim().is_empty() => f.trim(),
                _ => return error_response("Folder ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::recent_x_items(&db, folder_id) {
                Ok(items) => json!(items),
                Err(e) => service_error_response(e),
            }
        }

        "add_x_post" => {
            let item_id = match req
                .get("item_id")
                .or_else(|| req.get("itemId"))
                .and_then(Value::as_str)
            {
                Some(id) if !id.trim().is_empty() => id.trim(),
                _ => return error_response("Item ID is required", "invalid_request"),
            };

            let post_val = match req.get("post").cloned() {
                Some(p) => p,
                None => return error_response("Missing 'post' object", "invalid_request"),
            };

            let post: XPostCapture = match serde_json::from_value(post_val) {
                Ok(p) => p,
                Err(e) => return error_response(&format!("Invalid post payload: {}", e), "invalid_request"),
            };

            let parent_post_url = req
                .get("parent_post_url")
                .or_else(|| req.get("parentPostUrl"))
                .and_then(Value::as_str)
                .map(String::from);

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::add_x_post(&db, item_id, post, parent_post_url) {
                Ok((item_id_res, post_id_res)) => json!({
                    "item_id": item_id_res,
                    "post_id": post_id_res
                }),
                Err(e) => service_error_response(e),
            }
        }

        "list_items" => {
            let folder_id = match req.get("folder_id").and_then(Value::as_str) {
                Some(f) if !f.trim().is_empty() => f.trim(),
                _ => return error_response("Folder ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::list_items(&db, folder_id) {
                Ok(items) => json!(items),
                Err(e) => service_error_response(e),
            }
        }

        "get_item" => {
            let id = match req.get("id").and_then(Value::as_str) {
                Some(i) if !i.trim().is_empty() => i.trim(),
                _ => return error_response("Item ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::get_item(&db, id) {
                Ok(item) => json!(item),
                Err(e) => service_error_response(e),
            }
        }

        "delete_item" => {
            let id = match req.get("id").and_then(Value::as_str) {
                Some(i) if !i.trim().is_empty() => i.trim(),
                _ => return error_response("Item ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::delete_item(&db, id) {
                Ok(()) => json!({ "success": true }),
                Err(e) => service_error_response(e),
            }
        }

        "delete_folder" => {
            let id = match req.get("id").and_then(Value::as_str) {
                Some(i) if !i.trim().is_empty() => i.trim(),
                _ => return error_response("Folder ID is required", "invalid_request"),
            };

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::delete_folder(&db, id) {
                Ok(()) => json!({ "success": true }),
                Err(e) => service_error_response(e),
            }
        }

        "search_items" => {
            let query = req.get("query").and_then(Value::as_str).unwrap_or_default();
            let folder_id = req.get("folder_id").and_then(Value::as_str);

            let db = match db_mutex.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match service::search_items(&db, query, folder_id) {
                Ok(items) => json!(items),
                Err(e) => service_error_response(e),
            }
        }

        _ => error_response(&format!("Unknown native request type: {}", action), "unknown_action"),
    }
}

// -----------------------------------------------------------------------------
// Native Messaging Host Loop
// -----------------------------------------------------------------------------

/// Runs the Chrome Native Messaging host over standard input and output.
/// Gracefully terminates when stdin reaches EOF (pipe closed by browser).
pub fn run_native_messaging_host(db: Arc<Mutex<Database>>) -> Result<(), Box<dyn std::error::Error>> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    loop {
        match read_native_message(&mut stdin) {
            Ok(Some(msg)) => {
                let response = handle_native_request(&db, msg);
                write_native_message(&mut stdout, &response)?;
            }
            Ok(None) => {
                // EOF - Chrome closed the pipe, terminate gracefully
                break;
            }
            Err(e) => {
                let err_res = error_response(&format!("IO error reading message: {}", e), "io_error");
                let _ = write_native_message(&mut stdout, &err_res);
                break;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session;
    use std::io::Cursor;

    #[test]
    fn test_handle_native_ping() {
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));
        let res = handle_native_request(&db, json!({ "type": "ping" }));
        assert_eq!(res["status"], "ok");
        assert_eq!(res["app"], "sourcefold");
    }

    #[test]
    fn test_handle_native_create_and_list_folders() {
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));

        // Create folder
        let create_res = handle_native_request(
            &db,
            json!({
                "type": "create_folder",
                "name": "Native Research"
            }),
        );
        assert_eq!(create_res["name"], "Native Research");
        let folder_id = create_res["id"].as_str().unwrap().to_string();

        // List folders
        let list_res = handle_native_request(&db, json!({ "type": "list_folders" }));
        assert!(list_res.is_array());
        let list = list_res.as_array().unwrap();
        assert!(list.iter().any(|f| f["id"] == "general"));
        assert!(list.iter().any(|f| f["id"] == folder_id && f["name"] == "Native Research"));
    }

    #[test]
    fn test_handle_native_get_session() {
        let _guard = session::TEST_SESSION_MUTEX.lock().unwrap();
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));
        let temp_dir = std::env::temp_dir().join(format!("native_sess_{}", uuid::Uuid::new_v4()));
        let session_file = temp_dir.join("session.json");
        session::set_session_path_override(Some(session_file.clone()));

        // Signed out state
        let res_out = handle_native_request(&db, json!({ "type": "get_session" }));
        assert_eq!(res_out["signedIn"], false);

        // Signed in state
        let sess = session::Session {
            web_url: "https://web.sourcefold.app".to_string(),
            token: "native_token_999".to_string(),
            email: Some("native@sourcefold.app".to_string()),
            signed_in_at: "2026-10-15T00:00:00Z".to_string(),
        };
        session::save_session_to(&session_file, &sess).unwrap();

        let res_in = handle_native_request(&db, json!({ "type": "get_session" }));
        assert_eq!(res_in["signedIn"], true);
        assert_eq!(res_in["webUrl"], "https://web.sourcefold.app");
        assert_eq!(res_in["token"], "native_token_999");
        assert_eq!(res_in["email"], "native@sourcefold.app");

        session::clear_session_from(&session_file).unwrap();
        session::set_session_path_override(None);
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_handle_native_check_url() {
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));

        // Non-existent URL
        let check_res = handle_native_request(
            &db,
            json!({
                "type": "check_url",
                "url": "https://example.com/not-saved",
                "folder_id": "general"
            }),
        );
        assert_eq!(check_res["exists"], false);

        // Capture Substack article
        let cap_res = handle_native_request(
            &db,
            json!({
                "type": "capture",
                "kind": "substack",
                "folder_id": "general",
                "capture": {
                    "url": "https://example.substack.com/p/test-post",
                    "title": "Native Post",
                    "markdown": "Body content here"
                }
            }),
        );
        assert_eq!(cap_res["item"]["title"], "Native Post");
        let item_id = cap_res["item"]["id"].as_str().unwrap();

        // Check URL again -> exists
        let check_after = handle_native_request(
            &db,
            json!({
                "type": "check_url",
                "url": "https://example.substack.com/p/test-post",
                "folder_id": "general"
            }),
        );
        assert_eq!(check_after["exists"], true);
        assert_eq!(check_after["item_id"], item_id);
    }

    #[test]
    fn test_handle_native_capture_x_and_recent() {
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));

        let cap_res = handle_native_request(
            &db,
            json!({
                "type": "capture",
                "kind": "x",
                "folder_id": "general",
                "posts": [{
                    "id": "1001",
                    "url": "https://x.com/user/status/1001",
                    "author_name": "Bob",
                    "handle": "bob",
                    "author_url": "https://x.com/bob",
                    "text": "First tweet"
                }]
            }),
        );
        let item_id = cap_res["item"]["id"].as_str().unwrap().to_string();

        // Add reply post
        let add_res = handle_native_request(
            &db,
            json!({
                "type": "add_x_post",
                "item_id": item_id,
                "post": {
                    "id": "1002",
                    "url": "https://x.com/user/status/1002",
                    "author_name": "Bob",
                    "handle": "bob",
                    "author_url": "https://x.com/bob",
                    "text": "Second tweet"
                },
                "parent_post_url": "https://x.com/user/status/1001"
            }),
        );
        assert_eq!(add_res["item_id"], item_id);
        assert!(add_res["post_id"].as_str().is_some());

        // Get recent X items
        let recent_res = handle_native_request(
            &db,
            json!({
                "type": "recent_x_items",
                "folder_id": "general"
            }),
        );
        assert!(recent_res.is_array());
        assert_eq!(recent_res.as_array().unwrap().len(), 1);
        assert_eq!(recent_res[0]["id"], item_id);
    }

    #[test]
    fn test_handle_native_unknown_type() {
        let db = Arc::new(Mutex::new(Database::open_in_memory().unwrap()));
        let res = handle_native_request(&db, json!({ "type": "unsupported_command" }));
        assert_eq!(res["error"]["code"], "unknown_action");
        assert!(res["error"]["message"].as_str().unwrap().contains("Unknown native request type"));
    }

    #[test]
    fn test_native_messaging_io() {
        let payload = json!({
            "type": "ping",
            "message": "hello native host"
        });

        let mut buffer = Vec::new();
        write_native_message(&mut buffer, &payload).expect("write failed");

        assert!(buffer.len() > 4);
        let len = u32::from_ne_bytes(buffer[0..4].try_into().unwrap()) as usize;
        assert_eq!(len, buffer.len() - 4);

        let mut reader = Cursor::new(buffer);
        let read_back = read_native_message(&mut reader)
            .expect("read failed")
            .expect("expected Some message");

        assert_eq!(read_back["type"], "ping");
        assert_eq!(read_back["message"], "hello native host");
    }
}
