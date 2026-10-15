use crate::substack::{self, CookieStatus, FetchResult};

#[tauri::command]
pub async fn substack_fetch(url: String, with_cookie: Option<bool>) -> Result<FetchResult, String> {
    substack::fetch(&url, with_cookie.unwrap_or(false)).await
}

#[tauri::command]
pub async fn get_substack_cookie() -> Result<CookieStatus, String> {
    Ok(substack::cookie_status())
}

#[tauri::command]
pub async fn set_substack_cookie(name: String, value: String) -> Result<CookieStatus, String> {
    substack::save_cookie(&name, &value)
}

#[tauri::command]
pub async fn clear_substack_cookie() -> Result<CookieStatus, String> {
    substack::clear_cookie()
}
