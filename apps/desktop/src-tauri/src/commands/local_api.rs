use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::local_api::{
    LocalApiBridge, LocalApiResponse, CONTENT_TYPE_HEADER, ID_HEADER, STATUS_HEADER,
};

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name).and_then(|v| v.to_str().ok())
}

/// The webview's answer to a `local-api-request`.
#[tauri::command]
pub fn local_api_respond(request: Request<'_>, bridge: State<'_, LocalApiBridge>) -> Result<(), String> {
    let id = header(&request, ID_HEADER)
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| "Missing request id.".to_string())?;
    let status = header(&request, STATUS_HEADER)
        .and_then(|v| v.parse::<u16>().ok())
        .ok_or_else(|| "Missing status.".to_string())?;
    let content_type = header(&request, CONTENT_TYPE_HEADER)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => Vec::new(),
    };
    bridge.resolve(id, LocalApiResponse { status, content_type, body });
    Ok(())
}
