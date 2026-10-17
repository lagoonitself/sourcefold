use tauri::State;
use crate::db::Database;
use crate::models::{Highlight, HighlightInput};
use crate::service;

#[tauri::command]
pub async fn list_highlights(
    db: State<'_, Database>,
    item_id: Option<String>,
    folder_id: Option<String>,
) -> Result<Vec<Highlight>, String> {
    service::list_highlights(&db, item_id.as_deref(), folder_id.as_deref()).map_err(|e| e.message)
}

#[tauri::command]
pub async fn put_highlight(
    db: State<'_, Database>,
    highlight: HighlightInput,
) -> Result<Highlight, String> {
    service::put_highlight(&db, highlight).map_err(|e| e.message)
}

#[tauri::command]
pub async fn update_highlight_note(
    db: State<'_, Database>,
    id: String,
    note: Option<String>,
) -> Result<Highlight, String> {
    service::update_highlight_note(&db, &id, note.as_deref()).map_err(|e| e.message)
}

#[tauri::command]
pub async fn delete_highlight(db: State<'_, Database>, id: String) -> Result<(), String> {
    service::delete_highlight(&db, &id).map_err(|e| e.message)
}
