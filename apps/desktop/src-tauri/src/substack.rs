//! Fetches Substack pages for the webview, which runs the shared extractor from `@sourcefold/core`.
//!
//! The user's Substack login cookie (for paid posts they subscribe to) is stored only on this
//! computer and is attached only to `substack.com`, `*.substack.com`, or a custom domain this app
//! has already seen serving a Substack page. Redirects are followed by hand so the cookie is
//! re-checked for every host.

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const MAX_REDIRECTS: usize = 6;
const MAX_BODY_BYTES: usize = 25 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
pub const COOKIE_NAMES: [&str; 2] = ["substack.sid", "connect.sid"];

static COOKIE_PATH_OVERRIDE: RwLock<Option<PathBuf>> = RwLock::new(None);

fn verified_hosts() -> &'static Mutex<HashSet<String>> {
    static HOSTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    HOSTS.get_or_init(|| Mutex::new(HashSet::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredCookie {
    pub name: String,
    pub value: String,
    pub saved_at: String,
}

/// What the UI sees. Never includes the cookie value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CookieStatus {
    pub configured: bool,
    pub name: Option<String>,
    pub saved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FetchResult {
    pub status: u16,
    /// Final URL after redirects.
    pub url: String,
    pub text: String,
    pub retry_after: Option<u64>,
    /// Whether the cookie went with the final request.
    pub cookie_sent: bool,
}

pub fn set_cookie_path_override(path: Option<PathBuf>) {
    if let Ok(mut lock) = COOKIE_PATH_OVERRIDE.write() {
        *lock = path;
    }
}

fn cookie_path() -> PathBuf {
    if let Ok(lock) = COOKIE_PATH_OVERRIDE.read() {
        if let Some(p) = lock.as_ref() {
            return p.clone();
        }
    }
    crate::session::app_data_dir().join("substack_cookie.json")
}

pub fn load_cookie() -> Option<StoredCookie> {
    let text = fs::read_to_string(cookie_path()).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn cookie_status() -> CookieStatus {
    match load_cookie() {
        Some(c) => CookieStatus { configured: true, name: Some(c.name), saved_at: Some(c.saved_at) },
        None => CookieStatus { configured: false, name: None, saved_at: None },
    }
}

/// Accepts the bare value, `name=value`, or a whole pasted Cookie header.
pub fn normalize_cookie_value(name: &str, raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_matches('"').trim();
    let mut value = trimmed.to_string();
    if trimmed.contains('=') {
        let prefix = format!("{}=", name);
        value = trimmed
            .split(';')
            .map(|part| part.trim())
            .find_map(|part| part.strip_prefix(&prefix).map(|v| v.to_string()))
            .ok_or_else(|| format!("Couldn't find {} in what you pasted.", name))?;
    }
    let value = value.trim().trim_matches('"').to_string();
    if value.is_empty() {
        return Err("Paste the cookie value.".to_string());
    }
    if value.chars().any(|c| c.is_control() || c == ';' || c == ' ') {
        return Err("That doesn't look like a cookie value.".to_string());
    }
    Ok(value)
}

pub fn save_cookie(name: &str, raw_value: &str) -> Result<CookieStatus, String> {
    if !COOKIE_NAMES.contains(&name) {
        return Err("Unknown cookie name.".to_string());
    }
    let value = normalize_cookie_value(name, raw_value)?;
    let stored = StoredCookie {
        name: name.to_string(),
        value,
        saved_at: chrono::Utc::now().to_rfc3339(),
    };
    let path = cookie_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(cookie_status())
}

pub fn clear_cookie() -> Result<CookieStatus, String> {
    let path = cookie_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(cookie_status())
}

pub fn is_substack_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h == "substack.com" || h.ends_with(".substack.com")
}

fn may_send_cookie(url: &reqwest::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else { return false };
    if is_substack_host(host) {
        return true;
    }
    verified_hosts()
        .lock()
        .map(|hosts| hosts.contains(&host.to_ascii_lowercase()))
        .unwrap_or(false)
}

/// A page is Substack's when it carries Substack's preloads and CDN assets.
pub fn looks_like_substack_page(text: &str) -> bool {
    text.contains("window._preloads") && text.contains("substackcdn.com")
}

fn remember_host(url: &reqwest::Url) {
    if let Some(host) = url.host_str() {
        if let Ok(mut hosts) = verified_hosts().lock() {
            hosts.insert(host.to_ascii_lowercase());
        }
    }
}

fn parse_target(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw.trim()).map_err(|_| "That isn't a valid link.".to_string())?;
    match url.scheme() {
        "https" | "http" => Ok(url),
        _ => Err("Only web links can be fetched.".to_string()),
    }
}

pub async fn fetch(raw_url: &str, with_cookie: bool) -> Result<FetchResult, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(40))
        .connect_timeout(Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let cookie = if with_cookie { load_cookie() } else { None };
    let mut url = parse_target(raw_url)?;

    for _ in 0..=MAX_REDIRECTS {
        let send_cookie = cookie.is_some() && may_send_cookie(&url);
        let mut request = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, "text/html,application/json,application/xml;q=0.9,*/*;q=0.8")
            .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9");
        if send_cookie {
            if let Some(c) = &cookie {
                request = request.header(reqwest::header::COOKIE, format!("{}={}", c.name, c.value));
            }
        }

        let mut response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                "Substack took too long to answer.".to_string()
            } else {
                "Couldn't reach Substack. Check your connection.".to_string()
            }
        })?;
        let status = response.status();

        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "Substack sent a redirect without a target.".to_string())?;
            url = url.join(location).map_err(|_| "Substack sent a bad redirect.".to_string())?;
            if url.scheme() != "https" && url.scheme() != "http" {
                return Err("Substack sent a bad redirect.".to_string());
            }
            continue;
        }

        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse::<u64>().ok());

        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if body.len() + chunk.len() > MAX_BODY_BYTES {
                return Err("That page is too large to save.".to_string());
            }
            body.extend_from_slice(&chunk);
        }
        let text = String::from_utf8_lossy(&body).into_owned();

        if status.is_success() && looks_like_substack_page(&text) {
            remember_host(&url);
        }

        return Ok(FetchResult {
            status: status.as_u16(),
            url: url.to_string(),
            text,
            retry_after,
            cookie_sent: send_cookie,
        });
    }

    Err("Too many redirects.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pasted_cookie_forms() {
        assert_eq!(normalize_cookie_value("substack.sid", " s%3Aabc.def ").unwrap(), "s%3Aabc.def");
        assert_eq!(
            normalize_cookie_value("substack.sid", "substack.sid=s%3Aabc; other=1").unwrap(),
            "s%3Aabc"
        );
        assert_eq!(
            normalize_cookie_value("connect.sid", "a=1; connect.sid=s%3Axyz").unwrap(),
            "s%3Axyz"
        );
        assert!(normalize_cookie_value("substack.sid", "other=1").is_err());
        assert!(normalize_cookie_value("substack.sid", "  ").is_err());
        assert!(normalize_cookie_value("substack.sid", "has space").is_err());
    }

    #[test]
    fn cookie_only_goes_to_substack_or_verified_hosts() {
        let sub = reqwest::Url::parse("https://name.substack.com/p/x").unwrap();
        let root = reqwest::Url::parse("https://substack.com/api").unwrap();
        let plain_http = reqwest::Url::parse("http://name.substack.com/p/x").unwrap();
        let other = reqwest::Url::parse("https://cookie-test-unverified.example/p/x").unwrap();
        let lookalike = reqwest::Url::parse("https://evilsubstack.com/p/x").unwrap();
        assert!(may_send_cookie(&sub));
        assert!(may_send_cookie(&root));
        assert!(!may_send_cookie(&plain_http));
        assert!(!may_send_cookie(&other));
        assert!(!may_send_cookie(&lookalike));

        let custom = reqwest::Url::parse("https://cookie-test-verified.example/p/x").unwrap();
        assert!(!may_send_cookie(&custom));
        remember_host(&custom);
        assert!(may_send_cookie(&custom));
    }

    #[test]
    fn stores_and_clears_cookie_in_override_path() {
        let dir = std::env::temp_dir().join(format!("sourcefold-substack-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        set_cookie_path_override(Some(dir.join("substack_cookie.json")));

        assert!(!cookie_status().configured);
        let status = save_cookie("substack.sid", "substack.sid=s%3Aabc").unwrap();
        assert!(status.configured);
        assert_eq!(status.name.as_deref(), Some("substack.sid"));
        assert_eq!(load_cookie().unwrap().value, "s%3Aabc");
        assert!(save_cookie("bogus", "x").is_err());
        assert!(!clear_cookie().unwrap().configured);

        set_cookie_path_override(None);
        let _ = fs::remove_dir_all(&dir);
    }
}
