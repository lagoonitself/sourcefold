use serde::Deserialize;
use tauri::State;

use crate::db::Database;
use crate::search::{
    self,
    query::{self, SearchRequest, SearchResponse},
    store,
    SearchStatus,
};

#[derive(Debug, Clone, serde::Serialize)]
pub struct EmbedJob {
    pub project_id: String,
    pub text_hash: String,
    /// Ready to embed, prefix included.
    pub input: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmbedVector {
    pub project_id: String,
    pub text_hash: String,
    pub vector: Vec<f32>,
}

fn join_error(e: impl std::fmt::Display) -> String {
    format!("Search stopped unexpectedly: {}", e)
}

#[tauri::command]
pub async fn search_query(request: SearchRequest) -> Result<SearchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || query::run(store::global(), &request))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn search_status(
    db: State<'_, Database>,
    project_id: Option<String>,
    model: Option<String>,
) -> Result<SearchStatus, String> {
    let db = db.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        search::status(&db, store::global(), project_id.as_deref(), model.as_deref())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn search_reindex_now() -> Result<(), String> {
    search::notify();
    Ok(())
}

#[tauri::command]
pub async fn search_set_paused(db: State<'_, Database>, paused: bool) -> Result<(), String> {
    search::set_paused(&db, paused)
}

#[tauri::command]
pub async fn search_delete_index() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let result = store::global().delete_all();
        search::notify();
        result
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn search_embed_jobs(
    model: String,
    limit: u32,
    prefer_project_id: Option<String>,
) -> Result<Vec<EmbedJob>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let rows = store::global().embed_jobs(
            &model,
            (limit as usize).min(1000),
            prefer_project_id.as_deref(),
        )?;
        Ok(rows
            .into_iter()
            .map(|r| EmbedJob { project_id: r.project_id, text_hash: r.text_hash, input: r.input })
            .collect())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn search_put_vectors(model: String, vectors: Vec<EmbedVector>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vectors: Vec<(String, String, Vec<f32>)> =
            vectors.into_iter().map(|v| (v.project_id, v.text_hash, v.vector)).collect();
        store::global().put_vectors(&model, &vectors).map(|_| ())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn search_delete_vectors() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| store::global().delete_vectors())
        .await
        .map_err(join_error)?
}
