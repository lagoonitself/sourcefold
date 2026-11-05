//! The Link Shelf offline (signed in, the webview uses `/api/shelf` in the local API instead).

use tauri::State;

use crate::db::Database;
use crate::shelf_store::{ShelfAddResult, ShelfLink, ShelfLinkInput, ShelfLinkPatch};

#[tauri::command]
pub async fn list_shelf(db: State<'_, Database>) -> Result<Vec<ShelfLink>, String> {
    db.list_shelf().map_err(|e| e.message())
}

#[tauri::command]
pub async fn add_shelf_links(
    db: State<'_, Database>,
    links: Vec<ShelfLinkInput>,
) -> Result<ShelfAddResult, String> {
    db.add_shelf_links(&links).map_err(|e| e.message())
}

#[tauri::command]
pub async fn update_shelf_link(
    db: State<'_, Database>,
    id: String,
    patch: ShelfLinkPatch,
) -> Result<ShelfLink, String> {
    db.update_shelf_link(&id, &patch).map_err(|e| e.message())
}

#[tauri::command]
pub async fn delete_shelf_link(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.delete_shelf_link(&id).map_err(|e| e.message())
}

#[tauri::command]
pub async fn open_shelf_link(db: State<'_, Database>, id: String) -> Result<ShelfLink, String> {
    db.open_shelf_link(&id).map_err(|e| e.message())
}
