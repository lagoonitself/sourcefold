use tauri::State;
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
    db.add_x_post(req).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_item(
    db: State<'_, Database>,
    id: String,
    title: String,
) -> Result<(), String> {
    db.rename_item(&id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_item(
    db: State<'_, Database>,
    id: String,
    folder_id: String,
) -> Result<(), String> {
    db.move_item(&id, &folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_item(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_item(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_item_note(
    db: State<'_, Database>,
    id: String,
    note: Option<String>,
) -> Result<(), String> {
    db.update_item_note(&id, note.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_note(
    db: State<'_, Database>,
    folder_id: String,
    title: String,
    markdown: String,
) -> Result<Item, String> {
    db.create_standalone_note(&folder_id, &title, &markdown)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_note(
    db: State<'_, Database>,
    id: String,
    title: Option<String>,
    markdown: String,
) -> Result<(), String> {
    db.update_standalone_note(&id, title.as_deref(), &markdown)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_items(
    db: State<'_, Database>,
    query: String,
    project_id: Option<String>,
) -> Result<Vec<Item>, String> {
    db.search_items(&query, project_id.as_deref()).map_err(|e| e.to_string())
}
