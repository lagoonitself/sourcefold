use tauri::State;
use serde_json::Value;
use crate::db::Database;
use crate::models::{NativeHostStatus, Settings};
use crate::native_installer;

#[tauri::command]
pub async fn get_settings(db: State<'_, Database>) -> Result<Settings, String> {
    let storage_dir = db.get_setting("storage_dir")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| {
            dirs::document_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("Sourcefold")
                .to_string_lossy()
                .to_string()
        });

    let theme = db.get_setting("theme").map_err(|e| e.to_string())?;

    Ok(Settings {
        storage_dir,
        theme,
        native_host_installed: Some(native_installer::is_native_host_installed()),
        port: Some(23456),
    })
}

#[tauri::command]
pub async fn update_settings(
    db: State<'_, Database>,
    settings: Value,
) -> Result<(), String> {
    if let Some(storage_dir) = settings.get("storage_dir").and_then(|v| v.as_str()) {
        db.set_setting("storage_dir", storage_dir).map_err(|e| e.to_string())?;
    }
    if let Some(theme) = settings.get("theme").and_then(|v| v.as_str()) {
        db.set_setting("theme", theme).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn install_native_host(extension_ids: Option<Vec<String>>) -> Result<NativeHostStatus, String> {
    let ids = extension_ids.unwrap_or_default();
    match native_installer::install_native_host(&ids) {
        Ok(msg) => {
            let manifest_path = native_installer::get_manifest_path();
            let host_path = native_installer::get_host_binary_path();
            Ok(NativeHostStatus {
                installed: true,
                manifest_path: Some(manifest_path.to_string_lossy().to_string()),
                host_path: Some(host_path.to_string_lossy().to_string()),
                message: Some(msg),
            })
        }
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn get_native_host_status() -> Result<NativeHostStatus, String> {
    let manifest_path = native_installer::get_manifest_path();
    let host_path = native_installer::get_host_binary_path();
    let exists = native_installer::is_native_host_installed();

    Ok(NativeHostStatus {
        installed: exists,
        manifest_path: if exists { Some(manifest_path.to_string_lossy().to_string()) } else { None },
        host_path: Some(host_path.to_string_lossy().to_string()),
        message: if exists {
            Some("Native host manifest registered".to_string())
        } else {
            Some("Native host manifest not registered".to_string())
        },
    })
}
