use std::collections::HashMap;

use crate::web_fetch::{self, WebFetchOptions, WebFetchResponse};

/// Fetches a URL for the webview's source extractors. See `crate::web_fetch` for the rules
/// (allowed schemes, per-hop address checks, header allowlist, size and time limits).
#[tauri::command]
pub async fn web_fetch(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    response_type: Option<String>,
) -> Result<WebFetchResponse, String> {
    web_fetch::fetch(WebFetchOptions {
        url,
        method,
        headers: headers.unwrap_or_default(),
        body,
        response_type,
    })
    .await
}
