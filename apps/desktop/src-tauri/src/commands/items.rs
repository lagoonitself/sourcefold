use tauri::State;
use tauri_plugin_opener::OpenerExt;
use crate::db::Database;
use crate::models::{AddXPostRequest, CheckUrlResult, Item};
use crate::service::{self, CapturePayload};

#[tauri::command]
pub async fn get_items(db: State<'_, Database>, folder_id: String) -> Result<Vec<Item>, String> {
    Ok(db.get_items(&folder_id))
}

#[tauri::command]
pub async fn get_item(db: State<'_, Database>, id: String) -> Result<Item, String> {
    db.get_item(&id).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "Source not found".to_string(),
        other => other.to_string(),
    })
}

#[tauri::command]
pub async fn check_url(
    db: State<'_, Database>,
    url: String,
    folder_id: String,
) -> Result<CheckUrlResult, String> {
    service::check_url(&db, &url, &folder_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn save_grokipedia(
    db: State<'_, Database>,
    url: String,
    folder_id: String,
) -> Result<Item, String> {
    service::save_grokipedia(&db, &url, &folder_id, None).map_err(|e| e.message)
}

#[tauri::command]
pub async fn capture(
    db: State<'_, Database>,
    request: CapturePayload,
) -> Result<Item, String> {
    match request {
        CapturePayload::Substack { folder_id, capture } => {
            service::save_substack(&db, &folder_id, capture)
        }
        CapturePayload::SubstackUnavailable { folder_id, url, title } => {
            service::save_substack_unavailable(&db, &folder_id, &url, &title)
        }
        CapturePayload::X { folder_id, posts } => service::save_x_thread(&db, &folder_id, posts),
        CapturePayload::Grokipedia { folder_id, url, html } => {
            service::save_grokipedia(&db, &url, &folder_id, html.as_deref())
        }
    }
    .map_err(|e| e.message)
}

#[tauri::command]
pub async fn add_x_post(
    db: State<'_, Database>,
    req: AddXPostRequest,
) -> Result<(String, String), String> {
    let post = service::XPostCapture {
        post_url: req.post_url,
        author_name: req.author_name,
        handle: req.handle,
        author_url: req.author_url,
        posted_at: req.posted_at,
        text: req.text,
    };
    service::add_x_post(&db, &req.item_id, post, req.parent_post_url).map_err(|e| e.message)
}

#[tauri::command]
pub async fn rename_item(
    db: State<'_, Database>,
    id: String,
    title: String,
) -> Result<(), String> {
    service::rename_item(&db, &id, &title).map_err(|e| e.message)
}

#[tauri::command]
pub async fn move_item(
    db: State<'_, Database>,
    id: String,
    folder_id: String,
) -> Result<(), String> {
    service::move_item(&db, &id, &folder_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn delete_item(db: State<'_, Database>, id: String) -> Result<(), String> {
    service::delete_item(&db, &id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn update_item_note(
    db: State<'_, Database>,
    id: String,
    note: Option<String>,
) -> Result<(), String> {
    service::update_item_note(&db, &id, note.as_deref()).map_err(|e| e.message)
}

#[tauri::command]
pub async fn create_note(
    db: State<'_, Database>,
    folder_id: String,
    title: String,
    markdown: String,
) -> Result<Item, String> {
    service::create_note(&db, &folder_id, &title, &markdown).map_err(|e| e.message)
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Database>,
    id: String,
    title: Option<String>,
    markdown: String,
) -> Result<(), String> {
    service::update_note(&db, &id, title.as_deref(), &markdown).map_err(|e| e.message)
}

#[tauri::command]
pub async fn search_items(
    db: State<'_, Database>,
    query: String,
    project_id: Option<String>,
) -> Result<Vec<Item>, String> {
    db.search_items(&query, project_id.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_image(
    db: State<'_, Database>,
    folder_id: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
) -> Result<Item, String> {
    let bytes = service::decode_base64(&data_base64)?;
    service::save_image(&db, &folder_id, &file_name, &mime_type, &bytes).map_err(|e| e.message)
}

/// Opens an offline image with the system's default viewer.
#[tauri::command]
pub async fn open_item_file(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    let item = db.get_item(&id).map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => "Source not found".to_string(),
        other => other.to_string(),
    })?;
    let path = match (item.kind.as_str(), item.storage_path) {
        ("image", Some(path)) => path,
        _ => return Err("This source has no file to open.".to_string()),
    };
    let path_buf = if std::path::Path::new(&path).is_absolute() {
        std::path::PathBuf::from(&path)
    } else {
        service::resolve_storage_dir(&db).join(&path)
    };
    let is_image_file = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp"))
        .unwrap_or(false);
    if !is_image_file || !path_buf.is_file() {
        return Err("The image file is missing from disk.".to_string());
    }
    app.opener().open_path(path_buf.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}
