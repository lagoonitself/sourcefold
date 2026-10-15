use tauri::State;
use crate::db::Database;
use crate::models::Folder;
use crate::service;

#[tauri::command]
pub async fn get_folders(
    db: State<'_, Database>,
    include_archived: Option<bool>,
) -> Result<Vec<Folder>, String> {
    Ok(db.get_folders(include_archived.unwrap_or(false)))
}

#[tauri::command]
pub async fn get_projects(db: State<'_, Database>) -> Result<Vec<Folder>, String> {
    Ok(db.get_projects())
}

#[tauri::command]
pub async fn create_folder(
    db: State<'_, Database>,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    service::create_folder(&db, &name, parent_id.as_deref()).map_err(|e| e.message)
}

#[tauri::command]
pub async fn rename_folder(
    db: State<'_, Database>,
    id: String,
    name: String,
) -> Result<(), String> {
    service::rename_folder(&db, &id, &name).map_err(|e| e.message)
}

#[tauri::command]
pub async fn move_folder(
    db: State<'_, Database>,
    id: String,
    parent_id: Option<String>,
    position: i64,
) -> Result<(), String> {
    service::move_folder(&db, &id, parent_id.as_deref(), position as i32).map_err(|e| e.message)
}

#[tauri::command]
pub async fn delete_folder(db: State<'_, Database>, id: String) -> Result<(), String> {
    service::delete_folder(&db, &id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn archive_project(
    db: State<'_, Database>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    db.archive_project(&id, archived)
        .map_err(|e| e.to_string())
}
