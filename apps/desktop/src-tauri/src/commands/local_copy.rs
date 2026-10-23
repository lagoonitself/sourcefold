use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::db::Database;
use crate::local_copy::{self, LocalCopyReport};
use crate::service;

#[tauri::command]
pub async fn sync_local_copy(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<LocalCopyReport, String> {
    let db = db.inner().clone();
    Ok(local_copy::sync(&app, &db).await)
}

#[tauri::command]
pub async fn get_local_copy_enabled(db: State<'_, Database>) -> Result<bool, String> {
    Ok(local_copy::is_enabled(&db))
}

#[tauri::command]
pub async fn set_local_copy_enabled(db: State<'_, Database>, enabled: bool) -> Result<(), String> {
    local_copy::set_enabled(&db, enabled)
}

#[tauri::command]
pub async fn open_storage_folder(app: tauri::AppHandle, db: State<'_, Database>) -> Result<(), String> {
    let root = service::resolve_storage_dir(&db);
    std::fs::create_dir_all(&root).map_err(|e| format!("Couldn't create the folder: {}", e))?;
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
