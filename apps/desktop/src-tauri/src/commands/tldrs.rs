//! TL;DRs offline (signed in, the webview uses `/api/tldrs` in the local API instead).

use tauri::State;

use crate::db::Database;
use crate::tldr_store::{check_tldr_input, ItemTldr, ItemTldrInput};

#[tauri::command]
pub async fn list_tldrs(
    db: State<'_, Database>,
    folder_id: Option<String>,
    project_id: Option<String>,
) -> Result<Vec<ItemTldr>, String> {
    let result = match (folder_id, project_id) {
        (Some(f), None) => db.list_tldrs_for_folder(&f),
        (None, Some(p)) => db.list_tldrs_for_project(&p),
        _ => return Err("Give a folderId or a projectId.".into()),
    };
    result.map_err(|e| format!("Database error: {}", e))
}

#[tauri::command]
pub async fn put_tldr(
    db: State<'_, Database>,
    item_id: String,
    input: ItemTldrInput,
) -> Result<ItemTldr, String> {
    let (stored, model, hash) = check_tldr_input(&input)?;
    db.put_tldr(&item_id, &stored, &input.source, model.as_deref(), hash.as_deref())
        .map_err(|e| format!("Database error: {}", e))?
        .ok_or_else(|| "Item not found.".to_string())
}

#[tauri::command]
pub async fn delete_tldr(db: State<'_, Database>, item_id: String) -> Result<(), String> {
    db.delete_tldr(&item_id).map_err(|e| format!("Database error: {}", e))
}
