use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, State};

use crate::db::Database;
use crate::project_file::{self, ExportReport, ImportReport, ProjectFileSummary, RunControl};

/// Set by `project_file_cancel`; the running export or import stops at its next step. One runs
/// at a time (the dialog is modal), so one flag is enough.
static CANCEL: AtomicBool = AtomicBool::new(false);

/// The `project-file-progress` event: the same phases as `ProjectFileProgress` in core.
#[derive(Clone, Serialize)]
struct ProgressEvent<'a> {
    phase: &'a str,
    done: usize,
    total: usize,
}

fn emit_progress(app: &AppHandle) -> impl Fn(&str, usize, usize) + Sync + '_ {
    move |phase, done, total| {
        let _ = app.emit("project-file-progress", ProgressEvent { phase, done, total });
    }
}

/// Header that carries the (percent-encoded) path of `project_file_write`, because the request
/// body is the raw bytes of the zip.
const PATH_HEADER: &str = "x-project-file-path";

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() && value.is_char_boundary(i + 1) && value.is_char_boundary(i + 3) {
            if let Ok(b) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A path the user picked in a save or open dialog: absolute, and a project file.
fn checked_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let is_project_file = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("sourcefold") || e.eq_ignore_ascii_case("zip"));
    if !path.is_absolute() || !is_project_file {
        return Err("Choose a .sourcefold project file.".to_string());
    }
    Ok(path)
}

/// Writes the offline project to a `.sourcefold` file at `path`.
#[tauri::command]
pub async fn project_file_export(
    app: AppHandle,
    db: State<'_, Database>,
    project_id: String,
    path: String,
) -> Result<ExportReport, String> {
    let dest = checked_path(&path)?;
    let db = db.inner().clone();
    CANCEL.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let report = emit_progress(&app);
        project_file::export_project_file_with(&db, &project_id, &dest, &RunControl::new(&CANCEL, &report))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What a project file holds, after checking all of it, for the import preview.
#[tauri::command]
pub async fn project_file_inspect(path: String) -> Result<ProjectFileSummary, String> {
    let file = checked_path(&path)?;
    tauri::async_runtime::spawn_blocking(move || project_file::inspect_project_file(&file))
        .await
        .map_err(|e| e.to_string())?
}

/// Imports a project file as a new project.
#[tauri::command]
pub async fn project_file_import(
    app: AppHandle,
    db: State<'_, Database>,
    path: String,
) -> Result<ImportReport, String> {
    let file = checked_path(&path)?;
    let db = db.inner().clone();
    CANCEL.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let report = emit_progress(&app);
        project_file::import_project_file_with(&db, &file, &RunControl::new(&CANCEL, &report))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stops the running offline export or import at its next step.
#[tauri::command]
pub async fn project_file_cancel() -> Result<(), String> {
    CANCEL.store(true, Ordering::Relaxed);
    Ok(())
}

/// Saves the zip the webview built (signed in). The bytes are the raw request body; the path is
/// in the `x-project-file-path` header, percent-encoded.
#[tauri::command]
pub async fn project_file_write(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Couldn't write the project file: no data.".to_string());
    };
    let encoded = request
        .headers()
        .get(PATH_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Couldn't write the project file: no path.".to_string())?;
    let dest = checked_path(&percent_decode(encoded))?;
    let mut part = dest.clone().into_os_string();
    part.push(".part");
    let part = Path::new(&part);
    if let Err(err) = tokio::fs::write(part, bytes).await {
        let _ = tokio::fs::remove_file(part).await;
        return Err(format!("Couldn't write the project file: {}", err));
    }
    tokio::fs::rename(part, &dest).await.map_err(|err| {
        format!("Couldn't write the project file: {}", err)
    })
}

/// The bytes of a project file the user picked (signed in), for `readProjectFile` in the webview.
#[tauri::command]
pub async fn project_file_read(path: String) -> Result<Response, String> {
    let file = checked_path(&path)?;
    let meta = tokio::fs::metadata(&file)
        .await
        .map_err(|_| "Sourcefold couldn't read that file.".to_string())?;
    if meta.len() > 2 * 1024 * 1024 * 1024 {
        return Err("This project file is too big to open (over 2 GB).".to_string());
    }
    let bytes = tokio::fs::read(&file)
        .await
        .map_err(|_| "Sourcefold couldn't read that file.".to_string())?;
    Ok(Response::new(bytes))
}
