use tauri::State;
use crate::db::Database;
use crate::models::{
    Card, CardInput, CardPatch, Item, ItemResearchPatch, MergeResult, OutlineSection,
    OutlineSectionInput,
};
use crate::service;

#[tauri::command]
pub async fn list_project_items(
    db: State<'_, Database>,
    project_id: String,
) -> Result<Vec<Item>, String> {
    service::list_project_items(&db, &project_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn update_item_research(
    db: State<'_, Database>,
    id: String,
    patch: ItemResearchPatch,
) -> Result<Item, String> {
    service::update_item_research(&db, &id, patch).map_err(|e| e.message)
}

#[tauri::command]
pub async fn merge_items(
    db: State<'_, Database>,
    keep_id: String,
    ids: Vec<String>,
) -> Result<MergeResult, String> {
    service::merge_items(&db, &keep_id, &ids).map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_cards(
    db: State<'_, Database>,
    project_id: Option<String>,
    item_id: Option<String>,
) -> Result<Vec<Card>, String> {
    service::list_cards(&db, project_id.as_deref(), item_id.as_deref()).map_err(|e| e.message)
}

#[tauri::command]
pub async fn put_card(
    db: State<'_, Database>,
    card: CardInput,
) -> Result<Card, String> {
    service::put_card(&db, card).map_err(|e| e.message)
}

#[tauri::command]
pub async fn update_card(
    db: State<'_, Database>,
    id: String,
    patch: CardPatch,
) -> Result<Card, String> {
    service::update_card(&db, &id, patch).map_err(|e| e.message)
}

#[tauri::command]
pub async fn delete_card(
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    service::delete_card(&db, &id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_outline_sections(
    db: State<'_, Database>,
    project_id: String,
) -> Result<Vec<OutlineSection>, String> {
    service::list_outline_sections(&db, &project_id).map_err(|e| e.message)
}

#[tauri::command]
pub async fn put_outline_section(
    db: State<'_, Database>,
    section: OutlineSectionInput,
) -> Result<OutlineSection, String> {
    service::put_outline_section(&db, section).map_err(|e| e.message)
}

#[tauri::command]
pub async fn delete_outline_section(
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    service::delete_outline_section(&db, &id).map_err(|e| e.message)
}
