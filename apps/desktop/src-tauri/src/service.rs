use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::Duration;
use chrono::Utc;
use regex::Regex;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::db::Database;
use crate::models::{
    AddXPostRequest, CheckUrlResult, Folder, Highlight, HighlightInput, Item, RecentXItem,
    SaveItemRequest,
};

// -----------------------------------------------------------------------------
// Compiled Regexes (LazyLock)
// -----------------------------------------------------------------------------

static REF_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"ref-(\d+)").expect("invalid REF_ID_RE regex"));
static DIGITS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+").expect("invalid DIGITS_RE regex"));
static CITATION_RUN_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\^\d+\](?:\s*\[\^\d+\])*").expect("invalid CITATION_RUN_RE regex"));
static CITATION_ITEM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\^(\d+)\]").expect("invalid CITATION_ITEM_RE regex"));
static WHITESPACE_COLLAPSE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("invalid WHITESPACE_COLLAPSE_RE regex"));
static X_I_WEB_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/i/web/status/([^/]+)(?:/.*)?$").expect("invalid X_I_WEB_RE regex"));
static X_STATUS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/([^/]+)/status/([^/]+)(?:/.*)?$").expect("invalid X_STATUS_RE regex"));

// --- The 2026-10 source kinds (packages/core/src/source-links.ts mirrors these) ---

/// A YAML 1.1 sexagesimal number like `3:33` or `1:02:10`; a video duration must be quoted.
static YAML_TIME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9]+(:[0-9]{1,2})+$").expect("invalid YAML_TIME_RE regex"));
/// A plain decimal number written as text (`532`, `2401.01234`); the source kinds write those bare.
static NUMBER_TEXT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)$").expect("invalid NUMBER_TEXT_RE regex")
});
static YT_VIDEO_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{11}$").expect("invalid YT_VIDEO_ID_RE regex"));
static YT_PLAYLIST_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_-]{2,64}$").expect("invalid YT_PLAYLIST_ID_RE regex"));
static YT_EMBED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(?:shorts|live|embed|v|e)/([^/]+)$").expect("invalid YT_EMBED_RE regex")
});
static YT_HANDLE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(@[^/]+)(?:/(?:videos|shorts|streams|featured|playlists))?$")
        .expect("invalid YT_HANDLE_RE regex")
});
static YT_CHANNEL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(channel|c|user)/([^/]+)(?:/(?:videos|shorts|streams|featured|playlists))?$")
        .expect("invalid YT_CHANNEL_RE regex")
});
static REDDIT_IN_SUB_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/r/([A-Za-z0-9_]{2,32})/comments/([A-Za-z0-9]{3,12})(?:/.*)?$")
        .expect("invalid REDDIT_IN_SUB_RE regex")
});
static REDDIT_BARE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/comments/([A-Za-z0-9]{3,12})(?:/.*)?$").expect("invalid REDDIT_BARE_RE regex")
});
static REDDIT_SHARE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/r/([A-Za-z0-9_]{2,32})/s/([A-Za-z0-9]+)$").expect("invalid REDDIT_SHARE_RE regex")
});
static REDDIT_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9]{3,12}$").expect("invalid REDDIT_ID_RE regex"));
static HN_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9]{1,12}$").expect("invalid HN_ID_RE regex"));
static BSKY_POST_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/profile/([^/]+)/post/([A-Za-z0-9]{2,32})$").expect("invalid BSKY_POST_RE regex")
});
static ARXIV_PATH_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^/(?:abs|pdf|html)/(.+?)(?:\.pdf)?$").expect("invalid ARXIV_PATH_RE regex")
});
static ARXIV_NEW_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([0-9]{4}\.[0-9]{4,5})(v[0-9]+)?$").expect("invalid ARXIV_NEW_ID_RE regex")
});
static ARXIV_OLD_ID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^([a-z-]+(?:\.[A-Z]{2})?/[0-9]{7})(v[0-9]+)?$").expect("invalid ARXIV_OLD_ID_RE regex")
});
static SUBSTACK_POST_PATH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/p/[^/]+$").expect("invalid SUBSTACK_POST_PATH_RE regex"));

pub fn dedupe_citation_runs(input: &str) -> String {
    CITATION_RUN_RE.replace_all(input, |caps: &regex::Captures| {
        let matched = caps.get(0).unwrap().as_str();
        let mut seen = HashSet::new();
        let mut ordered_citations = Vec::new();
        for item in CITATION_ITEM_RE.captures_iter(matched) {
            let num = item.get(1).unwrap().as_str();
            if seen.insert(num.to_string()) {
                ordered_citations.push(format!("[^{}]", num));
            }
        }
        ordered_citations.join("")
    }).to_string()
}

pub fn collapse_duplicate_citations(input: &str) -> String {
    dedupe_citation_runs(input)
}

// -----------------------------------------------------------------------------
// Shared Data Types
// -----------------------------------------------------------------------------

fn default_access() -> String {
    "free".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XPostCapture {
    #[serde(rename = "postUrl", alias = "post_url", alias = "url")]
    pub post_url: String,
    #[serde(default, rename = "authorName", alias = "author_name")]
    pub author_name: String,
    #[serde(default)]
    pub handle: String,
    #[serde(default, rename = "authorUrl", alias = "author_url")]
    pub author_url: String,
    #[serde(default, rename = "postedAt", alias = "posted_at")]
    pub posted_at: Option<String>,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone)]
pub struct XTreeNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub position: i32,
    pub post_url: String,
    pub author_name: String,
    pub handle: String,
    pub author_url: String,
    pub posted_at: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstackCapture {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default, rename = "authorUrl", alias = "author_url")]
    pub author_url: Option<String>,
    #[serde(default)]
    pub publication: Option<String>,
    #[serde(default, rename = "publicationUrl", alias = "publication_url")]
    pub publication_url: Option<String>,
    #[serde(default)]
    pub published: Option<String>,
    #[serde(default = "default_access")]
    pub access: String,
    #[serde(default)]
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikipediaCapture {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default, rename = "lastEdited", alias = "last_edited")]
    pub last_edited: Option<String>,
    #[serde(default)]
    pub markdown: String,
}

/// The source kinds added on 2026-10-16 (docs/FILE-FORMAT.md).
pub const SOURCE_CAPTURE_KINDS: &[&str] =
    &["youtube", "web", "reddit", "pdf", "hackernews", "bluesky"];

pub fn is_source_capture_kind(kind: &str) -> bool {
    SOURCE_CAPTURE_KINDS.contains(&kind)
}

/// One capture for the kinds above: the `url` and `title` front matter plus the kind's own
/// fields in `meta`, keyed exactly as in docs/FILE-FORMAT.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceCapture {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub meta: serde_json::Map<String, Value>,
    #[serde(default)]
    pub markdown: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum CapturePayload {
    #[serde(rename = "substack")]
    Substack {
        folder_id: String,
        capture: SubstackCapture,
    },
    #[serde(rename = "wikipedia")]
    Wikipedia {
        folder_id: String,
        capture: WikipediaCapture,
    },
    #[serde(rename = "youtube")]
    YouTube {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "web")]
    Web {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "reddit")]
    Reddit {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "pdf")]
    Pdf {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "hackernews")]
    HackerNews {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "bluesky")]
    Bluesky {
        folder_id: String,
        capture: SourceCapture,
    },
    #[serde(rename = "source_unavailable")]
    SourceUnavailable {
        folder_id: String,
        source: String,
        url: String,
        title: String,
        reason: String,
    },
    #[serde(rename = "substack_unavailable")]
    SubstackUnavailable {
        folder_id: String,
        url: String,
        title: String,
    },
    #[serde(rename = "x")]
    X {
        folder_id: String,
        posts: Vec<XPostCapture>,
    },
    #[serde(rename = "grokipedia")]
    Grokipedia {
        folder_id: String,
        url: String,
        #[serde(default)]
        html: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrokReference {
    pub number: usize,
    pub title: String,
    pub url: String,
    pub domain: String,
}

#[derive(Debug, Clone)]
pub struct GrokipediaArticle {
    pub title: String,
    pub summary: Option<String>,
    pub fact_checked_at: Option<String>,
    pub body_markdown: String,
    pub references: Vec<GrokReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
}

impl ServiceError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self {
            code: "invalid_request".into(),
            message: msg.into(),
            item_id: None,
            folder_id: None,
            folder_name: None,
        }
    }

    pub fn duplicate(
        message: String,
        item_id: Option<String>,
        folder_id: Option<String>,
        folder_name: Option<String>,
    ) -> Self {
        Self {
            code: "duplicate".into(),
            message,
            item_id,
            folder_id,
            folder_name,
        }
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self {
            code: "not_found".into(),
            message: msg.into(),
            item_id: None,
            folder_id: None,
            folder_name: None,
        }
    }

    pub fn internal(msg: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: msg.into(),
            item_id: None,
            folder_id: None,
            folder_name: None,
        }
    }
}

// -----------------------------------------------------------------------------
// Canonicalization & Slugification
// -----------------------------------------------------------------------------

fn decode_uri_component(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            if let (Some(h1), Some(h2)) = (chars.next(), chars.next()) {
                let hex_slice = [h1, h2];
                if let Ok(hex_str) = std::str::from_utf8(&hex_slice) {
                    if let Ok(byte) = u8::from_str_radix(hex_str, 16) {
                        bytes.push(byte);
                        continue;
                    }
                }
                bytes.push(b'%');
                bytes.push(h1);
                bytes.push(h2);
            } else {
                bytes.push(b'%');
            }
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

/// Percent-decoding without the `+`-means-space rule of `decode_uri_component` (URL `pathname`
/// decoding, matching JS `decodeURIComponent`).
fn decode_percent_encoding(s: &str) -> String {
    let mut bytes = Vec::with_capacity(s.len());
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            match (chars.next(), chars.next()) {
                (Some(h1), Some(h2)) => {
                    let hex_slice = [h1, h2];
                    let byte = std::str::from_utf8(&hex_slice)
                        .ok()
                        .and_then(|hex| u8::from_str_radix(hex, 16).ok());
                    match byte {
                        Some(byte) => bytes.push(byte),
                        None => {
                            bytes.push(b'%');
                            bytes.push(h1);
                            bytes.push(h2);
                        }
                    }
                }
                (Some(h1), None) => {
                    bytes.push(b'%');
                    bytes.push(h1);
                }
                _ => bytes.push(b'%'),
            }
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

/// The host of a URL, lowercased and without a leading `www.`, as the source lines name it.
fn host_without_www(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_lowercase();
    Some(host.strip_prefix("www.").map(str::to_string).unwrap_or(host))
}

fn canonical_youtube_url(host: &str, path: &str, query: &[(String, String)]) -> Option<String> {
    let param = |name: &str| query.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone());

    if host == "youtu.be" {
        let id = path.split('/').nth(1).unwrap_or("");
        return YT_VIDEO_ID_RE
            .is_match(id)
            .then(|| format!("https://www.youtube.com/watch?v={}", id));
    }
    if !matches!(
        host,
        "youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtube-nocookie.com"
    ) {
        return None;
    }

    if path == "/watch" {
        let id = param("v").unwrap_or_default();
        return YT_VIDEO_ID_RE
            .is_match(&id)
            .then(|| format!("https://www.youtube.com/watch?v={}", id));
    }
    if let Some(caps) = YT_EMBED_RE.captures(path) {
        let id = &caps[1];
        return YT_VIDEO_ID_RE
            .is_match(id)
            .then(|| format!("https://www.youtube.com/watch?v={}", id));
    }
    if path == "/playlist" {
        let list = param("list").unwrap_or_default();
        return YT_PLAYLIST_ID_RE
            .is_match(&list)
            .then(|| format!("https://www.youtube.com/playlist?list={}", list));
    }
    if let Some(caps) = YT_HANDLE_RE.captures(path) {
        return Some(format!("https://www.youtube.com/{}", caps[1].to_lowercase()));
    }
    if let Some(caps) = YT_CHANNEL_RE.captures(path) {
        return Some(format!("https://www.youtube.com/{}/{}", &caps[1], &caps[2]));
    }
    None
}

fn canonical_reddit_url(host: &str, path: &str) -> Option<String> {
    if host == "redd.it" {
        let id = path.split('/').nth(1).unwrap_or("").to_lowercase();
        return REDDIT_ID_RE
            .is_match(&id)
            .then(|| format!("https://www.reddit.com/comments/{}", id));
    }
    if !matches!(
        host,
        "reddit.com"
            | "old.reddit.com"
            | "new.reddit.com"
            | "np.reddit.com"
            | "m.reddit.com"
            | "i.reddit.com"
    ) {
        return None;
    }

    if let Some(caps) = REDDIT_IN_SUB_RE.captures(path) {
        return Some(format!(
            "https://www.reddit.com/r/{}/comments/{}",
            caps[1].to_lowercase(),
            caps[2].to_lowercase()
        ));
    }
    if let Some(caps) = REDDIT_BARE_RE.captures(path) {
        return Some(format!(
            "https://www.reddit.com/comments/{}",
            caps[1].to_lowercase()
        ));
    }
    // Share links keep their own path: the redirect target needs a request to resolve.
    if REDDIT_SHARE_RE.is_match(path) {
        return Some(format!("https://www.reddit.com{}", path));
    }
    None
}

fn canonical_hackernews_url(host: &str, path: &str, query: &[(String, String)]) -> Option<String> {
    if host != "news.ycombinator.com" || path != "/item" {
        return None;
    }
    let id = query
        .iter()
        .find(|(k, _)| k == "id")
        .map(|(_, v)| v.as_str())
        .unwrap_or("");
    HN_ID_RE
        .is_match(id)
        .then(|| format!("https://news.ycombinator.com/item?id={}", id))
}

fn canonical_bluesky_url(host: &str, path: &str) -> Option<String> {
    if host != "bsky.app" {
        return None;
    }
    let caps = BSKY_POST_RE.captures(path)?;
    let raw_actor = decode_percent_encoding(&caps[1]);
    let actor = if raw_actor.starts_with("did:") {
        raw_actor
    } else {
        raw_actor.to_lowercase()
    };
    Some(format!("https://bsky.app/profile/{}/post/{}", actor, &caps[2]))
}

fn canonical_arxiv_url(host: &str, path: &str) -> Option<String> {
    if host != "arxiv.org" && host != "export.arxiv.org" {
        return None;
    }
    let caps = ARXIV_PATH_RE.captures(path)?;
    let raw = decode_percent_encoding(&caps[1]);
    let parts = ARXIV_NEW_ID_RE
        .captures(&raw)
        .or_else(|| ARXIV_OLD_ID_RE.captures(&raw))?;
    Some(format!("https://arxiv.org/abs/{}", &parts[1]))
}

/// Parameters that only track where a click came from (packages/core/src/source-links.ts).
const TRACKING_PARAMS: &[&str] = &[
    "fbclid",
    "gclid",
    "dclid",
    "gbraid",
    "wbraid",
    "msclkid",
    "yclid",
    "mc_cid",
    "mc_eid",
    "igshid",
    "si",
    "smid",
    "_hsenc",
    "_hsmi",
    "mkt_tok",
    "ref",
    "ref_src",
    "ref_url",
];

/// Encodes like JS `URLSearchParams.toString()`: spaces become `+`, everything outside
/// `A-Za-z0-9*-._` is percent-encoded.
fn form_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{:02X}", other)),
        }
    }
    out
}

/// The query a canonical address keeps for an ordinary web page: every parameter except `utm_*`
/// and the tracking ones above, in the original order. Empty string when none is left.
fn meaningful_query(url: &reqwest::Url) -> String {
    let mut kept: Vec<String> = Vec::new();
    for (name, value) in url.query_pairs() {
        let lower = name.to_lowercase();
        if lower.starts_with("utm_") || TRACKING_PARAMS.contains(&lower.as_str()) {
            continue;
        }
        kept.push(format!("{}={}", form_encode(&name), form_encode(&value)));
    }
    if kept.is_empty() {
        String::new()
    } else {
        format!("?{}", kept.join("&"))
    }
}

pub fn canonicalize_url(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|e| format!("Cannot parse URL: \"{}\": {}", input, e))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(format!(
            "Unsupported protocol \"{}\" in URL: \"{}\"",
            parsed.scheme(),
            input
        ));
    }

    let raw_host = parsed.host_str().unwrap_or("").to_lowercase();
    let normalized_host = if let Some(stripped) = raw_host.strip_prefix("www.") {
        stripped
    } else {
        &raw_host
    };

    let mut host = normalized_host.to_string();
    if let Some(port) = parsed.port() {
        if port != 80 && port != 443 {
            host = format!("{}:{}", host, port);
        }
    }

    let pathname = parsed.path().trim_end_matches('/').to_string();

    let is_x = matches!(
        normalized_host,
        "x.com" | "twitter.com" | "mobile.x.com" | "mobile.twitter.com"
    );

    if is_x {
        if let Some(caps) = X_I_WEB_RE.captures(&pathname) {
            return Ok(format!("https://x.com/i/status/{}", &caps[1]));
        }

        if let Some(caps) = X_STATUS_RE.captures(&pathname) {
            let handle = caps[1].to_lowercase();
            let id = &caps[2];
            return Ok(format!("https://x.com/{}/status/{}", handle, id));
        }

        return Ok(if pathname.is_empty() {
            "https://x.com".to_string()
        } else {
            format!("https://x.com{}", pathname)
        });
    }

    if host == "grokipedia.com" {
        if let Some(raw_title) = pathname.strip_prefix("/page/") {
            let decoded = decode_uri_component(raw_title)
                .replace(' ', "_")
                .replace('%', "%25")
                .replace('#', "%23")
                .replace('?', "%3F");
            return Ok(format!("https://grokipedia.com/page/{}", decoded));
        }

        return Ok(if pathname.is_empty() {
            "https://grokipedia.com".to_string()
        } else {
            format!("https://grokipedia.com{}", pathname)
        });
    }

    // YouTube, Reddit, Hacker News, Bluesky and arXiv: one address per video, post or paper.
    let query: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let source = canonical_youtube_url(normalized_host, &pathname, &query)
        .or_else(|| canonical_reddit_url(normalized_host, &pathname))
        .or_else(|| canonical_hackernews_url(normalized_host, &pathname, &query))
        .or_else(|| canonical_bluesky_url(normalized_host, &pathname))
        .or_else(|| canonical_arxiv_url(normalized_host, &pathname));
    if let Some(canonical) = source {
        return Ok(canonical);
    }

    // Everything else: path kept as is (case preserved), plus the query parameters that pick the
    // page (not `utm_*` and other click tracking). Substack posts never need a query.
    let is_substack_post =
        normalized_host.ends_with("substack.com") || SUBSTACK_POST_PATH_RE.is_match(&pathname);
    let query = if is_substack_post {
        String::new()
    } else {
        meaningful_query(&parsed)
    };

    Ok(if pathname.is_empty() {
        format!("https://{}{}", host, query)
    } else {
        format!("https://{}{}{}", host, pathname, query)
    })
}

pub fn slugify(title: &str, max_len: usize) -> String {
    let mut slug = String::new();
    let mut prev_is_dash = true;

    for ch in title.chars() {
        if ch.is_alphanumeric() {
            for lower in ch.to_lowercase() {
                slug.push(lower);
            }
            prev_is_dash = false;
        } else if !prev_is_dash {
            slug.push('-');
            prev_is_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.chars().count() > max_len {
        let truncated: String = slug.chars().take(max_len).collect();
        let trimmed = truncated.trim_end_matches('-');
        if trimmed.is_empty() {
            "untitled".to_string()
        } else {
            trimmed.to_string()
        }
    } else if slug.is_empty() {
        "untitled".to_string()
    } else {
        slug
    }
}

// -----------------------------------------------------------------------------
// Safe Names and Paths (docs/FILE-FORMAT.md)
// -----------------------------------------------------------------------------

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn safe_name(name: &str) -> String {
    // 1. Start from title or folder name.
    // 2. Colon becomes " -", slashes, backslashes, pipes become "-".
    let mut s = String::with_capacity(name.len() + 8);
    for c in name.chars() {
        match c {
            ':' => s.push_str(" -"),
            '/' | '\\' | '|' => s.push('-'),
            // 3. Remove < > " ? * and control characters.
            '<' | '>' | '"' | '?' | '*' => {},
            c if c.is_control() => {},
            other => s.push(other),
        }
    }

    // 4. Collapse runs of whitespace to one space; trim spaces and dots from both ends.
    let mut collapsed = String::with_capacity(s.len());
    let mut in_whitespace = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !in_whitespace {
                collapsed.push(' ');
                in_whitespace = true;
            }
        } else {
            collapsed.push(c);
            in_whitespace = false;
        }
    }
    let trimmed = collapsed.trim_matches(|c: char| c == ' ' || c == '.');

    // 5. Cut to 100 characters at the last word break and trim again.
    let cut = if trimmed.chars().count() > 100 {
        let s100: String = trimmed.chars().take(100).collect();
        let truncated = if let Some(last_space) = s100.rfind(' ') {
            &s100[..last_space]
        } else {
            &s100
        };
        truncated.trim_matches(|c: char| c == ' ' || c == '.').to_string()
    } else {
        trimmed.to_string()
    };

    // 6. Empty result: "Untitled". Windows reserved name: append " (file)".
    if cut.is_empty() {
        return "Untitled".to_string();
    }

    for reserved in WINDOWS_RESERVED_NAMES {
        if cut.eq_ignore_ascii_case(reserved) {
            return format!("{} (file)", cut);
        }
    }

    cut
}

pub fn format_yaml_string(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }

    let is_boolean_or_null = matches!(
        s.to_ascii_lowercase().as_str(),
        "true" | "false" | "yes" | "no" | "null" | "~"
    );

    let is_numeric = s.parse::<f64>().is_ok();

    // A duration like `3:33` or `1:02:10` is a YAML 1.1 sexagesimal number, so quote it.
    let is_time_code = YAML_TIME_RE.is_match(s);

    let starts_with_special = s.starts_with(|c: char| {
        matches!(
            c,
            '-' | '?' | ':' | ',' | '[' | ']' | '{' | '}' | '#' | '&' | '*' | '!' | '|' | '>' | '\'' | '"' | '%' | '@' | '`'
        )
    });

    let has_whitespace_boundary = s.starts_with(' ') || s.ends_with(' ');

    let has_yaml_control = s.contains(": ")
        || s.ends_with(':')
        || s.contains(" #")
        || s.ends_with('#')
        || s.contains('\n')
        || s.contains('\r')
        || s.contains('\t');

    if is_boolean_or_null
        || is_numeric
        || is_time_code
        || starts_with_special
        || has_whitespace_boundary
        || has_yaml_control
    {
        let escaped = s
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
            .replace('\t', "\\t");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

pub fn resolve_storage_dir(db: &Database) -> PathBuf {
    if let Ok(Some(custom_dir)) = db.get_setting("storage_dir") {
        let path = PathBuf::from(custom_dir);
        if path.is_absolute() {
            return path;
        }
    }
    #[cfg(test)]
    {
        std::env::temp_dir().join(format!("sourcefold-test-{}", std::process::id()))
    }
    #[cfg(not(test))]
    dirs::document_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Sourcefold")
}

pub fn resolve_folder_path(db: &Database, folder_id: &str) -> (PathBuf, String) {
    if folder_id == "general" || folder_id.is_empty() {
        return (PathBuf::from("Unsorted"), String::new());
    }

    let mut disk_segments = Vec::new();
    let mut display_segments = Vec::new();
    let mut current_id = Some(folder_id.to_string());
    let mut visited = HashSet::new();

    while let Some(fid) = current_id {
        if fid == "general" || !visited.insert(fid.clone()) {
            break;
        }
        if let Ok(folder) = db.get_folder(&fid) {
            disk_segments.push(safe_name(&folder.name));
            display_segments.push(folder.name);
            current_id = folder.parent_id;
        } else {
            break;
        }
    }

    if disk_segments.is_empty() {
        return (PathBuf::from("Unsorted"), String::new());
    }

    disk_segments.reverse();
    display_segments.reverse();
    let rel_path = disk_segments.iter().collect::<PathBuf>();
    let display_str = display_segments.join("/");
    (rel_path, display_str)
}

pub fn resolve_item_filename(
    db: &Database,
    folder_id: &str,
    item_id: &str,
    title: &str,
    ext: &str,
    created_at: &str,
) -> String {
    let base_name = safe_name(title);
    let clean_ext = ext.trim_start_matches('.').to_ascii_lowercase();

    let mut candidates: Vec<(String, String)> = Vec::new();
    let mut found_self = false;

    for it in db.get_items(folder_id) {
        if it.deleted_at.is_some() {
            continue;
        }
        let it_base = safe_name(&it.title);
        if !it_base.eq_ignore_ascii_case(&base_name) {
            continue;
        }
        let it_ext = if it.kind == "image" {
            it.storage_path
                .as_deref()
                .and_then(|p| Path::new(p).extension().and_then(|e| e.to_str()))
                .unwrap_or("png")
                .to_ascii_lowercase()
        } else {
            "md".to_string()
        };
        if it_ext.eq_ignore_ascii_case(&clean_ext) {
            if it.id == item_id {
                found_self = true;
            }
            candidates.push((it.id.clone(), it.created_at.clone()));
        }
    }

    if !found_self {
        candidates.push((item_id.to_string(), created_at.to_string()));
    }

    candidates.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));

    let index = candidates.iter().position(|c| c.0 == item_id).unwrap_or(0);
    if index == 0 {
        format!("{}.{}", base_name, clean_ext)
    } else {
        format!("{} ({}).{}", base_name, index + 1, clean_ext)
    }
}

pub fn write_item_file_to_disk(
    db: &Database,
    folder_id: &str,
    item_id: &str,
    title: &str,
    ext: &str,
    created_at: &str,
    bytes: &[u8],
) -> Result<(PathBuf, String), ServiceError> {
    let storage_root = resolve_storage_dir(db);
    let (rel_dir, _) = resolve_folder_path(db, folder_id);
    let target_dir = storage_root.join(&rel_dir);
    fs::create_dir_all(&target_dir).map_err(|e| {
        ServiceError::internal(format!("Couldn't create directory: {}", e), "io_error")
    })?;

    let filename = resolve_item_filename(db, folder_id, item_id, title, ext, created_at);
    let file_path = target_dir.join(&filename);
    fs::write(&file_path, bytes).map_err(|e| {
        ServiceError::internal(format!("Couldn't save file to disk: {}", e), "io_error")
    })?;

    let rel_path = rel_dir.join(&filename);
    let rel_str = rel_path.to_string_lossy().replace('\\', "/");
    let _ = db.update_item_storage_path(item_id, &rel_str);

    Ok((file_path, rel_str))
}

pub fn save_markdown_file_to_disk(
    storage_root: &Path,
    rel_dir: &Path,
    title: &str,
    _item_id: &str,
    markdown: &str,
) -> io::Result<PathBuf> {
    let target_dir = storage_root.join(rel_dir);
    fs::create_dir_all(&target_dir)?;
    let filename = format!("{}.md", safe_name(title));
    let file_path = target_dir.join(filename);
    fs::write(&file_path, markdown.as_bytes())?;
    Ok(file_path)
}

pub fn is_safe_to_delete(path: &Path, storage_root: &Path) -> bool {
    if path.as_os_str().is_empty() || path == storage_root {
        return false;
    }

    // Reject any path containing a parent directory (`..`) component
    for c in path.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return false;
        }
    }

    // Compare canonicalized paths where the file (and storage_root) exists
    if path.exists() {
        if let (Ok(canon_path), Ok(canon_root)) = (path.canonicalize(), storage_root.canonicalize()) {
            return canon_path.starts_with(&canon_root) && canon_path != canon_root;
        }
        return false;
    }

    // If path does not exist on disk yet:
    if !path.starts_with(storage_root) || path == storage_root {
        return false;
    }

    if let Ok(canon_root) = storage_root.canonicalize() {
        let mut cur = path.parent();
        while let Some(p) = cur {
            if p.exists() {
                if let Ok(canon_p) = p.canonicalize() {
                    return canon_p.starts_with(&canon_root);
                }
                return false;
            }
            cur = p.parent();
        }
    }

    true
}

pub fn safe_storage_path(storage_root: &Path, storage_path: &str) -> Option<PathBuf> {
    if storage_path.is_empty() {
        return None;
    }
    let p = Path::new(storage_path);

    // Reject any path containing `..`
    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return None;
        }
    }

    if p.is_absolute() {
        // Reject absolute storage_path values outside storage_root
        if is_safe_to_delete(p, storage_root) {
            Some(p.to_path_buf())
        } else {
            None
        }
    } else {
        // Relative storage_path: reject any path with root or prefix component in relative part
        for c in p.components() {
            match c {
                std::path::Component::RootDir | std::path::Component::Prefix(_) => return None,
                _ => {}
            }
        }
        let full = storage_root.join(p);
        if is_safe_to_delete(&full, storage_root) {
            Some(full)
        } else {
            None
        }
    }
}

pub fn remove_empty_parent_dirs(start_dir: &Path, storage_root: &Path) {
    let mut current = start_dir.to_path_buf();
    while is_safe_to_delete(&current, storage_root) {
        match fs::read_dir(&current) {
            Ok(mut entries) => {
                if entries.next().is_none() {
                    let _ = fs::remove_dir(&current);
                    if let Some(parent) = current.parent() {
                        current = parent.to_path_buf();
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

// -----------------------------------------------------------------------------
// Markdown Shape & Builder (docs/FILE-FORMAT.md)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct ItemFileFields {
    pub title: String,
    pub subtitle: Option<String>,
    pub url: Option<String>,
    pub post_url: Option<String>,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub publication: Option<String>,
    pub publication_url: Option<String>,
    pub published: Option<String>,
    pub access: Option<String>,
    pub summary: Option<String>,
    pub fact_checked: Option<String>,
    pub language: Option<String>,
    /// Wikipedia revision id. Written unquoted when it is all digits.
    pub revision: Option<String>,
    pub last_edited: Option<String>,
    pub posted: Option<String>,
    pub saved: Option<String>,
    pub created: Option<String>,
    pub folder: Option<String>,
    /// Kind-specific front matter for the 2026-10 source kinds, keyed as in docs/FILE-FORMAT.md.
    pub meta: serde_json::Map<String, Value>,
}

fn clean_date(d: Option<&str>) -> Option<String> {
    d.map(|s| s.split('T').next().unwrap_or(s).to_string())
}

fn meta_text(meta: &Value, key: &str) -> Option<String> {
    match meta.get(key) {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

/// One of the 2026-10 source kinds' `meta` values as text, trimmed; None when missing, null or blank.
fn meta_value_text(meta: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match meta.get(key) {
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn meta_date(meta: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    clean_date(meta_value_text(meta, key).as_deref())
}

/// The kind fields in docs/FILE-FORMAT.md order, or an empty list for any other kind.
fn source_kind_field_names(kind: &str) -> &'static [&'static str] {
    match kind {
        "youtube" => &["channel", "channel_url", "published", "duration", "language", "captions"],
        "web" => &["site", "author", "published", "summary"],
        "reddit" => &["subreddit", "author", "posted", "score", "comments"],
        "pdf" => &["author", "published", "pages", "arxiv"],
        "hackernews" => &["author", "posted", "points", "comments", "link"],
        "bluesky" => &["author", "author_url", "posted"],
        _ => &[],
    }
}

/// Numbers written unquoted, per docs/FILE-FORMAT.md. `arxiv` is not one: it is always text, so
/// `2401.01234` is quoted rather than read as a YAML float.
fn is_number_source_field(name: &str) -> bool {
    matches!(name, "score" | "comments" | "points" | "pages")
}

fn is_date_source_field(name: &str) -> bool {
    matches!(name, "published" | "posted")
}

/// A value that is a bare number: JSON numbers, or strings that are plainly decimal numbers
/// (`532`, `2401.01234`). Anything else is written as an ordinary string.
fn number_meta_value(value: &Value) -> Option<String> {
    match value {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => {
            let trimmed = s.trim();
            NUMBER_TEXT_RE
                .is_match(trimmed)
                .then(|| trimmed.to_string())
        }
        _ => None,
    }
}

/// Front matter lines for one of the 2026-10 source kinds, in docs/FILE-FORMAT.md order.
fn source_kind_front_matter(kind: &str, meta: &serde_json::Map<String, Value>) -> Vec<String> {
    let mut lines = Vec::new();
    for &name in source_kind_field_names(kind) {
        let value = match meta.get(name) {
            Some(value) => value,
            None => continue,
        };
        let rendered = if is_number_source_field(name) {
            number_meta_value(value)
                .or_else(|| meta_value_text(meta, name).map(|text| format_yaml_string(&text)))
        } else if is_date_source_field(name) {
            meta_date(meta, name).map(|date| format_yaml_string(&date))
        } else {
            meta_value_text(meta, name).map(|text| format_yaml_string(&text))
        };
        if let Some(rendered) = rendered {
            lines.push(format!("{}: {}\n", name, rendered));
        }
    }
    lines
}

/// The "Saved from" line for one of the 2026-10 source kinds (docs/FILE-FORMAT.md).
fn source_kind_source_line(kind: &str, fields: &ItemFileFields) -> String {
    let meta = &fields.meta;
    let url = fields.url.as_deref().unwrap_or("");
    let saved = clean_date(fields.saved.as_deref()).unwrap_or_default();

    let label = match kind {
        "youtube" => "YouTube".to_string(),
        "web" => meta_value_text(meta, "site")
            .or_else(|| host_without_www(url))
            .unwrap_or_else(|| "Web page".to_string()),
        "reddit" => match meta_value_text(meta, "subreddit") {
            Some(subreddit) => format!("r/{}", subreddit),
            None => "Reddit".to_string(),
        },
        "pdf" => {
            if meta_value_text(meta, "arxiv").is_some() {
                "arXiv".to_string()
            } else {
                host_without_www(url).unwrap_or_else(|| "PDF".to_string())
            }
        }
        "hackernews" => "Hacker News".to_string(),
        "bluesky" => "Bluesky".to_string(),
        _ => kind.to_string(),
    };

    let mut line = format!("> Saved from [{}]({}) on {}.", label, url, saved);

    match kind {
        "youtube" => {
            if let Some(channel) = meta_value_text(meta, "channel") {
                line.push_str(&format!(" By {}.", channel));
            }
            if let Some(published) = meta_date(meta, "published") {
                line.push_str(&format!(" Published {}.", published));
            }
            match meta_value_text(meta, "captions").as_deref() {
                Some("auto-generated") => line.push_str(" Transcript from auto-generated captions."),
                Some("translated") => {
                    line.push_str(" Transcript machine-translated into English by YouTube.")
                }
                _ => {}
            }
        }
        "web" | "pdf" => {
            if let Some(author) = meta_value_text(meta, "author") {
                line.push_str(&format!(" By {}.", author));
            }
            if let Some(published) = meta_date(meta, "published") {
                line.push_str(&format!(" Published {}.", published));
            }
        }
        _ => {}
    }

    line
}

/// Front matter fields for an item that is already saved: its title and place come from the
/// item, everything else from what was saved with it, so a rename, move or note edit keeps them.
fn item_file_fields(item: &Item, title: String, folder: Option<String>) -> ItemFileFields {
    let meta = &item.meta;
    ItemFileFields {
        title,
        subtitle: meta_text(meta, "subtitle"),
        url: item.source_url.clone(),
        post_url: meta_text(meta, "post_url"),
        author: meta_text(meta, "author"),
        author_url: meta_text(meta, "author_url"),
        publication: meta_text(meta, "publication"),
        publication_url: meta_text(meta, "publication_url"),
        published: meta_text(meta, "published"),
        access: meta_text(meta, "access"),
        summary: meta_text(meta, "summary"),
        fact_checked: meta_text(meta, "fact_checked").or_else(|| meta_text(meta, "fact_checked_at")),
        language: meta_text(meta, "language"),
        revision: meta_text(meta, "revision"),
        last_edited: meta_text(meta, "last_edited"),
        posted: meta_text(meta, "posted"),
        saved: clean_date(Some(&item.created_at)),
        created: clean_date(Some(&item.created_at)),
        folder,
        meta: item.meta.as_object().cloned().unwrap_or_default(),
    }
}

pub fn clean_body_markdown(kind: &str, body: &str, subtitle: Option<&str>) -> String {
    let mut raw = body.replace("\r\n", "\n");
    if raw.starts_with('﻿') {
        raw.remove(0);
    }
    if let Some(stripped) = raw.trim_start().strip_prefix("---") {
        if let Some(end_idx) = stripped.find("---") {
            raw = stripped[end_idx + 3..].trim_start().to_string();
        }
    }
    if let Some(note_start) = raw.rfind("\n## My note\n") {
        raw.truncate(note_start);
    }
    if let Some(hl_start) = raw.rfind(HIGHLIGHTS_HEADING) {
        raw.truncate(hl_start);
    }

    let mut text = raw.trim();

    if text.starts_with("# ") {
        if let Some(pos) = text.find('\n') {
            text = text[pos + 1..].trim_start();
        } else {
            text = "";
        }
    }

    if kind == "substack" {
        if let Some(sub) = subtitle {
            let tr = sub.trim();
            if !tr.is_empty() {
                let expected = format!("*{}*", tr);
                if text.starts_with(&expected) {
                    text = text[expected.len()..].trim_start();
                }
            }
        }
    }

    while text.starts_with("> Saved from ") || text.starts_with(">Saved from ") {
        if let Some(pos) = text.find('\n') {
            text = text[pos + 1..].trim_start();
        } else {
            text = "";
        }
    }

    if text.starts_with("# ") {
        if let Some(pos) = text.find('\n') {
            text = text[pos + 1..].trim_start();
        } else {
            text = "";
        }
    }

    let re_h1 = Regex::new(r"(?m)^#\s+(.+)$").unwrap();
    let with_h2 = re_h1.replace_all(text, "## $1");

    let re_newlines = Regex::new(r"\n{3,}").unwrap();
    let collapsed = re_newlines.replace_all(&with_h2, "\n\n");
    collapsed.trim().to_string()
}

pub fn build_item_file(
    kind: &str,
    fields: &ItemFileFields,
    body: &str,
    note: Option<&str>,
) -> String {
    build_item_file_with_highlights(kind, fields, body, note, &[])
}

/// Same as `build_item_file`, plus the `## My highlights` section (after the body, before
/// `## My note`) when `highlights` is not empty.
pub fn build_item_file_with_highlights(
    kind: &str,
    fields: &ItemFileFields,
    body: &str,
    note: Option<&str>,
    highlights: &[Highlight],
) -> String {
    let mut fm = String::from("---\n");
    fm.push_str(&format!("source: {}\n", kind));
    fm.push_str(&format!("title: {}\n", format_yaml_string(&fields.title)));

    match kind {
        "grokipedia" => {
            if let Some(u) = &fields.url {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            if let Some(s) = &fields.summary {
                let tr = s.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("summary: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(fc) = clean_date(fields.fact_checked.as_deref()) {
                fm.push_str(&format!("fact_checked: {}\n", format_yaml_string(&fc)));
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
        "substack" => {
            if let Some(sub) = &fields.subtitle {
                let tr = sub.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("subtitle: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(u) = &fields.url {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            if let Some(a) = &fields.author {
                let tr = a.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("author: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(au) = &fields.author_url {
                let tr = au.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("author_url: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(p) = &fields.publication {
                let tr = p.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("publication: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(pu) = &fields.publication_url {
                let tr = pu.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("publication_url: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(pub_date) = clean_date(fields.published.as_deref()) {
                fm.push_str(&format!("published: {}\n", format_yaml_string(&pub_date)));
            }
            if let Some(acc) = &fields.access {
                let tr = acc.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("access: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
        "x" => {
            let u = fields.post_url.as_deref().or(fields.url.as_deref());
            if let Some(u) = u {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            if let Some(a) = &fields.author {
                let tr = a.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("author: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(au) = &fields.author_url {
                let tr = au.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("author_url: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(p) = clean_date(fields.posted.as_deref()) {
                fm.push_str(&format!("posted: {}\n", format_yaml_string(&p)));
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
        "wikipedia" => {
            if let Some(u) = &fields.url {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            if let Some(s) = &fields.summary {
                let tr = s.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("summary: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(l) = &fields.language {
                let tr = l.trim();
                if !tr.is_empty() {
                    fm.push_str(&format!("language: {}\n", format_yaml_string(tr)));
                }
            }
            if let Some(r) = &fields.revision {
                let tr = r.trim();
                if !tr.is_empty() && tr.len() <= 15 && tr.bytes().all(|b| b.is_ascii_digit()) {
                    fm.push_str(&format!("revision: {}\n", tr));
                }
            }
            if let Some(e) = clean_date(fields.last_edited.as_deref()) {
                fm.push_str(&format!("last_edited: {}\n", format_yaml_string(&e)));
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
        "note" => {
            if let Some(c) = clean_date(fields.created.as_deref()) {
                fm.push_str(&format!("created: {}\n", format_yaml_string(&c)));
            }
        }
        other if is_source_capture_kind(other) => {
            if let Some(u) = &fields.url {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            for line in source_kind_front_matter(other, &fields.meta) {
                fm.push_str(&line);
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
        _ => {
            if let Some(u) = &fields.url {
                fm.push_str(&format!("url: {}\n", format_yaml_string(u)));
            }
            if let Some(s) = clean_date(fields.saved.as_deref()) {
                fm.push_str(&format!("saved: {}\n", format_yaml_string(&s)));
            }
        }
    }

    if let Some(f) = &fields.folder {
        let tr = f.trim();
        if !tr.is_empty() {
            fm.push_str(&format!("folder: {}\n", format_yaml_string(tr)));
        }
    }
    fm.push_str("---\n\n");

    let source_line = match kind {
        "grokipedia" => {
            let u = fields.url.as_deref().unwrap_or("");
            let s = clean_date(fields.saved.as_deref()).unwrap_or_default();
            format!("> Saved from [Grokipedia]({}) on {}. Grokipedia articles change; check the live page for edits.", u, s)
        }
        "wikipedia" => {
            let u = fields.url.as_deref().unwrap_or("");
            let s = clean_date(fields.saved.as_deref()).unwrap_or_default();
            format!("> Saved from [Wikipedia]({}) on {}. Wikipedia articles change; check the live page for edits.", u, s)
        }
        "substack" => {
            let pub_name = fields.publication.as_deref().map(|p| p.trim()).filter(|p| !p.is_empty()).unwrap_or("Substack");
            let u = fields.url.as_deref().unwrap_or("");
            let s = clean_date(fields.saved.as_deref()).unwrap_or_default();
            let mut line = format!("> Saved from [{}]({}) on {}.", pub_name, u, s);
            if let Some(a) = &fields.author {
                let tr = a.trim();
                if !tr.is_empty() {
                    line.push_str(&format!(" By {}.", tr));
                }
            }
            if let Some(p) = clean_date(fields.published.as_deref()) {
                line.push_str(&format!(" Published {}.", p));
            }
            line
        }
        "x" => {
            let u = fields.post_url.as_deref().or(fields.url.as_deref()).unwrap_or("");
            let s = clean_date(fields.saved.as_deref()).unwrap_or_default();
            format!("> Saved from [X]({}) on {}.", u, s)
        }
        "note" => String::new(),
        other if is_source_capture_kind(other) => source_kind_source_line(other, fields),
        _ => {
            if let Some(u) = &fields.url {
                let s = clean_date(fields.saved.as_deref()).unwrap_or_default();
                format!("> Saved from [{}]({}) on {}.", kind, u, s)
            } else {
                String::new()
            }
        }
    };

    let mut sections: Vec<String> = Vec::new();
    sections.push(format!("# {}", fields.title.trim()));

    if kind == "substack" {
        if let Some(sub) = &fields.subtitle {
            let tr = sub.trim();
            if !tr.is_empty() {
                sections.push(format!("*{}*", tr));
            }
        }
    }

    if !source_line.is_empty() {
        sections.push(source_line);
    }

    let cleaned_body = clean_body_markdown(kind, body, fields.subtitle.as_deref());
    if !cleaned_body.is_empty() {
        sections.push(cleaned_body);
    }

    if let Some(section) = build_highlights_section(highlights, fields.url.as_deref()) {
        sections.push(section);
    }

    if kind != "note" {
        if let Some(n) = note {
            let tr = n.trim();
            if !tr.is_empty() {
                sections.push(format!("## My note\n\n{}", tr));
            }
        }
    }

    format!("{}{}\n", fm, sections.join("\n\n"))
}

pub fn extract_body_and_note(md: &str) -> (String, Option<String>) {
    let trimmed = md.trim_start();
    let without_fm = if let Some(stripped) = trimmed.strip_prefix("---") {
        if let Some(end_idx) = stripped.find("---") {
            stripped[end_idx + 3..].trim_start()
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let (before_note, note) = if let Some(note_idx) = without_fm.find("\n## My note\n") {
        let note = &without_fm[note_idx + "\n## My note\n".len()..];
        (&without_fm[..note_idx], Some(note.trim().to_string()))
    } else {
        (without_fm, None)
    };
    let body = match before_note.rfind(HIGHLIGHTS_HEADING) {
        Some(hl_idx) => &before_note[..hl_idx],
        None => before_note,
    };
    (body.to_string(), note)
}

// -----------------------------------------------------------------------------
// Highlights section (docs/FILE-FORMAT.md, "## My highlights")
// -----------------------------------------------------------------------------

const HIGHLIGHTS_HEADING: &str = "\n## My highlights\n";

fn collapse_whitespace(s: &str) -> String {
    WHITESPACE_COLLAPSE_RE.replace_all(s, " ").trim().to_string()
}

/// The video id of a YouTube item URL (watch?v=, youtu.be/, /shorts/, /live/, /embed/).
fn youtube_video_id(item_url: &str) -> Option<String> {
    let url = reqwest::Url::parse(item_url).ok()?;
    let host = url.host_str()?.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    let valid = |id: &str| {
        !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    };
    if host == "youtu.be" {
        let id = url.path_segments()?.next()?.to_string();
        return if valid(&id) { Some(id) } else { None };
    }
    if host == "youtube.com" || host.ends_with(".youtube.com") || host == "youtube-nocookie.com" {
        if let Some((_, v)) = url.query_pairs().find(|(k, _)| k == "v") {
            if valid(&v) {
                return Some(v.to_string());
            }
        }
        let mut segs = url.path_segments()?;
        let first = segs.next()?;
        if matches!(first, "shorts" | "live" | "embed") {
            let id = segs.next()?.to_string();
            if valid(&id) {
                return Some(id);
            }
        }
    }
    None
}

/// `M:SS` under an hour, `H:MM:SS` from an hour.
pub fn format_highlight_time(seconds: i64) -> String {
    let s = seconds.max(0);
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{}:{:02}", m, sec)
    }
}

fn highlight_domain(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .map(|h| h.strip_prefix("www.").map(str::to_string).unwrap_or(h))
        .unwrap_or_else(|| url.to_string())
}

fn highlight_block(h: &Highlight, item_url: Option<&str>) -> String {
    let quote = collapse_whitespace(&h.quote);
    let mut block = if h.kind == "image" {
        format!("![{}]({})", quote, h.image_src.as_deref().unwrap_or(""))
    } else {
        format!("> {}", quote)
    };

    let mut parts: Vec<String> = Vec::new();
    if let Some(sec) = h.seconds {
        let time = format_highlight_time(sec);
        match item_url.and_then(youtube_video_id) {
            Some(id) => parts.push(format!("[{}](https://youtu.be/{}?t={})", time, id, sec)),
            None => parts.push(time),
        }
    }
    if !h.cited.is_empty() {
        let cites: Vec<String> = h
            .cited
            .iter()
            .map(|c| {
                let target = if c.url.contains(' ') || c.url.contains('(') || c.url.contains(')') {
                    format!("<{}>", c.url)
                } else {
                    c.url.clone()
                };
                format!("[{}]({})", highlight_domain(&c.url), target)
            })
            .collect();
        parts.push(format!("Cited: {}", cites.join(", ")));
    }
    if let Some(n) = &h.note {
        let n = collapse_whitespace(n);
        if !n.is_empty() {
            parts.push(format!("Note: {}", n));
        }
    }
    if !parts.is_empty() {
        block.push_str("\n\n");
        block.push_str(&parts.join(" · "));
    }
    block
}

/// The `## My highlights` section, or None when there are no highlights.
pub fn build_highlights_section(highlights: &[Highlight], item_url: Option<&str>) -> Option<String> {
    if highlights.is_empty() {
        return None;
    }
    let mut sorted: Vec<&Highlight> = highlights.iter().collect();
    sorted.sort_by(|a, b| {
        a.start_offset
            .cmp(&b.start_offset)
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    let blocks: Vec<String> = sorted.iter().map(|h| highlight_block(h, item_url)).collect();
    Some(format!("## My highlights\n\n{}", blocks.join("\n\n")))
}

fn item_highlights(db: &Database, item_id: &str) -> Vec<Highlight> {
    db.get_highlights_for_item(item_id).unwrap_or_default()
}

// -----------------------------------------------------------------------------
// Grokipedia HTML Parser
// -----------------------------------------------------------------------------

fn fetch_url_html(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let res = client
        .get(url)
        .send()
        .map_err(|e| format!("Network request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Server returned HTTP {}", res.status()));
    }

    res.text()
        .map_err(|e| format!("Failed to decode response: {}", e))
}

fn convert_node_to_markdown(node: scraper::ElementRef) -> String {
    let mut out = String::new();

    for child in node.children() {
        if let Some(text) = child.value().as_text() {
            out.push_str(text);
        } else if let Some(elem) = scraper::ElementRef::wrap(child) {
            let tag = elem.value().name();
            let classes: Vec<&str> = elem
                .value()
                .attr("class")
                .unwrap_or("")
                .split_whitespace()
                .collect();
            let id = elem.value().attr("id").unwrap_or("");

            if tag == "nav" || classes.contains(&"toc") || id == "toc" {
                continue;
            }

            match tag {
                "p" => {
                    let inner = convert_node_to_markdown(elem);
                    let trimmed = inner.trim();
                    if !trimmed.is_empty() {
                        out.push_str("\n\n");
                        out.push_str(trimmed);
                        out.push_str("\n\n");
                    }
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    let level = match tag {
                        "h1" => "##",
                        "h2" => "##",
                        "h3" => "###",
                        "h4" => "####",
                        "h5" => "#####",
                        _ => "######",
                    };
                    let inner = convert_node_to_markdown(elem);
                    let trimmed = inner.trim();
                    if !trimmed.is_empty() {
                        out.push_str("\n\n");
                        out.push_str(level);
                        out.push(' ');
                        out.push_str(trimmed);
                        out.push_str("\n\n");
                    }
                }
                "ul" => {
                    out.push_str("\n\n");
                    for li in elem.children().filter_map(scraper::ElementRef::wrap) {
                        if li.value().name() == "li" {
                            let inner = convert_node_to_markdown(li);
                            out.push_str("- ");
                            out.push_str(inner.trim());
                            out.push('\n');
                        }
                    }
                    out.push('\n');
                }
                "ol" => {
                    out.push_str("\n\n");
                    let mut i = 1;
                    for li in elem.children().filter_map(scraper::ElementRef::wrap) {
                        if li.value().name() == "li" {
                            let inner = convert_node_to_markdown(li);
                            out.push_str(&format!("{}. {}\n", i, inner.trim()));
                            i += 1;
                        }
                    }
                    out.push('\n');
                }
                "strong" | "b" => {
                    let inner = convert_node_to_markdown(elem);
                    let trimmed = inner.trim();
                    if !trimmed.is_empty() {
                        out.push_str("**");
                        out.push_str(trimmed);
                        out.push_str("**");
                    }
                }
                "em" | "i" => {
                    let inner = convert_node_to_markdown(elem);
                    let trimmed = inner.trim();
                    if !trimmed.is_empty() {
                        out.push('*');
                        out.push_str(trimmed);
                        out.push('*');
                    }
                }
                "code" => {
                    let inner = convert_node_to_markdown(elem);
                    out.push('`');
                    out.push_str(&inner);
                    out.push('`');
                }
                "a" => {
                    let href = elem.value().attr("href").unwrap_or("");
                    if href.starts_with("#ref-") {
                        if let Some(caps) = REF_ID_RE.captures(href) {
                            out.push_str(&format!("[^{}]", &caps[1]));
                        } else {
                            out.push_str(&convert_node_to_markdown(elem));
                        }
                    } else {
                        let inner = convert_node_to_markdown(elem);
                        let trimmed = inner.trim();
                        if !href.is_empty() && !trimmed.is_empty() {
                            out.push_str(&format!("[{}]({})", trimmed, href));
                        } else {
                            out.push_str(trimmed);
                        }
                    }
                }
                _ => {
                    out.push_str(&convert_node_to_markdown(elem));
                }
            }
        }
    }

    out
}

pub fn parse_grokipedia_html(html: &str, raw_url: &str) -> Result<GrokipediaArticle, String> {
    let document = Html::parse_document(html);

    let h1_selector = Selector::parse("h1").unwrap();
    let article_selector = Selector::parse("article").unwrap();
    let body_selector = Selector::parse("body").unwrap();

    let title = document
        .select(&h1_selector)
        .next()
        .map(|el| el.text().collect::<Vec<_>>().join(" "))
        .map(|s| WHITESPACE_COLLAPSE_RE.replace_all(&s, " ").trim().to_string())
        .unwrap_or_else(|| {
            let parsed_path = reqwest::Url::parse(raw_url).ok();
            parsed_path
                .and_then(|u| {
                    u.path_segments()
                        .and_then(|mut s| s.next_back())
                        .map(|last| last.replace('_', " "))
                })
                .unwrap_or_else(|| "Grokipedia Article".to_string())
        });

    let main_content = document
        .select(&article_selector)
        .next()
        .or_else(|| document.select(&body_selector).next());

    let mut body_markdown = String::new();
    let mut references = Vec::new();
    let mut summary = None;
    let mut fact_checked_at = None;

    if let Some(meta_desc) = document
        .select(&Selector::parse("meta[name=\"description\"]").unwrap())
        .next()
        .and_then(|el| el.value().attr("content"))
    {
        summary = Some(meta_desc.trim().to_string());
    }

    if let Ok(ld_sel) = Selector::parse(r#"script[type="application/ld+json"]"#) {
        for script in document.select(&ld_sel) {
            let text = script.text().collect::<Vec<_>>().join("");
            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                if let Some(date) = val.get("dateModified").and_then(Value::as_str) {
                    fact_checked_at = Some(date.to_string());
                    break;
                }
                if let Some(graph) = val.get("@graph").and_then(Value::as_array) {
                    for item in graph {
                        if let Some(date) = item.get("dateModified").and_then(Value::as_str) {
                            fact_checked_at = Some(date.to_string());
                            break;
                        }
                    }
                    if fact_checked_at.is_some() {
                        break;
                    }
                }
            }
        }
    }

    if fact_checked_at.is_none() {
        if let Some(fact_checked_elem) = document
            .select(&Selector::parse("[data-fact-checked-at], .fact-checked-date").unwrap())
            .next()
        {
            let date_str = fact_checked_elem
                .value()
                .attr("data-fact-checked-at")
                .unwrap_or_else(|| fact_checked_elem.text().collect::<String>().leak());
            if !date_str.trim().is_empty() {
                fact_checked_at = Some(date_str.trim().to_string());
            }
        }
    }

    if let Some(content_node) = main_content {
        let ref_ol_selector = Selector::parse("#references ol, .references ol, ol.references").unwrap();
        if let Some(ol) = content_node.select(&ref_ol_selector).next() {
            let li_selector = Selector::parse("li").unwrap();
            let mut fallback_num = 1;
            for li in ol.select(&li_selector) {
                let id = li.value().attr("id").unwrap_or("");
                let num = if let Some(caps) = DIGITS_RE.captures(id) {
                    caps[0].parse::<usize>().unwrap_or(fallback_num)
                } else {
                    fallback_num
                };
                fallback_num = num + 1;

                let a_selector = Selector::parse("a").unwrap();
                let link = li.select(&a_selector).next();
                let url = link.and_then(|a| a.value().attr("href")).unwrap_or("").trim().to_string();
                let ref_title = link
                    .map(|a| a.text().collect::<Vec<_>>().join(" "))
                    .unwrap_or_default()
                    .trim()
                    .to_string();

                let domain = reqwest::Url::parse(&url)
                    .ok()
                    .and_then(|u| u.host_str().map(|h| h.strip_prefix("www.").unwrap_or(h).to_string()))
                    .unwrap_or_default();

                if !url.is_empty() {
                    references.push(GrokReference {
                        number: num,
                        title: ref_title,
                        url,
                        domain,
                    });
                }
            }
        }

        body_markdown = convert_node_to_markdown(content_node);
    }

    if let Some(pos) = body_markdown.find("## References") {
        body_markdown.truncate(pos);
    }

    let deduped = dedupe_citation_runs(&body_markdown);
    let trimmed_body = deduped.trim().to_string();

    Ok(GrokipediaArticle {
        title,
        summary,
        fact_checked_at,
        body_markdown: trimmed_body,
        references,
    })
}

// -----------------------------------------------------------------------------
// Markdown Assemblers
// -----------------------------------------------------------------------------

pub fn build_grokipedia_frontmatter(
    article: &GrokipediaArticle,
    raw_url: &str,
    today: &str,
    folder_path_str: &str,
) -> String {
    let mut front_matter = String::from("---\n");
    front_matter.push_str("source: grokipedia\n");
    front_matter.push_str(&format!("title: {}\n", format_yaml_string(&article.title)));
    front_matter.push_str(&format!("url: {}\n", format_yaml_string(raw_url)));
    if let Some(s) = &article.summary {
        front_matter.push_str(&format!("summary: {}\n", format_yaml_string(s)));
    }
    if let Some(fc) = clean_date(article.fact_checked_at.as_deref()) {
        front_matter.push_str(&format!("fact_checked: {}\n", format_yaml_string(&fc)));
    }
    let today_clean = clean_date(Some(today)).unwrap_or_else(|| today.to_string());
    front_matter.push_str(&format!("saved: {}\n", format_yaml_string(&today_clean)));
    if !folder_path_str.is_empty() {
        front_matter.push_str(&format!("folder: {}\n", format_yaml_string(folder_path_str)));
    }
    front_matter.push_str("---\n\n");
    front_matter
}

pub fn build_grokipedia_markdown(article: &GrokipediaArticle) -> String {
    let mut parts: Vec<String> = Vec::new();

    if !article.body_markdown.is_empty() {
        parts.push(article.body_markdown.clone());
    }

    if !article.references.is_empty() {
        let mut ref_lines = Vec::new();
        for r in &article.references {
            let domain_suffix = if !r.domain.is_empty() {
                format!(" - {}", r.domain)
            } else {
                String::new()
            };
            if r.title.is_empty() || r.title == r.url {
                ref_lines.push(format!("[^{}]: <{}>{}", r.number, r.url, domain_suffix));
            } else {
                ref_lines.push(format!("[^{}]: [{}]({}){}", r.number, r.title, r.url, domain_suffix));
            }
        }
        parts.push(format!("## References\n\n{}", ref_lines.join("\n")));
    }

    parts.join("\n\n")
}

pub fn build_substack_markdown(
    capture: &SubstackCapture,
    folder_path_str: &str,
    today: &str,
) -> String {
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str.to_string()) };
    let fields = ItemFileFields {
        title: capture.title.clone(),
        subtitle: capture.subtitle.clone(),
        url: Some(capture.url.clone()),
        author: capture.author.clone(),
        author_url: capture.author_url.clone(),
        publication: capture.publication.clone(),
        publication_url: capture.publication_url.clone(),
        published: capture.published.clone(),
        access: Some(capture.access.clone()),
        saved: Some(today.to_string()),
        folder: folder_opt,
        ..Default::default()
    };
    build_item_file("substack", &fields, &capture.markdown, None)
}

// -----------------------------------------------------------------------------
// X Thread Formatter (Ported from packages/core/src/x/markdown.ts)
// -----------------------------------------------------------------------------

pub fn x_thread_title(nodes: &[XTreeNode]) -> String {
    if nodes.is_empty() {
        return "X Post".to_string();
    }
    let root = &nodes[0];
    let author = if !root.author_name.is_empty() {
        &root.author_name
    } else if !root.handle.is_empty() {
        &root.handle
    } else {
        "Unknown"
    };

    let clean_handle = root.handle.trim_start_matches('@');
    let by_clause = if clean_handle.is_empty() || clean_handle.eq_ignore_ascii_case(author) {
        author.to_string()
    } else {
        format!("{} (@{})", author, clean_handle)
    };

    if nodes.len() > 1 {
        format!("Thread by {}", by_clause)
    } else {
        format!("Post by {}", by_clause)
    }
}

fn render_x_node_block(node: &XTreeNode) -> String {
    let mut lines = Vec::new();

    let clean_handle = node.handle.trim_start_matches('@');
    let handle_part = if clean_handle.is_empty() {
        String::new()
    } else {
        format!(" (@{})", clean_handle)
    };
    let author_bold = if !node.author_name.is_empty() {
        format!("**{}**", node.author_name)
    } else if !clean_handle.is_empty() {
        format!("**@{}**", clean_handle)
    } else {
        "**Unknown**".to_string()
    };

    let author_str = format!("{}{}", author_bold, handle_part);
    let date_str = clean_date(node.posted_at.as_deref());
    let link_str = format!("[link]({})", node.post_url);

    let mut header_parts = vec![author_str];
    if let Some(d) = date_str {
        if !d.is_empty() {
            header_parts.push(d);
        }
    }
    header_parts.push(link_str);

    lines.push(header_parts.join(" · "));

    let text_trimmed = node.text.trim();
    if !text_trimmed.is_empty() {
        lines.push(String::new());
        lines.push(text_trimmed.to_string());
    }

    lines.join("\n")
}

pub fn render_x_thread_body(nodes: &[XTreeNode]) -> String {
    if nodes.is_empty() {
        return String::new();
    }

    let mut children_map: std::collections::BTreeMap<Option<String>, Vec<usize>> = std::collections::BTreeMap::new();
    let mut id_to_index: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();

    for (idx, node) in nodes.iter().enumerate() {
        id_to_index.insert(node.id.clone(), idx);
        id_to_index.insert(node.post_url.clone(), idx);
    }

    for (idx, node) in nodes.iter().enumerate() {
        let parent_key = node.parent_id.as_ref().and_then(|pid| {
            if id_to_index.contains_key(pid) {
                Some(pid.clone())
            } else {
                None
            }
        });
        children_map.entry(parent_key).or_default().push(idx);
    }

    let mut chunks = Vec::new();
    let mut visited = HashSet::new();

    fn walk(
        idx: usize,
        depth: usize,
        nodes: &[XTreeNode],
        children_map: &std::collections::BTreeMap<Option<String>, Vec<usize>>,
        visited: &mut HashSet<usize>,
        chunks: &mut Vec<String>,
    ) {
        if !visited.insert(idx) {
            return;
        }

        let node = &nodes[idx];
        let block = render_x_node_block(node);
        let prefix = "> ".repeat(depth);

        let prefixed = block
            .lines()
            .map(|l| {
                if l.is_empty() {
                    prefix.trim_end().to_string()
                } else {
                    format!("{}{}", prefix, l)
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        chunks.push(prefixed);

        // Visit children
        if let Some(children) = children_map.get(&Some(node.id.clone())) {
            for &child_idx in children {
                walk(child_idx, depth + 1, nodes, children_map, visited, chunks);
            }
        }
        if let Some(children) = children_map.get(&Some(node.post_url.clone())) {
            for &child_idx in children {
                walk(child_idx, depth + 1, nodes, children_map, visited, chunks);
            }
        }
    }

    // Walk roots
    if let Some(roots) = children_map.get(&None) {
        for &root_idx in roots {
            walk(root_idx, 0, nodes, &children_map, &mut visited, &mut chunks);
        }
    }

    // Walk any unvisited nodes
    for idx in 0..nodes.len() {
        if !visited.contains(&idx) {
            walk(idx, 0, nodes, &children_map, &mut visited, &mut chunks);
        }
    }

    chunks.join("\n\n---\n\n")
}

pub fn build_x_thread_markdown(posts: &[XPostCapture], title: &str) -> String {
    let nodes: Vec<XTreeNode> = posts.iter().enumerate().map(|(i, p)| {
        let parent_id = if i == 0 { None } else { Some(posts[i - 1].post_url.clone()) };
        XTreeNode {
            id: p.post_url.clone(),
            parent_id,
            position: i as i32,
            post_url: p.post_url.clone(),
            author_name: p.author_name.clone(),
            handle: p.handle.clone(),
            author_url: p.author_url.clone(),
            posted_at: p.posted_at.clone(),
            text: p.text.clone(),
        }
    }).collect();

    let root_post = posts.first();
    let fields = ItemFileFields {
        title: title.to_string(),
        url: root_post.map(|p| p.post_url.clone()),
        author: root_post.map(|p| p.author_name.clone()),
        author_url: root_post.and_then(|p| if p.author_url.is_empty() { None } else { Some(p.author_url.clone()) }),
        posted: root_post.and_then(|p| p.posted_at.clone()),
        ..Default::default()
    };
    let body = render_x_thread_body(&nodes);
    build_item_file("x", &fields, &body, None)
}

// -----------------------------------------------------------------------------
// Service Operations (Shared Business Logic)
// -----------------------------------------------------------------------------

pub fn check_url(db: &Database, raw_url: &str, folder_id: &str) -> Result<CheckUrlResult, ServiceError> {
    let canonical = canonicalize_url(raw_url).unwrap_or_else(|_| raw_url.to_string());
    Ok(db.check_url(&canonical, folder_id))
}

pub fn save_grokipedia(
    db: &Database,
    raw_url: &str,
    folder_id: &str,
    html_override: Option<&str>,
) -> Result<Item, ServiceError> {
    let canonical = canonicalize_url(raw_url).map_err(ServiceError::bad_request)?;

    let check = db.check_url(&canonical, folder_id);
    if check.exists {
        return Err(ServiceError::duplicate(
            format!("Already saved in {}", check.folder_name.as_deref().unwrap_or("this folder")),
            check.item_id,
            check.folder_id,
            check.folder_name,
        ));
    }

    let html = match html_override {
        Some(h) => h.to_string(),
        None => fetch_url_html(raw_url)
            .map_err(|e| ServiceError::internal(format!("Failed to fetch Grokipedia article: {}", e), "fetch_failed"))?,
    };

    let article = parse_grokipedia_html(&html, raw_url)
        .map_err(|e| ServiceError::internal(format!("Failed to parse article: {}", e), "parse_failed"))?;

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let fields = ItemFileFields {
        title: article.title.clone(),
        url: Some(raw_url.to_string()),
        summary: article.summary.clone(),
        fact_checked: article.fact_checked_at.clone(),
        saved: Some(today),
        folder: folder_opt,
        ..Default::default()
    };

    let body = build_grokipedia_markdown(&article);
    let full_file_content = build_item_file("grokipedia", &fields, &body, None);

    let meta = json!({
        "summary": article.summary,
        "fact_checked_at": article.fact_checked_at,
        "references_count": article.references.len(),
    });

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "grokipedia".to_string(),
        title: article.title.clone(),
        source_url: Some(raw_url.to_string()),
        canonical_url: Some(canonical),
        status: "saved".to_string(),
        error: None,
        markdown: Some(full_file_content.clone()),
        meta: Some(meta),
        note: None,
        position: None,
    };

    let mut item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &article.title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

pub fn save_substack(
    db: &Database,
    folder_id: &str,
    capture: SubstackCapture,
) -> Result<Item, ServiceError> {
    let canonical = canonicalize_url(&capture.url).unwrap_or_else(|_| capture.url.clone());

    let check = db.check_url(&canonical, folder_id);
    if check.exists {
        return Err(ServiceError::duplicate(
            format!("Already saved in {}", check.folder_name.as_deref().unwrap_or("this folder")),
            check.item_id,
            check.folder_id,
            check.folder_name,
        ));
    }

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let fields = ItemFileFields {
        title: capture.title.clone(),
        subtitle: capture.subtitle.clone(),
        url: Some(capture.url.clone()),
        author: capture.author.clone(),
        author_url: capture.author_url.clone(),
        publication: capture.publication.clone(),
        publication_url: capture.publication_url.clone(),
        published: capture.published.clone(),
        access: Some(capture.access.clone()),
        saved: Some(today),
        folder: folder_opt,
        ..Default::default()
    };

    let full_file_content = build_item_file("substack", &fields, &capture.markdown, None);

    let meta = json!({
        "subtitle": capture.subtitle,
        "author": capture.author,
        "author_url": capture.author_url,
        "publication": capture.publication,
        "publication_url": capture.publication_url,
        "published": capture.published,
        "access": capture.access,
    });

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "substack".to_string(),
        title: capture.title.clone(),
        source_url: Some(capture.url.clone()),
        canonical_url: Some(canonical),
        status: "saved".to_string(),
        error: None,
        markdown: Some(full_file_content.clone()),
        meta: Some(meta),
        note: None,
        position: None,
    };

    let mut item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &capture.title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

fn wikipedia_fields(
    capture: &WikipediaCapture,
    folder: Option<String>,
    saved: &str,
) -> ItemFileFields {
    ItemFileFields {
        title: capture.title.trim().to_string(),
        url: Some(capture.url.clone()),
        summary: capture.summary.clone(),
        language: capture.language.clone(),
        revision: capture.revision.clone(),
        last_edited: capture.last_edited.clone(),
        saved: Some(saved.to_string()),
        folder,
        ..Default::default()
    }
}

pub fn build_wikipedia_markdown(
    capture: &WikipediaCapture,
    folder_path_str: &str,
    today: &str,
) -> String {
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str.to_string()) };
    let fields = wikipedia_fields(capture, folder_opt, today);
    build_item_file("wikipedia", &fields, &capture.markdown, None)
}

/// Saves a Wikipedia article the desktop already fetched and converted (in the webview), to the
/// local database and as a Markdown file on disk.
pub fn save_wikipedia(
    db: &Database,
    folder_id: &str,
    capture: WikipediaCapture,
) -> Result<Item, ServiceError> {
    let title = capture.title.trim().to_string();
    if title.is_empty() {
        return Err(ServiceError::bad_request("A title is required"));
    }
    let canonical = canonicalize_url(&capture.url).map_err(ServiceError::bad_request)?;
    let is_wikipedia = reqwest::Url::parse(&canonical)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.ends_with(".wikipedia.org")))
        .unwrap_or(false);
    if !is_wikipedia {
        return Err(ServiceError::bad_request("That isn't a Wikipedia article link."));
    }

    let check = db.check_url(&canonical, folder_id);
    if check.exists {
        return Err(ServiceError::duplicate(
            format!("Already saved in {}", check.folder_name.as_deref().unwrap_or("this folder")),
            check.item_id,
            check.folder_id,
            check.folder_name,
        ));
    }

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let full_file_content = build_wikipedia_markdown(&capture, &folder_path_str, &today);

    let meta = json!({
        "summary": capture.summary,
        "language": capture.language,
        "revision": capture.revision,
        "last_edited": capture.last_edited,
    });

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "wikipedia".to_string(),
        title: title.clone(),
        source_url: Some(capture.url.clone()),
        canonical_url: Some(canonical),
        status: "saved".to_string(),
        error: None,
        markdown: Some(full_file_content.clone()),
        meta: Some(meta),
        note: None,
        position: None,
    };

    let mut item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

pub fn save_substack_unavailable(
    db: &Database,
    folder_id: &str,
    url: &str,
    title: &str,
) -> Result<Item, ServiceError> {
    let canonical = canonicalize_url(url).unwrap_or_else(|_| url.to_string());

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "substack".to_string(),
        title: title.to_string(),
        source_url: Some(url.to_string()),
        canonical_url: Some(canonical),
        status: "unavailable".to_string(),
        error: Some("Article is paywalled or requires sign-in to read".to_string()),
        markdown: None,
        meta: None,
        note: None,
        position: None,
    };

    db.save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

fn source_file_fields(
    capture: &SourceCapture,
    folder: Option<String>,
    saved: &str,
) -> ItemFileFields {
    ItemFileFields {
        title: capture.title.trim().to_string(),
        url: Some(capture.url.clone()),
        saved: Some(saved.to_string()),
        folder,
        meta: capture.meta.clone(),
        ..Default::default()
    }
}

/// Saves one of the 2026-10 source kinds. The desktop's webview (or the extension, over the
/// local server) already fetched and converted it; this writes the item and its Markdown file.
pub fn save_source(
    db: &Database,
    folder_id: &str,
    kind: &str,
    capture: SourceCapture,
) -> Result<Item, ServiceError> {
    if !is_source_capture_kind(kind) {
        return Err(ServiceError::bad_request(format!(
            "Unknown source kind \"{}\"",
            kind
        )));
    }

    let title = capture.title.trim().to_string();
    if title.is_empty() {
        return Err(ServiceError::bad_request("A title is required"));
    }

    let canonical = canonicalize_url(&capture.url).unwrap_or_else(|_| capture.url.clone());

    let check = db.check_url(&canonical, folder_id);
    if check.exists {
        return Err(ServiceError::duplicate(
            format!(
                "Already saved in {}",
                check.folder_name.as_deref().unwrap_or("this folder")
            ),
            check.item_id,
            check.folder_id,
            check.folder_name,
        ));
    }

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let fields = source_file_fields(&capture, folder_opt, &today);
    let full_file_content = build_item_file(kind, &fields, &capture.markdown, None);

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: kind.to_string(),
        title: title.clone(),
        source_url: Some(capture.url.clone()),
        canonical_url: Some(canonical),
        status: "saved".to_string(),
        error: None,
        markdown: Some(full_file_content.clone()),
        meta: Some(Value::Object(capture.meta.clone())),
        note: None,
        position: None,
    };

    let mut item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

/// Saves one of the 2026-10 source kinds as `unavailable` with the reason the extractor gave
/// (a YouTube video without captions, for example). No file is written.
pub fn save_source_unavailable(
    db: &Database,
    folder_id: &str,
    source: &str,
    url: &str,
    title: &str,
    reason: &str,
) -> Result<Item, ServiceError> {
    let kind = source.trim();
    if !is_source_capture_kind(kind) {
        return Err(ServiceError::bad_request(format!(
            "Unknown source kind \"{}\"",
            source
        )));
    }

    let canonical = canonicalize_url(url).unwrap_or_else(|_| url.to_string());

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: kind.to_string(),
        title: title.to_string(),
        source_url: Some(url.to_string()),
        canonical_url: Some(canonical),
        status: "unavailable".to_string(),
        error: Some(reason.to_string()),
        markdown: None,
        meta: None,
        note: None,
        position: None,
    };

    db.save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn save_x_thread(
    db: &Database,
    folder_id: &str,
    posts: Vec<XPostCapture>,
) -> Result<Item, ServiceError> {
    if posts.is_empty() {
        return Err(ServiceError::bad_request("At least one post is required for X capture"));
    }

    let root_post = &posts[0];
    let canonical = canonicalize_url(&root_post.post_url).unwrap_or_else(|_| root_post.post_url.clone());

    let check = db.check_url(&canonical, folder_id);
    if check.exists {
        return Err(ServiceError::duplicate(
            format!("Already saved in {}", check.folder_name.as_deref().unwrap_or("this folder")),
            check.item_id,
            check.folder_id,
            check.folder_name,
        ));
    }

    let nodes: Vec<XTreeNode> = posts.iter().enumerate().map(|(i, p)| {
        let parent_id = if i == 0 { None } else { Some(posts[i - 1].post_url.clone()) };
        XTreeNode {
            id: p.post_url.clone(),
            parent_id,
            position: i as i32,
            post_url: p.post_url.clone(),
            author_name: p.author_name.clone(),
            handle: p.handle.clone(),
            author_url: p.author_url.clone(),
            posted_at: p.posted_at.clone(),
            text: p.text.clone(),
        }
    }).collect();

    let title = x_thread_title(&nodes);
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let fields = ItemFileFields {
        title: title.clone(),
        url: Some(root_post.post_url.clone()),
        author: Some(root_post.author_name.clone()),
        author_url: if root_post.author_url.is_empty() { None } else { Some(root_post.author_url.clone()) },
        posted: root_post.posted_at.clone(),
        saved: Some(today),
        folder: folder_opt,
        ..Default::default()
    };

    let thread_body = render_x_thread_body(&nodes);
    let full_file_content = build_item_file("x", &fields, &thread_body, None);

    let meta = json!({
        "post_url": root_post.post_url,
        "author": root_post.author_name,
        "author_url": root_post.author_url,
        "posted": root_post.posted_at,
        "post_count": posts.len(),
    });

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "x".to_string(),
        title: title.clone(),
        source_url: Some(root_post.post_url.clone()),
        canonical_url: Some(canonical),
        status: "saved".to_string(),
        error: None,
        markdown: Some(full_file_content.clone()),
        meta: Some(meta),
        note: None,
        position: None,
    };

    let mut item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let mut parent_post_url: Option<String> = None;
    for (i, p) in posts.iter().enumerate() {
        let p_canonical = canonicalize_url(&p.post_url).unwrap_or_else(|_| p.post_url.clone());
        let add_req = AddXPostRequest {
            item_id: item.id.clone(),
            parent_post_url: parent_post_url.clone(),
            post_url: p.post_url.clone(),
            canonical_url: p_canonical,
            author_name: p.author_name.clone(),
            handle: p.handle.clone(),
            author_url: p.author_url.clone(),
            posted_at: p.posted_at.clone(),
            text: p.text.clone(),
            position: Some(i as i32),
        };
        let _ = db.add_x_post(add_req);
        parent_post_url = Some(p.post_url.clone());
    }

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

pub fn add_x_post(
    db: &Database,
    item_id: &str,
    post: XPostCapture,
    parent_post_url: Option<String>,
) -> Result<(String, String), ServiceError> {
    let p_canonical = canonicalize_url(&post.post_url).unwrap_or_else(|_| post.post_url.clone());
    let add_req = AddXPostRequest {
        item_id: item_id.to_string(),
        parent_post_url,
        post_url: post.post_url.clone(),
        canonical_url: p_canonical,
        author_name: post.author_name.clone(),
        handle: post.handle.clone(),
        author_url: post.author_url.clone(),
        posted_at: post.posted_at.clone(),
        text: post.text.clone(),
        position: None,
    };

    let res = db
        .add_x_post(add_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    // Refresh markdown file on disk if item exists
    if let Ok(item) = db.get_item(item_id) {
        if let Ok(all_posts) = db.get_x_posts(item_id) {
            let nodes: Vec<XTreeNode> = all_posts.iter().map(|p| XTreeNode {
                id: p.id.clone(),
                parent_id: p.parent_id.clone(),
                position: p.position,
                post_url: p.post_url.clone(),
                author_name: p.author_name.clone(),
                handle: p.handle.clone(),
                author_url: p.author_url.clone(),
                posted_at: p.posted_at.clone(),
                text: p.text.clone(),
            }).collect();

            let new_title = x_thread_title(&nodes);
            let root_post = all_posts.first();
            let (_, folder_path_str) = resolve_folder_path(db, &item.folder_id);
            let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

            let fields = ItemFileFields {
                title: new_title.clone(),
                url: root_post.map(|p| p.post_url.clone()).or_else(|| item.source_url.clone()),
                author: root_post.map(|p| p.author_name.clone()),
                author_url: root_post.map(|p| p.author_url.clone()),
                posted: root_post.and_then(|p| clean_date(p.posted_at.as_deref())),
                saved: clean_date(Some(&item.created_at)),
                folder: folder_opt,
                ..Default::default()
            };

            let thread_body = render_x_thread_body(&nodes);
            let full_file_content = build_item_file_with_highlights(
                "x",
                &fields,
                &thread_body,
                item.note.as_deref(),
                &item_highlights(db, item_id),
            );

            if new_title != item.title {
                let _ = db.rename_item(item_id, &new_title);
                let storage_root = resolve_storage_dir(db);
                if let Some(old_rel) = &item.storage_path {
                    if let Some(old_file) = safe_storage_path(&storage_root, old_rel) {
                        if old_file.is_file() && is_safe_to_delete(&old_file, &storage_root) {
                            let _ = fs::remove_file(&old_file);
                        }
                    }
                }
            }

            let _ = db.update_item_content(item_id, Some(&new_title), &full_file_content);
            let _ = write_item_file_to_disk(
                db,
                &item.folder_id,
                item_id,
                &new_title,
                "md",
                &item.created_at,
                full_file_content.as_bytes(),
            );
        }
    }

    Ok(res)
}

pub fn recent_x_items(db: &Database, folder_id: &str) -> Result<Vec<RecentXItem>, ServiceError> {
    db.get_recent_x_items(folder_id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

// -----------------------------------------------------------------------------
// Generic Items and Notes
// -----------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn save_generic_item(
    db: &Database,
    folder_id: &str,
    kind: &str,
    title: &str,
    source_url: Option<String>,
    canonical_url: Option<String>,
    markdown: Option<&str>,
    meta: Option<Value>,
    note: Option<&str>,
    position: Option<i32>,
) -> Result<Item, ServiceError> {
    let safe_t = safe_name(title);
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let full_content = if let Some(md) = markdown {
        let fields = ItemFileFields {
            title: safe_t.clone(),
            url: source_url.clone(),
            saved: Some(today.clone()),
            created: Some(today),
            folder: folder_opt,
            ..Default::default()
        };
        Some(build_item_file(kind, &fields, md, note))
    } else {
        None
    };

    let save_req = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: kind.to_string(),
        title: safe_t.clone(),
        source_url,
        canonical_url,
        status: "saved".to_string(),
        error: None,
        markdown: full_content.clone(),
        meta,
        note: note.map(|n| n.to_string()),
        position,
    };

    let mut item = db.save_item(save_req).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    if let Some(content) = &full_content {
        let (_, rel_str) = write_item_file_to_disk(
            db,
            folder_id,
            &item.id,
            &safe_t,
            "md",
            &item.created_at,
            content.as_bytes(),
        )?;
        item.storage_path = Some(rel_str);
    }

    Ok(item)
}

pub fn create_note(
    db: &Database,
    folder_id: &str,
    title: &str,
    markdown: &str,
) -> Result<Item, ServiceError> {
    let safe_t = safe_name(title);
    let (_, folder_path_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };
    let today = Utc::now().format("%Y-%m-%d").to_string();

    let fields = ItemFileFields {
        title: safe_t.clone(),
        created: Some(today),
        folder: folder_opt,
        ..Default::default()
    };
    let full_file_content = build_item_file("note", &fields, markdown, None);

    let item = db.create_standalone_note(folder_id, &safe_t, &full_file_content).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &safe_t,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;

    let mut result = item;
    result.storage_path = Some(rel_str);
    Ok(result)
}

pub fn update_note(
    db: &Database,
    id: &str,
    title: Option<&str>,
    markdown: &str,
) -> Result<(), ServiceError> {
    let item = db.get_item(id).map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))?;
    let new_title = title.map(safe_name).unwrap_or_else(|| item.title.clone());

    let (_, folder_path_str) = resolve_folder_path(db, &item.folder_id);
    let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

    let fields = ItemFileFields {
        title: new_title.clone(),
        created: clean_date(Some(&item.created_at)),
        folder: folder_opt,
        ..Default::default()
    };
    let full_file_content = build_item_file_with_highlights(
        "note",
        &fields,
        markdown,
        None,
        &item_highlights(db, id),
    );

    if new_title != item.title {
        let storage_root = resolve_storage_dir(db);
        if let Some(old_rel) = &item.storage_path {
            if let Some(old_file) = safe_storage_path(&storage_root, old_rel) {
                if old_file.is_file() && is_safe_to_delete(&old_file, &storage_root) {
                    let _ = fs::remove_file(&old_file);
                }
            }
        }
    }

    db.update_standalone_note(id, Some(&new_title), &full_file_content).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    let _ = write_item_file_to_disk(
        db,
        &item.folder_id,
        id,
        &new_title,
        "md",
        &item.created_at,
        full_file_content.as_bytes(),
    )?;

    Ok(())
}

// -----------------------------------------------------------------------------
// Images (offline mode)
// -----------------------------------------------------------------------------

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

pub fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;

    for b in input.bytes() {
        if b.is_ascii_whitespace() || b == b'=' {
            continue;
        }
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("Invalid base64 byte".to_string()),
        } as u32;

        buffer = (buffer << 6) | val;
        bits += 6;

        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Ok(out)
}

pub fn save_image(
    db: &Database,
    folder_id: &str,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<Item, ServiceError> {
    let extension = match image_extension(mime_type) {
        Some(ext) => ext,
        None => return Err(ServiceError::bad_request(
            format!("Unsupported image format: {}", mime_type),
        )),
    };

    if bytes.is_empty() {
        return Err(ServiceError::bad_request("The image file is empty"));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ServiceError::bad_request(format!(
            "Image exceeds maximum size of {} MB",
            MAX_IMAGE_BYTES / (1024 * 1024)
        )));
    }

    let trimmed_name = file_name.trim();
    let base_name = match trimmed_name.rfind('.') {
        Some(index) if index > 0 => trimmed_name[..index].trim(),
        _ => trimmed_name,
    };
    let title: String = safe_name(base_name);

    let request = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "image".to_string(),
        title: title.clone(),
        source_url: None,
        canonical_url: None,
        status: "saved".to_string(),
        error: None,
        markdown: None,
        meta: Some(json!({
            "mime_type": mime_type,
            "file_name": file_name,
            "size": bytes.len(),
        })),
        note: None,
        position: None,
    };
    let mut item = db.save_item(request).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    let (_, rel_str) = write_item_file_to_disk(
        db,
        folder_id,
        &item.id,
        &title,
        extension,
        &item.created_at,
        bytes,
    )?;
    item.storage_path = Some(rel_str);

    Ok(item)
}

// -----------------------------------------------------------------------------
// Folder and Item Management (Disk Synchronization)
// -----------------------------------------------------------------------------

pub fn list_folders(db: &Database) -> Result<Vec<Folder>, ServiceError> {
    Ok(db.get_folders(false))
}

pub fn create_folder(
    db: &Database,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Folder, ServiceError> {
    db.create_folder(name, parent_id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn list_items(db: &Database, folder_id: &str) -> Result<Vec<Item>, ServiceError> {
    Ok(db.get_items(folder_id))
}

pub fn search_items(
    db: &Database,
    query: &str,
    project_id: Option<&str>,
) -> Result<Vec<Item>, ServiceError> {
    db.search_items(query, project_id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn get_item(db: &Database, id: &str) -> Result<Item, ServiceError> {
    db.get_item(id)
        .map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))
}

// -----------------------------------------------------------------------------
// Highlights (offline mode; contract: docs/handoff-highlights.md)
// -----------------------------------------------------------------------------

pub const MAX_HIGHLIGHT_QUOTE: usize = 10_000;
pub const MAX_HIGHLIGHT_NOTE: usize = 5_000;
pub const MAX_HIGHLIGHT_CONTEXT: usize = 64;
pub const MAX_HIGHLIGHT_CITED: usize = 50;

fn validate_highlight_note(note: Option<&str>) -> Result<(), ServiceError> {
    if let Some(n) = note {
        if n.chars().count() > MAX_HIGHLIGHT_NOTE {
            return Err(ServiceError::bad_request(format!(
                "A highlight note can be at most {} characters.",
                MAX_HIGHLIGHT_NOTE
            )));
        }
    }
    Ok(())
}

pub fn validate_highlight_input(input: &HighlightInput) -> Result<(), ServiceError> {
    if input.id.trim().is_empty() {
        return Err(ServiceError::bad_request("A highlight needs an id."));
    }
    if input.item_id.trim().is_empty() {
        return Err(ServiceError::bad_request("A highlight needs an item_id."));
    }
    if input.kind != "text" && input.kind != "image" {
        return Err(ServiceError::bad_request("A highlight's kind must be \"text\" or \"image\"."));
    }
    if input.quote.chars().count() > MAX_HIGHLIGHT_QUOTE {
        return Err(ServiceError::bad_request(format!(
            "A highlighted passage can be at most {} characters.",
            MAX_HIGHLIGHT_QUOTE
        )));
    }
    if input.prefix.chars().count() > MAX_HIGHLIGHT_CONTEXT
        || input.suffix.chars().count() > MAX_HIGHLIGHT_CONTEXT
    {
        return Err(ServiceError::bad_request(format!(
            "A highlight's prefix and suffix can be at most {} characters.",
            MAX_HIGHLIGHT_CONTEXT
        )));
    }
    if input.cited.len() > MAX_HIGHLIGHT_CITED {
        return Err(ServiceError::bad_request(format!(
            "A highlight can cite at most {} references.",
            MAX_HIGHLIGHT_CITED
        )));
    }
    if input.start_offset < 0 || input.end_offset < input.start_offset {
        return Err(ServiceError::bad_request(
            "A highlight's offsets must be non-negative, with end_offset at or after start_offset.",
        ));
    }
    if matches!(input.seconds, Some(sec) if sec < 0) {
        return Err(ServiceError::bad_request("A highlight's seconds can't be negative."));
    }
    validate_highlight_note(input.note.as_deref())
}

/// Rebuilds the item's file (database copy and file on disk) so it carries its current note and
/// `## My highlights` section, and moves the item's updated_at.
fn rewrite_item_file(db: &Database, item_id: &str) {
    let item = match db.get_item(item_id) {
        Ok(i) => i,
        Err(_) => return,
    };
    let _ = db.touch_item(item_id);
    if item.kind == "image" {
        return;
    }
    if let Some(existing_md) = &item.markdown {
        let (body, _) = extract_body_and_note(existing_md);
        let (_, folder_path_str) = resolve_folder_path(db, &item.folder_id);
        let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };
        let fields = item_file_fields(&item, item.title.clone(), folder_opt);
        let updated_md = build_item_file_with_highlights(
            &item.kind,
            &fields,
            &body,
            item.note.as_deref(),
            &item_highlights(db, item_id),
        );
        let _ = db.update_item_content(item_id, None, &updated_md);
        let _ = write_item_file_to_disk(
            db,
            &item.folder_id,
            item_id,
            &item.title,
            "md",
            &item.created_at,
            updated_md.as_bytes(),
        );
    }
}

pub fn list_highlights(
    db: &Database,
    item_id: Option<&str>,
    folder_id: Option<&str>,
) -> Result<Vec<Highlight>, ServiceError> {
    let result = match (item_id, folder_id) {
        (Some(i), _) => db.get_highlights_for_item(i),
        (None, Some(f)) => db.get_highlights_for_folder(f),
        (None, None) => {
            return Err(ServiceError::bad_request("Give an itemId or a folderId."));
        }
    };
    result.map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn put_highlight(db: &Database, input: HighlightInput) -> Result<Highlight, ServiceError> {
    validate_highlight_input(&input)?;
    db.get_item(&input.item_id)
        .map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))?;
    let previous_item = db.get_highlight(&input.id).ok().map(|h| h.item_id);

    let highlight = Highlight {
        id: input.id,
        item_id: input.item_id,
        kind: input.kind,
        quote: input.quote,
        prefix: input.prefix,
        suffix: input.suffix,
        start_offset: input.start_offset,
        end_offset: input.end_offset,
        image_src: input.image_src,
        note: input.note,
        seconds: input.seconds,
        cited: input.cited,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let saved = db
        .put_highlight(&highlight)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    rewrite_item_file(db, &saved.item_id);
    if let Some(old) = previous_item {
        if old != saved.item_id {
            rewrite_item_file(db, &old);
        }
    }
    Ok(saved)
}

pub fn update_highlight_note(
    db: &Database,
    id: &str,
    note: Option<&str>,
) -> Result<Highlight, ServiceError> {
    validate_highlight_note(note)?;
    let saved = db
        .update_highlight_note(id, note)
        .map_err(|_| ServiceError::not_found("Highlight not found."))?;
    rewrite_item_file(db, &saved.item_id);
    Ok(saved)
}

pub fn delete_highlight(db: &Database, id: &str) -> Result<(), ServiceError> {
    let existing = db
        .get_highlight(id)
        .map_err(|_| ServiceError::not_found("Highlight not found."))?;
    db.delete_highlight(id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;
    rewrite_item_file(db, &existing.item_id);
    Ok(())
}

pub fn update_item_note(db: &Database, id: &str, note: Option<&str>) -> Result<(), ServiceError> {
    let item = db.get_item(id).map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))?;
    db.update_item_note(id, note).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    if item.kind != "image" {
        if let Some(existing_md) = &item.markdown {
            let (body, _) = extract_body_and_note(existing_md);
            let (_, folder_path_str) = resolve_folder_path(db, &item.folder_id);
            let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };

            let fields = item_file_fields(&item, item.title.clone(), folder_opt);

            let updated_md = build_item_file_with_highlights(&item.kind, &fields, &body, note, &item_highlights(db, id));
            let _ = db.update_item_content(id, None, &updated_md);
            let _ = write_item_file_to_disk(
                db,
                &item.folder_id,
                id,
                &item.title,
                "md",
                &item.created_at,
                updated_md.as_bytes(),
            );
        }
    }
    Ok(())
}

pub fn rename_item(db: &Database, id: &str, new_title: &str) -> Result<(), ServiceError> {
    let item = db.get_item(id).map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))?;
    let safe_t = safe_name(new_title);
    if safe_t == item.title {
        return Ok(());
    }

    let storage_root = resolve_storage_dir(db);
    let old_file_path = item.storage_path.as_deref().and_then(|p| safe_storage_path(&storage_root, p));

    let ext = if item.kind == "image" {
        old_file_path
            .as_ref()
            .and_then(|p| p.extension().and_then(|e| e.to_str()))
            .unwrap_or("png")
            .to_string()
    } else {
        "md".to_string()
    };

    let (rel_dir, folder_path_str) = resolve_folder_path(db, &item.folder_id);
    let target_dir = storage_root.join(&rel_dir);
    let new_filename = resolve_item_filename(db, &item.folder_id, id, &safe_t, &ext, &item.created_at);
    let new_file_path = target_dir.join(&new_filename);
    let new_rel = rel_dir.join(&new_filename).to_string_lossy().replace('\\', "/");

    // DB change FIRST:
    db.rename_item(id, &safe_t).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;
    let _ = db.update_item_storage_path(id, &new_rel);

    // Disk changes AFTER (on failure keep DB change and log/ignore):
    let _ = fs::create_dir_all(&target_dir);

    if item.kind == "image" {
        if let Some(old_p) = &old_file_path {
            if old_p.is_file() && is_safe_to_delete(old_p, &storage_root) && *old_p != new_file_path {
                let _ = fs::rename(old_p, &new_file_path);
            }
        }
    } else if let Some(existing_md) = &item.markdown {
        let (body, _) = extract_body_and_note(existing_md);
        let folder_opt = if folder_path_str.is_empty() { None } else { Some(folder_path_str) };
        let fields = item_file_fields(&item, safe_t.clone(), folder_opt);
        let updated_md = build_item_file_with_highlights(&item.kind, &fields, &body, item.note.as_deref(), &item_highlights(db, id));

        if let Some(old_p) = &old_file_path {
            if old_p.is_file() && is_safe_to_delete(old_p, &storage_root) && *old_p != new_file_path {
                let _ = fs::remove_file(old_p);
            }
        }
        let _ = fs::write(&new_file_path, updated_md.as_bytes());
        let _ = db.update_item_content(id, Some(&safe_t), &updated_md);
    }

    Ok(())
}

pub fn move_item(db: &Database, id: &str, new_folder_id: &str) -> Result<(), ServiceError> {
    let item = db.get_item(id).map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))?;
    if item.folder_id == new_folder_id {
        return Ok(());
    }

    let storage_root = resolve_storage_dir(db);
    let old_file_path = item.storage_path.as_deref().and_then(|p| safe_storage_path(&storage_root, p));

    let ext = if item.kind == "image" {
        old_file_path
            .as_ref()
            .and_then(|p| p.extension().and_then(|e| e.to_str()))
            .unwrap_or("png")
            .to_string()
    } else {
        "md".to_string()
    };

    // DB change FIRST:
    db.move_item(id, new_folder_id).map_err(|e| {
        ServiceError::internal(format!("Failed to move item: {}", e), "move_failed")
    })?;

    let (new_rel_dir, new_folder_path_str) = resolve_folder_path(db, new_folder_id);
    let target_dir = storage_root.join(&new_rel_dir);
    let new_filename = resolve_item_filename(db, new_folder_id, id, &item.title, &ext, &item.created_at);
    let new_file_path = target_dir.join(&new_filename);
    let new_rel = new_rel_dir.join(&new_filename).to_string_lossy().replace('\\', "/");
    let _ = db.update_item_storage_path(id, &new_rel);

    // Disk changes AFTER (on failure keep DB change and log/ignore):
    let _ = fs::create_dir_all(&target_dir);

    if item.kind == "image" {
        if let Some(old_p) = &old_file_path {
            if old_p.is_file() && is_safe_to_delete(old_p, &storage_root) && *old_p != new_file_path {
                let _ = fs::rename(old_p, &new_file_path);
                if let Some(p) = old_p.parent() {
                    remove_empty_parent_dirs(p, &storage_root);
                }
            }
        }
    } else if let Some(existing_md) = &item.markdown {
        let (body, _) = extract_body_and_note(existing_md);
        let folder_opt = if new_folder_path_str.is_empty() { None } else { Some(new_folder_path_str) };
        let fields = item_file_fields(&item, item.title.clone(), folder_opt);
        let updated_md = build_item_file_with_highlights(&item.kind, &fields, &body, item.note.as_deref(), &item_highlights(db, id));

        if let Some(old_p) = &old_file_path {
            if old_p.is_file() && is_safe_to_delete(old_p, &storage_root) && *old_p != new_file_path {
                let _ = fs::remove_file(old_p);
                if let Some(p) = old_p.parent() {
                    remove_empty_parent_dirs(p, &storage_root);
                }
            }
        }
        let _ = fs::write(&new_file_path, updated_md.as_bytes());
        let _ = db.update_item_content(id, None, &updated_md);
    }

    Ok(())
}

pub fn delete_item(db: &Database, id: &str) -> Result<(), ServiceError> {
    let item = db.get_item(id).map_err(|e| {
        ServiceError::not_found(format!("Item not found: {}", e))
    })?;
    let storage_root = resolve_storage_dir(db);

    // DB delete FIRST:
    db.delete_item(id).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    // Disk delete AFTER (on failure keep DB change and log/ignore):
    if let Some(rel) = &item.storage_path {
        if let Some(file_path) = safe_storage_path(&storage_root, rel) {
            if file_path.is_file() && is_safe_to_delete(&file_path, &storage_root) {
                let _ = fs::remove_file(&file_path);
                if let Some(parent) = file_path.parent() {
                    remove_empty_parent_dirs(parent, &storage_root);
                }
            }
        }
    }

    Ok(())
}

fn sync_folder_items_paths(db: &Database, folder_id: &str) -> Result<(), ServiceError> {
    let (rel_dir, display_str) = resolve_folder_path(db, folder_id);
    let folder_opt = if display_str.is_empty() { None } else { Some(display_str) };

    for it in db.get_items(folder_id) {
        if it.deleted_at.is_some() {
            continue;
        }
        let ext = if it.kind == "image" {
            it.storage_path
                .as_deref()
                .and_then(|p| Path::new(p).extension().and_then(|e| e.to_str()))
                .unwrap_or("png")
        } else {
            "md"
        };
        let filename = resolve_item_filename(db, folder_id, &it.id, &it.title, ext, &it.created_at);
        let rel = rel_dir.join(&filename).to_string_lossy().replace('\\', "/");
        let _ = db.update_item_storage_path(&it.id, &rel);

        if it.kind != "image" {
            if let Some(md) = &it.markdown {
                let (body, _) = extract_body_and_note(md);
                let fields = item_file_fields(&it, it.title.clone(), folder_opt.clone());
                let updated = build_item_file_with_highlights(&it.kind, &fields, &body, it.note.as_deref(), &item_highlights(db, &it.id));
                let _ = db.update_item_content(&it.id, None, &updated);
            }
        }
    }

    for sub in db.get_folders(false) {
        if sub.parent_id.as_deref() == Some(folder_id) {
            sync_folder_items_paths(db, &sub.id)?;
        }
    }

    Ok(())
}

pub fn rename_folder(db: &Database, id: &str, new_name: &str) -> Result<(), ServiceError> {
    let storage_root = resolve_storage_dir(db);
    let (old_rel, _) = resolve_folder_path(db, id);
    let old_dir = storage_root.join(&old_rel);

    // DB change FIRST:
    db.rename_folder(id, new_name).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    // Disk changes AFTER:
    let (new_rel, _) = resolve_folder_path(db, id);
    let new_dir = storage_root.join(&new_rel);

    if old_dir.exists() && old_dir != new_dir && is_safe_to_delete(&old_dir, &storage_root) {
        if let Some(p) = new_dir.parent() {
            let _ = fs::create_dir_all(p);
        }
        let _ = fs::rename(&old_dir, &new_dir);
        if let Some(p) = old_dir.parent() {
            remove_empty_parent_dirs(p, &storage_root);
        }
    }

    let _ = sync_folder_items_paths(db, id);

    Ok(())
}

pub fn move_folder(
    db: &Database,
    id: &str,
    new_parent_id: Option<&str>,
    position: i32,
) -> Result<(), ServiceError> {
    let storage_root = resolve_storage_dir(db);
    let (old_rel, _) = resolve_folder_path(db, id);
    let old_dir = storage_root.join(&old_rel);

    // DB change FIRST:
    db.move_folder(id, new_parent_id, position).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    // Disk changes AFTER:
    let (new_rel, _) = resolve_folder_path(db, id);
    let new_dir = storage_root.join(&new_rel);

    if old_dir.exists() && old_dir != new_dir && is_safe_to_delete(&old_dir, &storage_root) {
        if let Some(p) = new_dir.parent() {
            let _ = fs::create_dir_all(p);
        }
        let _ = fs::rename(&old_dir, &new_dir);
        if let Some(p) = old_dir.parent() {
            remove_empty_parent_dirs(p, &storage_root);
        }
    }

    let _ = sync_folder_items_paths(db, id);

    Ok(())
}

pub fn delete_folder(db: &Database, id: &str) -> Result<(), ServiceError> {
    let storage_root = resolve_storage_dir(db);

    // Collect all descendant folder IDs (including `id`)
    let mut descendant_folder_ids = vec![id.to_string()];
    let all_folders = db.get_folders(false);
    let mut idx = 0;
    while idx < descendant_folder_ids.len() {
        let cur = descendant_folder_ids[idx].clone();
        for f in &all_folders {
            if f.parent_id.as_deref() == Some(&cur) && !descendant_folder_ids.contains(&f.id) {
                descendant_folder_ids.push(f.id.clone());
            }
        }
        idx += 1;
    }

    // Collect all item storage paths and folder directories before DB delete
    let mut items_to_delete = Vec::new();
    let mut folder_dirs = Vec::new();

    for fid in &descendant_folder_ids {
        let (rel_dir, _) = resolve_folder_path(db, fid);
        let full_dir = storage_root.join(rel_dir);
        folder_dirs.push(full_dir);
        for it in db.get_items(fid) {
            if it.deleted_at.is_none() {
                items_to_delete.push(it);
            }
        }
    }

    // 1. Database delete FIRST
    db.delete_folder(id).map_err(|e| {
        ServiceError::internal(format!("Database error: {}", e), "db_error")
    })?;

    // 2. Remove each item's file
    for it in &items_to_delete {
        if let Some(sp) = &it.storage_path {
            if let Some(file_path) = safe_storage_path(&storage_root, sp) {
                if file_path.is_file() && is_safe_to_delete(&file_path, &storage_root) {
                    let _ = fs::remove_file(&file_path);
                }
            }
        }
    }

    // 3. Remove directories only if empty, deepest first (do NOT use fs::remove_dir_all)
    folder_dirs.sort_by_key(|b| std::cmp::Reverse(b.components().count()));
    for dir in &folder_dirs {
        if dir.is_dir() && is_safe_to_delete(dir, &storage_root) {
            let _ = fs::remove_dir(dir);
            if let Some(parent) = dir.parent() {
                remove_empty_parent_dirs(parent, &storage_root);
            }
        }
    }

    Ok(())
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_storage_dir_in_test_is_under_temp_dir() {
        let db = Database::open_in_memory().unwrap();
        let path = resolve_storage_dir(&db);
        let temp_dir = std::env::temp_dir();
        assert!(path.starts_with(&temp_dir), "Expected {:?} to be under temp dir {:?}", path, temp_dir);
        let docs = dirs::document_dir().unwrap_or_else(|| PathBuf::from(".")).join("Sourcefold");
        assert_ne!(path, docs, "resolve_storage_dir must never resolve to real Documents in tests");
    }

    #[test]
    fn test_safe_name_rules() {
        // Rules 1 & 2: Colons become " -", slashes, backslashes, pipes become "-"
        assert_eq!(safe_name("Quantum Computing: A Review"), "Quantum Computing - A Review");
        assert_eq!(safe_name("A/B\\C|D"), "A-B-C-D");
        assert_eq!(safe_name("Chapter 1: The Beginning / Intro"), "Chapter 1 - The Beginning - Intro");

        // Rule 3: Remove < > " ? * and control characters
        assert_eq!(safe_name("What is <this>*? \"Special\""), "What is this Special");
        assert_eq!(safe_name("Hello\u{0000}World\u{001f}\u{007f}!"), "HelloWorld!");

        // Rule 4: Collapse whitespace runs to one space; trim spaces and dots from both ends
        assert_eq!(safe_name("   Hello    world   "), "Hello world");
        assert_eq!(safe_name("..My Document.."), "My Document");
        assert_eq!(safe_name(". . Space and dots . ."), "Space and dots");
        assert_eq!(safe_name("Line1\nLine2\tLine3"), "Line1Line2Line3");

        // Rule 5: Cut to 100 characters at the last word break and trim again
        let long_title = "This is a very long title with many words that will definitely exceed one hundred characters in total length for testing purposes";
        let cut = safe_name(long_title);
        assert!(cut.chars().count() <= 100);
        assert!(!cut.ends_with(' '));
        assert!(!cut.ends_with('.'));
        assert_eq!(cut, "This is a very long title with many words that will definitely exceed one hundred characters in");

        // Rule 5 (single long word > 100 chars):
        let single_word = "a".repeat(120);
        let cut_word = safe_name(&single_word);
        assert_eq!(cut_word.chars().count(), 100);

        // Rule 6: Empty result becomes "Untitled"
        assert_eq!(safe_name(""), "Untitled");
        assert_eq!(safe_name("    "), "Untitled");
        assert_eq!(safe_name("...."), "Untitled");
        assert_eq!(safe_name("<>?*\""), "Untitled");

        // Rule 6: Windows reserved names append " (file)"
        assert_eq!(safe_name("CON"), "CON (file)");
        assert_eq!(safe_name("con"), "con (file)");
        assert_eq!(safe_name("PRN"), "PRN (file)");
        assert_eq!(safe_name("AUX"), "AUX (file)");
        assert_eq!(safe_name("NUL"), "NUL (file)");
        assert_eq!(safe_name("COM1"), "COM1 (file)");
        assert_eq!(safe_name("com9"), "com9 (file)");
        assert_eq!(safe_name("LPT1"), "LPT1 (file)");
        assert_eq!(safe_name("lpt9"), "lpt9 (file)");
        // Non-reserved names do not get suffix
        assert_eq!(safe_name("CONSOLE"), "CONSOLE");
        assert_eq!(safe_name("CONNECT"), "CONNECT");
    }

    #[test]
    fn test_rule_7_collision_resolution() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Tech", None).unwrap();
        let group = db.create_folder("AI", Some(&project.id)).unwrap();

        let it1 = db.save_item(SaveItemRequest {
            folder_id: group.id.clone(),
            kind: "grokipedia".to_string(),
            title: "Artificial Intelligence".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: None,
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        let name1 = resolve_item_filename(&db, &group.id, &it1.id, &it1.title, "md", &it1.created_at);
        assert_eq!(name1, "Artificial Intelligence.md");

        let it2 = db.save_item(SaveItemRequest {
            folder_id: group.id.clone(),
            kind: "grokipedia".to_string(),
            title: "artificial intelligence".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: None,
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        let name2 = resolve_item_filename(&db, &group.id, &it2.id, &it2.title, "md", &it2.created_at);
        assert_eq!(name2, "artificial intelligence (2).md");

        let it3 = db.save_item(SaveItemRequest {
            folder_id: group.id.clone(),
            kind: "grokipedia".to_string(),
            title: "ARTIFICIAL INTELLIGENCE".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: None,
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        let name3 = resolve_item_filename(&db, &group.id, &it3.id, &it3.title, "md", &it3.created_at);
        assert_eq!(name3, "ARTIFICIAL INTELLIGENCE (3).md");
    }

    #[test]
    fn test_x_thread_nested_blockquotes() {
        let nodes: Vec<XTreeNode> = vec![
            XTreeNode {
                id: "1".to_string(),
                parent_id: None,
                position: 0,
                post_url: "https://x.com/alice/status/1".to_string(),
                author_name: "Alice".to_string(),
                handle: "@alice".to_string(),
                author_url: "https://x.com/alice".to_string(),
                posted_at: Some("2026-10-01T12:00:00Z".to_string()),
                text: "First tweet in thread".to_string(),
            },
            XTreeNode {
                id: "2".to_string(),
                parent_id: Some("1".to_string()),
                position: 1,
                post_url: "https://x.com/alice/status/2".to_string(),
                author_name: "Alice".to_string(),
                handle: "alice".to_string(),
                author_url: "https://x.com/alice".to_string(),
                posted_at: Some("2026-10-01T12:05:00Z".to_string()),
                text: "Second tweet replying to first".to_string(),
            },
        ];

        let body = render_x_thread_body(&nodes);
        assert!(body.contains("**Alice** (@alice) · 2026-10-01 · [link](https://x.com/alice/status/1)"));
        assert!(body.contains("> **Alice** (@alice) · 2026-10-01 · [link](https://x.com/alice/status/2)"));
        assert!(body.contains("> Second tweet replying to first"));
        assert!(!body.contains("### Post 1 by"));
    }

    #[test]
    fn test_sync_rename_move_delete_and_cleanup() {
        let db = Database::open_in_memory().unwrap();
        let storage_root = std::env::temp_dir().join(format!("sourcefold-sync-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", storage_root.to_str().unwrap()).unwrap();
        let _ = fs::create_dir_all(&storage_root);

        let p = db.create_folder("Projects", None).unwrap();
        let g1 = db.create_folder("Group1", Some(&p.id)).unwrap();
        let g2 = db.create_folder("Group2", Some(&p.id)).unwrap();

        // 1. Save Substack
        let item = save_substack(&db, &g1.id, SubstackCapture {
            url: "https://news.com/post1".to_string(),
            title: "Post 1".to_string(),
            subtitle: None,
            author: Some("Author".to_string()),
            author_url: None,
            publication: Some("News".to_string()),
            publication_url: None,
            published: Some("2026-10-01".to_string()),
            access: "free".to_string(),
            markdown: "Content of post 1".to_string(),
        }).unwrap();

        let rel1 = item.storage_path.unwrap();
        let file1 = storage_root.join(&rel1);
        assert!(file1.exists(), "File should exist at {:?}", file1);
        assert_eq!(rel1, "Projects/Group1/Post 1.md");

        // 2. Rename item
        rename_item(&db, &item.id, "Post 1 Renamed").unwrap();
        assert!(!file1.exists(), "Old file should be gone");
        let item_renamed = db.get_item(&item.id).unwrap();
        let rel_renamed = item_renamed.storage_path.unwrap();
        assert_eq!(rel_renamed, "Projects/Group1/Post 1 Renamed.md");
        let file_renamed = storage_root.join(&rel_renamed);
        assert!(file_renamed.exists());

        // 3. Move item to Group2
        move_item(&db, &item.id, &g2.id).unwrap();
        assert!(!file_renamed.exists(), "Old file should be gone from Group1");
        let g1_dir = storage_root.join("Projects").join("Group1");
        assert!(!g1_dir.exists(), "Empty Group1 folder should have been removed");

        let item_moved = db.get_item(&item.id).unwrap();
        let rel_moved = item_moved.storage_path.unwrap();
        assert_eq!(rel_moved, "Projects/Group2/Post 1 Renamed.md");
        let file_moved = storage_root.join(&rel_moved);
        assert!(file_moved.exists());

        // 4. Delete item
        delete_item(&db, &item.id).unwrap();
        assert!(!file_moved.exists(), "Deleted file should be removed");
        let g2_dir = storage_root.join("Projects").join("Group2");
        assert!(!g2_dir.exists(), "Empty Group2 folder should have been removed");
        let p_dir = storage_root.join("Projects");
        assert!(!p_dir.exists(), "Empty Projects folder should have been removed");

        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World!", 50), "hello-world");
        assert_eq!(slugify("Quantum Computing: A Review", 50), "quantum-computing-a-review");
        assert_eq!(slugify("  Multiple   Spaces  ---  Here  ", 50), "multiple-spaces-here");
        assert_eq!(slugify("", 50), "untitled");
        assert_eq!(slugify("---", 50), "untitled");
        assert_eq!(slugify("abcdefghij", 5), "abcde");
    }

    #[test]
    fn test_canonicalize_url_x() {
        assert_eq!(
            canonicalize_url("https://twitter.com/User/status/123456?s=20").unwrap(),
            "https://x.com/user/status/123456"
        );
        assert_eq!(
            canonicalize_url("https://x.com/i/web/status/987654321").unwrap(),
            "https://x.com/i/status/987654321"
        );
        assert_eq!(
            canonicalize_url("http://mobile.twitter.com/alice/status/111/").unwrap(),
            "https://x.com/alice/status/111"
        );
    }

    #[test]
    fn test_canonicalize_url_grokipedia() {
        assert_eq!(
            canonicalize_url("https://www.grokipedia.com/page/Rust_%28programming_language%29").unwrap(),
            "https://grokipedia.com/page/Rust_(programming_language)"
        );
        assert_eq!(
            canonicalize_url("https://grokipedia.com/page/Artificial+Intelligence").unwrap(),
            "https://grokipedia.com/page/Artificial_Intelligence"
        );
    }

    #[test]
    fn test_canonicalize_url_general() {
        assert_eq!(
            canonicalize_url("https://WWW.Example.COM/Path/To/Resource/?ref=123").unwrap(),
            "https://example.com/Path/To/Resource"
        );
        assert_eq!(
            canonicalize_url("http://example.com:8080/foo").unwrap(),
            "https://example.com:8080/foo"
        );
    }

    #[test]
    fn test_format_yaml_string_quotes_time_codes() {
        assert_eq!(format_yaml_string("3:33"), "\"3:33\"");
        assert_eq!(format_yaml_string("1:02:10"), "\"1:02:10\"");
        assert_eq!(format_yaml_string("0:00"), "\"0:00\"");
        // Not a sexagesimal number: a 3-digit part can't be one.
        assert_eq!(format_yaml_string("12:345"), "12:345");
        assert_eq!(format_yaml_string("abc:def"), "abc:def");
        assert_eq!(format_yaml_string("auto-generated"), "auto-generated");
    }

    #[test]
    fn test_canonicalize_url_youtube() {
        for link in [
            "https://youtu.be/dQw4w9WgXcQ?t=42",
            "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m2s",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        ] {
            assert_eq!(
                canonicalize_url(link).unwrap(),
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "link: {}",
                link
            );
        }

        assert_eq!(
            canonicalize_url("https://www.youtube.com/playlist?list=PLabc123").unwrap(),
            "https://www.youtube.com/playlist?list=PLabc123"
        );
        assert_eq!(
            canonicalize_url("https://www.youtube.com/@Veritasium/videos").unwrap(),
            "https://www.youtube.com/@veritasium"
        );
        assert_eq!(
            canonicalize_url("https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA").unwrap(),
            "https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA"
        );
        assert_eq!(
            canonicalize_url("https://www.youtube.com/c/name").unwrap(),
            "https://www.youtube.com/c/name"
        );
        assert_eq!(
            canonicalize_url("https://www.youtube.com/user/name/videos").unwrap(),
            "https://www.youtube.com/user/name"
        );
        // A too-short id isn't a video: the link stays an ordinary page (the generic rule drops www.).
        assert_eq!(
            canonicalize_url("https://www.youtube.com/watch?v=short").unwrap(),
            "https://youtube.com/watch?v=short"
        );
    }

    #[test]
    fn test_canonicalize_url_reddit_hacker_news_bluesky_arxiv() {
        for link in [
            "https://old.reddit.com/r/Cars/comments/1abc2d/some_title/",
            "https://www.reddit.com/r/cars/comments/1abc2d/some_title/kx9z1yq/",
            "https://m.reddit.com/r/cars/comments/1ABC2D",
        ] {
            assert_eq!(
                canonicalize_url(link).unwrap(),
                "https://www.reddit.com/r/cars/comments/1abc2d",
                "link: {}",
                link
            );
        }
        assert_eq!(
            canonicalize_url("https://redd.it/1abc2d").unwrap(),
            "https://www.reddit.com/comments/1abc2d"
        );
        assert_eq!(
            canonicalize_url("https://www.reddit.com/comments/1abc2d/x").unwrap(),
            "https://www.reddit.com/comments/1abc2d"
        );
        // Share links keep their own path: only following the redirect names the post.
        assert_eq!(
            canonicalize_url("https://www.reddit.com/r/cars/s/AbC123xyz").unwrap(),
            "https://www.reddit.com/r/cars/s/AbC123xyz"
        );
        // A subreddit page isn't a post: the link stays an ordinary page (the generic rule drops www.).
        assert_eq!(
            canonicalize_url("https://www.reddit.com/r/cars").unwrap(),
            "https://reddit.com/r/cars"
        );

        assert_eq!(
            canonicalize_url("https://news.ycombinator.com/item?id=41234567&p=2").unwrap(),
            "https://news.ycombinator.com/item?id=41234567"
        );
        assert_eq!(
            canonicalize_url("https://news.ycombinator.com/news").unwrap(),
            "https://news.ycombinator.com/news"
        );

        assert_eq!(
            canonicalize_url("https://bsky.app/profile/Jay.bsky.team/post/3l6oveex3ii2l").unwrap(),
            "https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l"
        );
        assert_eq!(
            canonicalize_url("https://bsky.app/profile/did:plc:Abc123/post/3l6oveex3ii2l").unwrap(),
            "https://bsky.app/profile/did:plc:Abc123/post/3l6oveex3ii2l"
        );

        assert_eq!(
            canonicalize_url("https://arxiv.org/pdf/2401.01234v2.pdf").unwrap(),
            "https://arxiv.org/abs/2401.01234"
        );
        assert_eq!(
            canonicalize_url("https://arxiv.org/abs/2401.01234").unwrap(),
            "https://arxiv.org/abs/2401.01234"
        );
        assert_eq!(
            canonicalize_url("https://arxiv.org/html/2401.01234v1").unwrap(),
            "https://arxiv.org/abs/2401.01234"
        );
        assert_eq!(
            canonicalize_url("https://export.arxiv.org/abs/hep-th/9901001v1").unwrap(),
            "https://arxiv.org/abs/hep-th/9901001"
        );
        // An arXiv listing is an ordinary page.
        assert_eq!(
            canonicalize_url("https://arxiv.org/list/cs.AI/recent").unwrap(),
            "https://arxiv.org/list/cs.AI/recent"
        );
    }

    #[test]
    fn test_canonicalize_url_keeps_meaningful_query() {
        assert_eq!(
            canonicalize_url("https://example.com/page?ref=feed&sort=top#section-2").unwrap(),
            "https://example.com/page?sort=top"
        );
        assert_eq!(
            canonicalize_url("https://example.com/article.php?id=5&utm_source=x&UTM_MEDIUM=y&fbclid=z")
                .unwrap(),
            "https://example.com/article.php?id=5"
        );
        assert_eq!(
            canonicalize_url("https://example.com/article.php?id=6").unwrap(),
            "https://example.com/article.php?id=6"
        );
        assert_eq!(
            canonicalize_url("https://example.com/p?b=2&utm_source=x&a=1&fbclid=z&si=q&ref=feed")
                .unwrap(),
            "https://example.com/p?b=2&a=1"
        );
        // Encoded like JS `URLSearchParams.toString()`: spaces become `+`.
        assert_eq!(
            canonicalize_url("https://example.com/search?q=a%20b").unwrap(),
            "https://example.com/search?q=a+b"
        );

        // Substack posts never need a query.
        assert_eq!(
            canonicalize_url("https://name.substack.com/p/a-post?r=abc").unwrap(),
            "https://name.substack.com/p/a-post"
        );
        assert_eq!(
            canonicalize_url("https://www.noahpinion.blog/p/a-post?r=abc").unwrap(),
            "https://noahpinion.blog/p/a-post"
        );
        // A `/p/<slug>` path on any other host is treated as a Substack-style post too.
        assert_eq!(
            canonicalize_url("https://example.com/p/a-post?r=abc").unwrap(),
            "https://example.com/p/a-post"
        );
    }

    #[test]
    fn test_capture_payload_deserializes_source_kinds() {
        let payload: CapturePayload = serde_json::from_value(json!({
            "kind": "reddit",
            "folder_id": "f1",
            "capture": {
                "url": "https://www.reddit.com/r/cars/comments/1abc2d",
                "title": "Should I turbo my car?",
                "meta": { "subreddit": "cars", "score": 532 },
                "markdown": "Body"
            }
        }))
        .unwrap();
        match payload {
            CapturePayload::Reddit { folder_id, capture } => {
                assert_eq!(folder_id, "f1");
                assert_eq!(capture.meta.get("score"), Some(&json!(532)));
                assert_eq!(capture.title, "Should I turbo my car?");
            }
            other => panic!("expected a Reddit capture, got {:?}", other),
        }

        let unavailable: CapturePayload = serde_json::from_value(json!({
            "kind": "source_unavailable",
            "folder_id": "f1",
            "source": "youtube",
            "url": "https://www.youtube.com/watch?v=abcDEF12345",
            "title": "No captions video",
            "reason": "No captions on this video"
        }))
        .unwrap();
        match unavailable {
            CapturePayload::SourceUnavailable { source, reason, .. } => {
                assert_eq!(source, "youtube");
                assert_eq!(reason, "No captions on this video");
            }
            other => panic!("expected an unavailable capture, got {:?}", other),
        }
    }

    #[test]
    fn test_source_kind_front_matter_numbers_and_order() {
        let mut meta = serde_json::Map::new();
        meta.insert("subreddit".to_string(), json!("cars"));
        meta.insert("score".to_string(), json!("532"));
        meta.insert("comments".to_string(), json!(87));
        meta.insert("posted".to_string(), json!("2026-10-15T10:00:00Z"));

        let fields = ItemFileFields {
            title: "T".to_string(),
            url: Some("https://www.reddit.com/r/cars/comments/1abc2d".to_string()),
            saved: Some("2026-10-16".to_string()),
            meta,
            ..Default::default()
        };

        let file = build_item_file("reddit", &fields, "Body", None);
        let expected_front_matter = "---\nsource: reddit\ntitle: T\n\
            url: https://www.reddit.com/r/cars/comments/1abc2d\nsubreddit: cars\n\
            posted: 2026-10-15\nscore: 532\ncomments: 87\nsaved: 2026-10-16\n---\n\n";
        assert!(
            file.starts_with(expected_front_matter),
            "front matter was wrong:\n{}",
            file
        );
    }

    #[test]
    fn test_collapse_duplicate_citations() {
        let input = "Claim one[^1] and claim two[^2][^2] and claim three[^3] [^3] end.";
        let expected = "Claim one[^1] and claim two[^2] and claim three[^3] end.";
        assert_eq!(collapse_duplicate_citations(input), expected);

        let input_different = "Multiple citations[^1][^2][^3] remain intact.";
        assert_eq!(collapse_duplicate_citations(input_different), input_different);

        // Run with duplicate in run
        let run_input = "Run with dupes [^76][^77][^76]";
        assert_eq!(collapse_duplicate_citations(run_input), "Run with dupes [^76][^77]");
    }

    #[test]
    fn test_grokipedia_parser_realistic_fixture() {
        let html_content = r##"
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="description" content="A comprehensive analysis of artificial intelligence impacts across sectors.">
        </head>
        <body>
            <article>
                <div data-fact-checked-at="2026-04-12T00:00:00Z" class="fact-checked-date"></div>
                <h1>Impact of Artificial Intelligence</h1>
                <p>Artificial intelligence has <strong>rapidly transformed</strong> modern society[^1][^1]. From healthcare to transportation, the effects are profound.</p>
                <div class="toc"><nav>TOC</nav></div>
                <h2>Healthcare Applications</h2>
                <p>Diagnostic imaging has seen remarkable gains[^2]. Machine learning models now assist radiologists worldwide.</p>
                <div id="references">
                    <h2>References</h2>
                    <ol class="references">
                        <li id="ref-1"><a href="https://nature.com/articles/ai-overview">Global AI Transformation Overview</a></li>
                        <li id="ref-2"><a href="https://thelancet.com/ai-radiology">Diagnostic Accuracy in Clinical AI</a></li>
                    </ol>
                </div>
            </article>
        </body>
        </html>
        "##;

        let page_url = "https://grokipedia.com/page/Impact_of_Artificial_Intelligence";
        let article = parse_grokipedia_html(html_content, page_url).unwrap();

        assert_eq!(article.title, "Impact of Artificial Intelligence");
        assert_eq!(article.summary.as_deref(), Some("A comprehensive analysis of artificial intelligence impacts across sectors."));
        assert_eq!(article.fact_checked_at.as_deref(), Some("2026-04-12T00:00:00Z"));
        assert_eq!(article.references.len(), 2);

        let fields = ItemFileFields {
            title: article.title.clone(),
            url: Some(page_url.to_string()),
            summary: article.summary.clone(),
            fact_checked: article.fact_checked_at.clone(),
            saved: Some("2026-10-15".to_string()),
            folder: Some("Research/AI".to_string()),
            ..Default::default()
        };
        let body_md = build_grokipedia_markdown(&article);
        let md = build_item_file("grokipedia", &fields, &body_md, None);

        assert!(md.contains("source: grokipedia\n"));
        assert!(md.contains("title: Impact of Artificial Intelligence\n"));
        assert!(md.contains("url: https://grokipedia.com/page/Impact_of_Artificial_Intelligence\n"));
        assert!(md.contains("summary: A comprehensive analysis of artificial intelligence impacts across sectors.\n"));
        assert!(md.contains("fact_checked: 2026-04-12\n"));
        assert!(md.contains("saved: 2026-10-15\n"));
        assert!(md.contains("folder: Research/AI\n"));
        assert!(md.contains("# Impact of Artificial Intelligence"));
        assert!(md.contains("**rapidly transformed**"));
        assert!(md.contains("## Healthcare Applications"));
        assert!(md.contains("## References"));
        assert!(md.contains("[^1]: [Global AI Transformation Overview](https://nature.com/articles/ai-overview) - nature.com"));
    }

    #[test]
    fn test_substack_fixture_and_markdown_generation() {
        let capture = SubstackCapture {
            url: "https://example.substack.com/p/the-future-of-computing".to_string(),
            title: "The Future of Computing".to_string(),
            subtitle: Some("Why decentralized systems will dominate".to_string()),
            author: Some("Alan Turing".to_string()),
            author_url: Some("https://substack.com/@alanturing".to_string()),
            publication: Some("Computing Weekly".to_string()),
            publication_url: Some("https://example.substack.com".to_string()),
            published: Some("2026-09-01T14:30:00.000Z".to_string()),
            access: "free".to_string(),
            markdown: "Modern computing is at an inflection point.\n\nDecentralized architecture provides fault tolerance.".to_string(),
        };

        let generated = build_substack_markdown(&capture, "Technology/Computing", "2026-10-15");
        let expected = "---\nsource: substack\ntitle: The Future of Computing\nsubtitle: Why decentralized systems will dominate\nurl: https://example.substack.com/p/the-future-of-computing\nauthor: Alan Turing\nauthor_url: https://substack.com/@alanturing\npublication: Computing Weekly\npublication_url: https://example.substack.com\npublished: 2026-09-01\naccess: free\nsaved: 2026-10-15\nfolder: Technology/Computing\n---\n\n# The Future of Computing\n\n*Why decentralized systems will dominate*\n\n> Saved from [Computing Weekly](https://example.substack.com/p/the-future-of-computing) on 2026-10-15. By Alan Turing. Published 2026-09-01.\n\nModern computing is at an inflection point.\n\nDecentralized architecture provides fault tolerance.\n";

        assert_eq!(generated, expected);
    }

    #[test]
    fn test_wikipedia_markdown_generation() {
        let capture = WikipediaCapture {
            url: "https://en.wikipedia.org/wiki/Turbocharger".to_string(),
            title: "Turbocharger".to_string(),
            summary: Some("Exhaust-powered forced-induction device for engines".to_string()),
            language: Some("en".to_string()),
            revision: Some("1376335656".to_string()),
            last_edited: Some("2026-09-23T14:44:34Z".to_string()),
            markdown: "Lead.\n\n## History\n\nText.[^1]\n\n## References\n\n[^1]: Source.".to_string(),
        };

        let generated = build_wikipedia_markdown(&capture, "Cars/Engines", "2026-10-15");
        let expected = "---\nsource: wikipedia\ntitle: Turbocharger\nurl: https://en.wikipedia.org/wiki/Turbocharger\nsummary: Exhaust-powered forced-induction device for engines\nlanguage: en\nrevision: 1376335656\nlast_edited: 2026-09-23\nsaved: 2026-10-15\nfolder: Cars/Engines\n---\n\n# Turbocharger\n\n> Saved from [Wikipedia](https://en.wikipedia.org/wiki/Turbocharger) on 2026-10-15. Wikipedia articles change; check the live page for edits.\n\nLead.\n\n## History\n\nText.[^1]\n\n## References\n\n[^1]: Source.\n";
        assert_eq!(generated, expected);
    }

    #[test]
    fn test_wikipedia_offline_capture_saves_a_file_and_keeps_its_front_matter() {
        let db = Database::open_in_memory().unwrap();
        let storage_root = std::env::temp_dir()
            .join(format!("sourcefold-wikipedia-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", storage_root.to_str().unwrap()).unwrap();
        let _ = fs::create_dir_all(&storage_root);
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        // The same JSON the webview sends through the `capture` command.
        let request = json!({
            "kind": "wikipedia",
            "folder_id": group.id,
            "capture": {
                "url": "https://en.wikipedia.org/wiki/Turbocharger",
                "title": "Turbocharger",
                "summary": "Exhaust-powered forced-induction device for engines",
                "language": "en",
                "revision": "1376335656",
                "lastEdited": "2026-09-23T14:44:34Z",
                "markdown": "Lead paragraph.\n\n## History\n\nText.\n"
            }
        });
        let payload: CapturePayload = serde_json::from_value(request.clone()).unwrap();
        let (folder_id, capture) = match payload {
            CapturePayload::Wikipedia { folder_id, capture } => (folder_id, capture),
            other => panic!("expected a Wikipedia capture, got {:?}", other),
        };

        let item = save_wikipedia(&db, &folder_id, capture).unwrap();
        assert_eq!(item.kind, "wikipedia");
        assert_eq!(item.title, "Turbocharger");
        assert_eq!(item.canonical_url.as_deref(), Some("https://en.wikipedia.org/wiki/Turbocharger"));
        assert_eq!(item.meta["revision"], "1376335656");
        assert_eq!(item.storage_path.as_deref(), Some("Cars/Engines/Turbocharger.md"));

        let file = storage_root.join("Cars/Engines/Turbocharger.md");
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.starts_with("---\nsource: wikipedia\ntitle: Turbocharger\nurl: https://en.wikipedia.org/wiki/Turbocharger\nsummary: Exhaust-powered forced-induction device for engines\nlanguage: en\nrevision: 1376335656\nlast_edited: 2026-09-23\nsaved: "));
        assert!(text.contains("\nfolder: Cars/Engines\n---\n\n# Turbocharger\n\n> Saved from [Wikipedia](https://en.wikipedia.org/wiki/Turbocharger) on "));
        assert!(text.ends_with("Lead paragraph.\n\n## History\n\nText.\n"));

        // The same link twice in one group is a duplicate.
        let again: CapturePayload = serde_json::from_value(request).unwrap();
        if let CapturePayload::Wikipedia { folder_id, capture } = again {
            let err = save_wikipedia(&db, &folder_id, capture).unwrap_err();
            assert_eq!(err.code, "duplicate");
        }

        // Renaming rebuilds the file; the Wikipedia fields must survive.
        rename_item(&db, &item.id, "Turbo").unwrap();
        let renamed = fs::read_to_string(storage_root.join("Cars/Engines/Turbo.md")).unwrap();
        assert!(renamed.starts_with("---\nsource: wikipedia\ntitle: Turbo\nurl: https://en.wikipedia.org/wiki/Turbocharger\nsummary: Exhaust-powered forced-induction device for engines\nlanguage: en\nrevision: 1376335656\nlast_edited: 2026-09-23\nsaved: "));
        assert!(!file.exists());

        // Only Wikipedia addresses are accepted under this kind.
        let bad = WikipediaCapture {
            url: "https://example.com/wiki/Turbocharger".to_string(),
            title: "Turbocharger".to_string(),
            summary: None,
            language: None,
            revision: None,
            last_edited: None,
            markdown: "x".to_string(),
        };
        assert!(save_wikipedia(&db, &group.id, bad).is_err());

        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn test_parse_nested_markup() {
        let html = r##"
        <article>
            <h1>Test Nested</h1>
            <p>a <b>bold <i>nested</i></b> <a href="https://example.com">link</a></p>
            <div id="toc">
                <div><span>Nested TOC item</span></div>
            </div>
            <div class="toc">
                <nav>Table of contents</nav>
            </div>
            <h2>References</h2>
            <div id="references">
                <ol>
                    <li id="ref-1"><a href="https://test.com">Test Ref</a></li>
                </ol>
            </div>
        </article>
        "##;

        let article = parse_grokipedia_html(html, "https://grokipedia.com/page/Test_Nested").unwrap();
        assert_eq!(article.title, "Test Nested");
        assert!(article.body_markdown.contains("[link](https://example.com)"));
        assert!(!article.body_markdown.contains("Nested TOC item"));
        assert!(!article.body_markdown.contains("Table of contents"));
        assert_eq!(article.references.len(), 1);
    }

    #[test]
    fn test_decode_base64() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVsbG8").unwrap(), b"hello");
        assert_eq!(decode_base64("aGVs\nbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        assert!(decode_base64("a*b").is_err());
    }

    #[test]
    fn test_save_image_writes_file_and_item() {
        let db = Database::open_in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("sourcefold-image-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", root.to_str().unwrap()).unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        let item = save_image(&db, &group.id, "My Photo.PNG", "image/png", b"not really a png").unwrap();
        assert_eq!(item.kind, "image");
        assert_eq!(item.title, "My Photo");
        assert_eq!(item.meta["size"], 16);
        let path = item.storage_path.clone().unwrap();
        assert!(path.ends_with(".png"));
        assert_eq!(path, "Cars/Engines/My Photo.png");
        assert_eq!(fs::read(root.join(&path)).unwrap(), b"not really a png");
        assert_eq!(db.get_item(&item.id).unwrap().storage_path.as_deref(), Some(path.as_str()));
        assert_eq!(db.get_items(&group.id).len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_save_image_rejects_bad_input() {
        let db = Database::open_in_memory().unwrap();
        let root = std::env::temp_dir().join(format!("sourcefold-image-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", root.to_str().unwrap()).unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        assert!(save_image(&db, &group.id, "a.svg", "image/svg+xml", b"x").is_err());
        assert!(save_image(&db, &group.id, "a.png", "image/png", b"").is_err());
        let too_big = vec![0u8; MAX_IMAGE_BYTES + 1];
        assert!(save_image(&db, &group.id, "a.png", "image/png", &too_big).is_err());
        // Images can't be saved straight into a project.
        assert!(save_image(&db, &project.id, "a.png", "image/png", b"x").is_err());
        assert!(db.get_items(&group.id).is_empty());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn youtube_source_line_names_translated_transcripts() {
        let mut meta = serde_json::Map::new();
        meta.insert("channel".to_string(), json!("Someone"));
        meta.insert("captions".to_string(), json!("translated"));
        let fields = ItemFileFields {
            url: Some("https://www.youtube.com/watch?v=abcDEF12345".to_string()),
            saved: Some("2026-10-17".to_string()),
            meta,
            ..Default::default()
        };
        assert_eq!(
            source_kind_source_line("youtube", &fields),
            "> Saved from [YouTube](https://www.youtube.com/watch?v=abcDEF12345) on 2026-10-17. By Someone. Transcript machine-translated into English by YouTube."
        );
    }

    #[test]
    fn test_save_source_writes_file_and_rename_rebuilds_it() {
        let db = Database::open_in_memory().unwrap();
        let root =
            std::env::temp_dir().join(format!("sourcefold-source-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", root.to_str().unwrap()).unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        let mut meta = serde_json::Map::new();
        meta.insert("channel".to_string(), json!("Engineering Explained"));
        meta.insert("duration".to_string(), json!("1:02:10"));
        meta.insert("published".to_string(), json!("2026-09-30"));
        meta.insert("captions".to_string(), json!("auto-generated"));
        let capture = SourceCapture {
            url: "https://www.youtube.com/watch?v=abcDEF12345".to_string(),
            title: "How a Turbocharger Works".to_string(),
            meta,
            markdown: "## Transcript\n\n[0:00](https://youtu.be/abcDEF12345?t=0) Hello.".to_string(),
        };

        let item = save_source(&db, &group.id, "youtube", capture).unwrap();
        assert_eq!(item.kind, "youtube");
        assert_eq!(item.status, "saved");
        assert_eq!(
            item.canonical_url.as_deref(),
            Some("https://www.youtube.com/watch?v=abcDEF12345")
        );
        let path = item.storage_path.clone().unwrap();
        assert_eq!(path, "Cars/Engines/How a Turbocharger Works.md");

        let content = fs::read_to_string(root.join(&path)).unwrap();
        assert_eq!(content, item.markdown.clone().unwrap());
        assert!(content.contains("channel: Engineering Explained\n"));
        assert!(content.contains("duration: \"1:02:10\"\n"));
        assert!(content.contains("captions: auto-generated\n"));
        assert!(content.contains("Transcript from auto-generated captions."));
        assert!(!content.contains("machine-translated"));

        // Renaming rebuilds the file from the item's own meta, so every other field is unchanged.
        rename_item(&db, &item.id, "Turbo Basics").unwrap();
        let renamed = db.get_item(&item.id).unwrap();
        let renamed_path = renamed.storage_path.clone().unwrap();
        assert_eq!(renamed_path, "Cars/Engines/Turbo Basics.md");

        let rebuilt = fs::read_to_string(root.join(&renamed_path)).unwrap();
        assert!(rebuilt.starts_with("---\nsource: youtube\ntitle: Turbo Basics\n"));
        assert!(rebuilt.contains("# Turbo Basics\n"));
        assert!(rebuilt.contains("\nduration: \"1:02:10\"\n"));
        assert!(!root.join(&path).exists());

        // Everything but the title itself is rebuilt identically from the item's own meta.
        let rebuilds_same = |file: &str| -> Vec<String> {
            file.lines()
                .filter(|line| !line.starts_with("# ") && !line.starts_with("title:"))
                .map(str::to_string)
                .collect()
        };
        assert_eq!(rebuilds_same(&content), rebuilds_same(&rebuilt));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_save_source_rejects_unknown_kind_and_duplicates() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        let capture = || SourceCapture {
            url: "https://www.reddit.com/r/cars/comments/1abc2d".to_string(),
            title: "Should I turbo my car?".to_string(),
            meta: serde_json::Map::new(),
            markdown: "Body".to_string(),
        };

        assert!(save_source(&db, &group.id, "grokipedia", capture()).is_err());

        save_source(&db, &group.id, "reddit", capture()).unwrap();
        let duplicate = save_source(&db, &group.id, "reddit", capture());
        assert!(duplicate.is_err());
        // Every form of the same post is the same canonical address.
        let mut again = capture();
        again.url = "https://old.reddit.com/r/Cars/comments/1ABC2D/some_title/".to_string();
        assert!(save_source(&db, &group.id, "reddit", again).is_err());
    }

    #[test]
    fn test_save_source_unavailable_validates_source() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();

        let item = save_source_unavailable(
            &db,
            &group.id,
            "youtube",
            "https://www.youtube.com/watch?v=abcDEF12345",
            "No captions video",
            "No captions on this video",
        )
        .unwrap();
        assert_eq!(item.kind, "youtube");
        assert_eq!(item.status, "unavailable");
        assert_eq!(item.error.as_deref(), Some("No captions on this video"));
        assert!(item.markdown.is_none());
        assert!(item.storage_path.is_none());

        let unknown = save_source_unavailable(
            &db,
            &group.id,
            "grokipedia",
            "https://example.com",
            "x",
            "y",
        );
        assert!(unknown.is_err());
    }

    // --- Highlights ---

    fn hl_input(id: &str, item_id: &str, quote: &str, start: i64) -> HighlightInput {
        HighlightInput {
            id: id.to_string(),
            item_id: item_id.to_string(),
            kind: "text".to_string(),
            quote: quote.to_string(),
            prefix: String::new(),
            suffix: String::new(),
            start_offset: start,
            end_offset: start + quote.chars().count() as i64,
            image_src: None,
            note: None,
            seconds: None,
            cited: Vec::new(),
        }
    }

    fn hl_item(db: &Database, group_id: &str, title: &str, url: &str) -> Item {
        save_generic_item(
            db,
            group_id,
            "youtube",
            title,
            Some(url.to_string()),
            Some(url.to_string()),
            Some("## Transcript\n\nSome words here."),
            None,
            None,
            None,
        )
        .unwrap()
    }

    fn hl_file(db: &Database, item_id: &str) -> String {
        let item = db.get_item(item_id).unwrap();
        let root = resolve_storage_dir(db);
        fs::read_to_string(root.join(item.storage_path.unwrap())).unwrap()
    }

    fn hl_setup() -> (Database, Folder) {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();
        (db, group)
    }

    #[test]
    fn test_highlight_time_format_and_video_ids() {
        assert_eq!(format_highlight_time(0), "0:00");
        assert_eq!(format_highlight_time(47), "0:47");
        assert_eq!(format_highlight_time(3599), "59:59");
        assert_eq!(format_highlight_time(3725), "1:02:05");
        for url in [
            "https://www.youtube.com/watch?v=abcDEF12345",
            "https://youtu.be/abcDEF12345?t=5",
            "https://www.youtube.com/shorts/abcDEF12345",
            "https://www.youtube.com/live/abcDEF12345?feature=share",
            "https://www.youtube.com/embed/abcDEF12345",
            "https://m.youtube.com/watch?feature=x&v=abcDEF12345",
        ] {
            assert_eq!(youtube_video_id(url).as_deref(), Some("abcDEF12345"), "{}", url);
        }
        assert_eq!(youtube_video_id("https://example.com/watch?v=abcDEF12345"), None);
        assert_eq!(youtube_video_id("not a url"), None);
        assert_eq!(youtube_video_id("https://www.youtube.com/"), None);
    }

    #[test]
    fn test_highlights_section_matches_contract_example() {
        let mk = |id: &str, kind: &str, quote: &str, start: i64| Highlight {
            id: id.to_string(),
            item_id: "i".to_string(),
            kind: kind.to_string(),
            quote: quote.to_string(),
            prefix: String::new(),
            suffix: String::new(),
            start_offset: start,
            end_offset: start,
            image_src: None,
            note: None,
            seconds: None,
            cited: Vec::new(),
            created_at: "2026-10-16T12:00:00Z".to_string(),
            updated_at: "2026-10-16T12:00:00Z".to_string(),
        };
        let mut a = mk("a", "text", "The exhaust spins a turbine,\n and the turbine drives a compressor.", 10);
        a.seconds = Some(47);
        a.note = Some("Intro line for the script".to_string());
        let mut b = mk("b", "image", "Cutaway of a turbocharger", 20);
        b.image_src = Some("https://example.com/turbo.png".to_string());
        let mut c = mk("c", "text", "Turbo lag was the main obstacle to early adoption.", 30);
        c.note = Some("Check the date".to_string());
        c.cited = vec![crate::models::HighlightCitation {
            n: "1".to_string(),
            title: None,
            url: "https://www.sae.org/paper".to_string(),
        }];
        // Given out of order on purpose.
        let section = build_highlights_section(
            &[c, a, b],
            Some("https://www.youtube.com/watch?v=abcDEF12345"),
        )
        .unwrap();
        let expected = "## My highlights\n\n\
> The exhaust spins a turbine, and the turbine drives a compressor.\n\n\
[0:47](https://youtu.be/abcDEF12345?t=47) · Note: Intro line for the script\n\n\
![Cutaway of a turbocharger](https://example.com/turbo.png)\n\n\
> Turbo lag was the main obstacle to early adoption.\n\n\
Cited: [sae.org](https://www.sae.org/paper) · Note: Check the date";
        assert_eq!(section, expected);
        assert!(build_highlights_section(&[], None).is_none());
    }

    #[test]
    fn test_timestamp_without_video_id_is_plain_text() {
        let mut h = Highlight {
            id: "a".into(),
            item_id: "i".into(),
            kind: "text".into(),
            quote: "q".into(),
            prefix: String::new(),
            suffix: String::new(),
            start_offset: 0,
            end_offset: 1,
            image_src: None,
            note: None,
            seconds: Some(125),
            cited: Vec::new(),
            created_at: "t".into(),
            updated_at: "t".into(),
        };
        let section = build_highlights_section(&[h.clone()], Some("https://example.com/v")).unwrap();
        assert_eq!(section, "## My highlights\n\n> q\n\n2:05");
        h.seconds = None;
        assert_eq!(build_highlights_section(&[h], None).unwrap(), "## My highlights\n\n> q");
    }

    #[test]
    fn test_put_highlight_creates_replaces_and_rewrites_file() {
        let (db, group) = hl_setup();
        let url = "https://www.youtube.com/watch?v=abcDEF12345";
        let item = hl_item(&db, &group.id, "Highlight create", url);
        assert!(!hl_file(&db, &item.id).contains("## My highlights"));

        let mut input = hl_input("h1", &item.id, "Some words", 5);
        input.seconds = Some(47);
        input.cited = vec![crate::models::HighlightCitation {
            n: "1".into(),
            title: Some("T".into()),
            url: "https://example.com/a b".into(),
        }];
        let saved = put_highlight(&db, input.clone()).unwrap();
        assert_eq!(saved.id, "h1");
        assert_eq!(saved.cited.len(), 1);
        assert!(!saved.created_at.is_empty());

        let file = hl_file(&db, &item.id);
        assert!(file.contains(
            "## My highlights\n\n> Some words\n\n[0:47](https://youtu.be/abcDEF12345?t=47) · Cited: [example.com](<https://example.com/a b>)\n"
        ));
        // The stored copy matches the file on disk and the body does not grow on each rewrite.
        assert_eq!(db.get_item(&item.id).unwrap().markdown.unwrap(), file);
        assert_eq!(file.matches("## Transcript").count(), 1);

        // Same id replaces, keeping created_at.
        let mut changed = input;
        changed.quote = "Other words".into();
        changed.seconds = None;
        changed.cited = Vec::new();
        let replaced = put_highlight(&db, changed).unwrap();
        assert_eq!(replaced.created_at, saved.created_at);
        let all = list_highlights(&db, Some(&item.id), None).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].quote, "Other words");
        let file = hl_file(&db, &item.id);
        assert!(file.contains("> Other words"));
        assert!(!file.contains("> Some words"));
    }

    #[test]
    fn test_highlights_move_item_updated_at() {
        let (db, group) = hl_setup();
        let item = hl_item(&db, &group.id, "Highlight touch", "https://youtu.be/abcDEF12345");
        let before = db.get_item(&item.id).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(5));
        put_highlight(&db, hl_input("h1", &item.id, "Some", 0)).unwrap();
        let after_put = db.get_item(&item.id).unwrap().updated_at;
        assert!(after_put > before);
        std::thread::sleep(std::time::Duration::from_millis(5));
        update_highlight_note(&db, "h1", Some("n")).unwrap();
        let after_note = db.get_item(&item.id).unwrap().updated_at;
        assert!(after_note > after_put);
        std::thread::sleep(std::time::Duration::from_millis(5));
        delete_highlight(&db, "h1").unwrap();
        assert!(db.get_item(&item.id).unwrap().updated_at > after_note);
    }

    #[test]
    fn test_highlight_note_update_and_delete() {
        let (db, group) = hl_setup();
        let item = hl_item(&db, &group.id, "Highlight note", "https://youtu.be/abcDEF12345");
        put_highlight(&db, hl_input("h1", &item.id, "Some words", 0)).unwrap();

        let updated = update_highlight_note(&db, "h1", Some("Check\nthis")).unwrap();
        assert_eq!(updated.note.as_deref(), Some("Check\nthis"));
        assert!(hl_file(&db, &item.id).contains("> Some words\n\nNote: Check this\n"));

        let cleared = update_highlight_note(&db, "h1", None).unwrap();
        assert!(cleared.note.is_none());
        assert!(!hl_file(&db, &item.id).contains("Note: Check"));

        assert!(update_highlight_note(&db, "missing", Some("x")).is_err());
        assert!(update_highlight_note(&db, "h1", Some(&"x".repeat(5001))).is_err());

        delete_highlight(&db, "h1").unwrap();
        assert!(list_highlights(&db, Some(&item.id), None).unwrap().is_empty());
        assert!(!hl_file(&db, &item.id).contains("## My highlights"));
        assert!(delete_highlight(&db, "h1").is_err());
    }

    #[test]
    fn test_highlights_file_keeps_item_note_after_highlights() {
        let (db, group) = hl_setup();
        let item = hl_item(&db, &group.id, "Highlight with note", "https://youtu.be/abcDEF12345");
        update_item_note(&db, &item.id, Some("My own thoughts")).unwrap();
        put_highlight(&db, hl_input("h1", &item.id, "Some words", 0)).unwrap();
        let file = hl_file(&db, &item.id);
        let hl = file.find("## My highlights").unwrap();
        let note = file.find("## My note").unwrap();
        assert!(hl < note);
        assert!(file.ends_with("## My note\n\nMy own thoughts\n"));

        // Rewriting the note keeps the highlights, and neither section leaks into the body.
        update_item_note(&db, &item.id, Some("Changed")).unwrap();
        let file = hl_file(&db, &item.id);
        assert_eq!(file.matches("## My highlights").count(), 1);
        assert!(file.contains("> Some words"));
        assert!(file.ends_with("## My note\n\nChanged\n"));

        let (body, note) = extract_body_and_note(&file);
        assert!(!body.contains("My highlights"));
        assert_eq!(note.as_deref(), Some("Changed"));
        assert!(!clean_body_markdown("youtube", &file, None).contains("My highlights"));
    }

    #[test]
    fn test_list_highlights_by_item_and_folder_in_order() {
        let (db, group) = hl_setup();
        let other_group = db
            .create_folder("Other", Some(&db.get_folder(&group.id).unwrap().parent_id.unwrap()))
            .unwrap();
        let a = hl_item(&db, &group.id, "List A", "https://youtu.be/aaaaaaaaaaa");
        let b = hl_item(&db, &group.id, "List B", "https://youtu.be/bbbbbbbbbbb");
        let c = hl_item(&db, &other_group.id, "List C", "https://youtu.be/ccccccccccc");

        put_highlight(&db, hl_input("a2", &a.id, "late", 50)).unwrap();
        put_highlight(&db, hl_input("a1", &a.id, "early", 5)).unwrap();
        put_highlight(&db, hl_input("b1", &b.id, "bee", 1)).unwrap();
        put_highlight(&db, hl_input("c1", &c.id, "sea", 1)).unwrap();

        let by_item: Vec<String> =
            list_highlights(&db, Some(&a.id), None).unwrap().into_iter().map(|h| h.id).collect();
        assert_eq!(by_item, vec!["a1", "a2"]);

        let by_folder = list_highlights(&db, None, Some(&group.id)).unwrap();
        assert_eq!(by_folder.len(), 3);
        assert!(by_folder.iter().all(|h| h.item_id == a.id || h.item_id == b.id));
        // Ordered by item id, then offset.
        let keys: Vec<(String, i64)> =
            by_folder.iter().map(|h| (h.item_id.clone(), h.start_offset)).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);

        assert!(list_highlights(&db, None, None).is_err());
    }

    #[test]
    fn test_deleted_items_hide_their_highlights() {
        let (db, group) = hl_setup();
        let item = hl_item(&db, &group.id, "Highlight gone", "https://youtu.be/abcDEF12345");
        put_highlight(&db, hl_input("h1", &item.id, "Some", 0)).unwrap();
        delete_item(&db, &item.id).unwrap();
        assert!(list_highlights(&db, Some(&item.id), None).unwrap().is_empty());
        assert!(list_highlights(&db, None, Some(&group.id)).unwrap().is_empty());
        // And a deleted item can't take new highlights.
        assert!(put_highlight(&db, hl_input("h2", &item.id, "Some", 0)).is_err());
    }

    #[test]
    fn test_highlight_limits() {
        let (db, group) = hl_setup();
        let item = hl_item(&db, &group.id, "Highlight limits", "https://youtu.be/abcDEF12345");
        let ok = hl_input("h1", &item.id, "Some", 0);
        assert!(put_highlight(&db, ok.clone()).is_ok());

        let mut bad = ok.clone();
        bad.quote = "x".repeat(10_001);
        assert!(put_highlight(&db, bad).is_err());
        let mut edge = ok.clone();
        edge.quote = "é".repeat(10_000);
        edge.end_offset = 10_000;
        assert!(put_highlight(&db, edge).is_ok());

        let mut bad = ok.clone();
        bad.note = Some("x".repeat(5_001));
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.prefix = "x".repeat(65);
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.suffix = "x".repeat(65);
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.cited = (0..51)
            .map(|n| crate::models::HighlightCitation {
                n: n.to_string(),
                title: None,
                url: "https://example.com".into(),
            })
            .collect();
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.start_offset = -1;
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.end_offset = bad.start_offset - 1;
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.seconds = Some(-1);
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok.clone();
        bad.kind = "audio".into();
        assert!(put_highlight(&db, bad).is_err());
        let mut bad = ok;
        bad.item_id = "nope".into();
        assert!(put_highlight(&db, bad).is_err());
    }

    #[test]
    fn test_highlights_table_upgrades_an_existing_database() {
        let dir = std::env::temp_dir().join(format!("sourcefold-hl-upgrade-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("old.db");
        {
            let db = Database::open(&path).unwrap();
            db.create_folder("Cars", None).unwrap();
        }
        // Simulate a database from before highlights existed.
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch("DROP TABLE highlights;").unwrap();
        }
        let db = Database::open(&path).unwrap();
        assert!(db.get_highlights_for_folder("none").unwrap().is_empty());
        drop(db);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_golden_fixtures() {
        let golden_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core/test/golden");
        if !golden_dir.exists() {
            return;
        }

        let entries = fs::read_dir(&golden_dir).unwrap();
        let mut count = 0;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json")
                && path.to_string_lossy().ends_with(".input.json")
            {
                let json_str = fs::read_to_string(&path).unwrap();
                let v: Value = serde_json::from_str(&json_str).unwrap();

                let kind = v["kind"].as_str().unwrap();
                let title = v["title"].as_str().unwrap().to_string();
                let url = v["url"].as_str().map(|s| s.to_string());
                let folder = v["folder"].as_str().map(|s| s.to_string());
                let saved = v["saved"].as_str().map(|s| s.to_string());
                let created = v["created"].as_str().map(|s| s.to_string());
                let body = v["body"].as_str().unwrap_or("");
                let note = v["note"].as_str();

                let meta = &v["meta"];
                let summary = meta["summary"].as_str().map(|s| s.to_string());
                let fact_checked = meta["fact_checked"].as_str().map(|s| s.to_string());
                let language = meta["language"].as_str().map(|s| s.to_string());
                let revision = meta["revision"]
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| meta["revision"].as_u64().map(|n| n.to_string()));
                let last_edited = meta["last_edited"].as_str().map(|s| s.to_string());
                let subtitle = meta["subtitle"].as_str().map(|s| s.to_string());
                let author = meta["author"].as_str().map(|s| s.to_string());
                let author_url = meta["author_url"].as_str().map(|s| s.to_string());
                let publication = meta["publication"].as_str().map(|s| s.to_string());
                let publication_url = meta["publication_url"].as_str().map(|s| s.to_string());
                let published = meta["published"].as_str().map(|s| s.to_string());
                let access = meta["access"].as_str().map(|s| s.to_string());
                let post_url = meta["post_url"].as_str().map(|s| s.to_string());
                let posted = meta["posted"].as_str().map(|s| s.to_string());

                let fields = ItemFileFields {
                    title,
                    subtitle,
                    url,
                    post_url,
                    author,
                    author_url,
                    publication,
                    publication_url,
                    published,
                    access,
                    summary,
                    fact_checked,
                    language,
                    revision,
                    last_edited,
                    posted,
                    saved,
                    created,
                    folder,
                    meta: meta.as_object().cloned().unwrap_or_default(),
                };

                let highlights: Vec<Highlight> = match v.get("highlights") {
                    Some(h) if !h.is_null() => serde_json::from_value(h.clone()).unwrap(),
                    _ => Vec::new(),
                };
                let built = build_item_file_with_highlights(kind, &fields, body, note, &highlights);

                let filename = path.file_name().unwrap().to_str().unwrap();
                let base_name = filename.strip_suffix(".input.json").unwrap();
                let md_path = golden_dir.join(format!("{}.md", base_name));
                let expected_md = fs::read_to_string(&md_path).unwrap().replace("\r\n", "\n");

                assert_eq!(built, expected_md, "Fixture mismatch for {}", base_name);
                count += 1;
            }
        }
        assert!(count >= 6, "Expected at least 6 golden fixtures, found {}", count);
    }

    #[test]
    fn test_parse_grokipedia_html() {
        let html = r##"
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="description" content="An article about Quantum Computing.">
            <script type="application/ld+json">
            {
                "@context": "https://schema.org",
                "@type": "Article",
                "dateModified": "2024-05-01T12:00:00Z"
            }
            </script>
        </head>
        <body>
            <article>
                <h1>Quantum Computing</h1>
                <p>Quantum computing utilizes qubits<sup id="fn1"><a href="#ref-1">1</a></sup> for computation.</p>
                <div id="references">
                    <ol>
                        <li id="ref-1"><a href="https://example.com/quantum">Quantum Intro</a> - Nature</li>
                    </ol>
                </div>
            </article>
        </body>
        </html>
        "##;

        let article = parse_grokipedia_html(html, "https://grokipedia.com/page/Quantum_Computing").unwrap();
        assert_eq!(article.title, "Quantum Computing");
        assert_eq!(article.summary.as_deref(), Some("An article about Quantum Computing."));
        assert_eq!(article.fact_checked_at.as_deref(), Some("2024-05-01T12:00:00Z"));
        assert!(article.body_markdown.contains("qubits[^1]"));
        assert_eq!(article.references.len(), 1);
        assert_eq!(article.references[0].number, 1);
        assert_eq!(article.references[0].title, "Quantum Intro");
        assert_eq!(article.references[0].url, "https://example.com/quantum");
        assert_eq!(article.references[0].domain, "example.com");
    }

    #[test]
    fn test_safe_path_rejects_traversal() {
        let storage_root = std::env::temp_dir().join(format!("sf-trav-test-{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&storage_root);

        assert!(safe_storage_path(&storage_root, "../foo.md").is_none());
        assert!(safe_storage_path(&storage_root, "sub/../../foo.md").is_none());
        assert!(safe_storage_path(&storage_root, "sub/../foo.md").is_none());
        assert!(!is_safe_to_delete(&storage_root.join("../foo.md"), &storage_root));
        assert!(!is_safe_to_delete(&storage_root.join("sub/../../foo.md"), &storage_root));

        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn test_safe_path_rejects_absolute_outside() {
        let storage_root = std::env::temp_dir().join(format!("sf-out-test-{}", uuid::Uuid::new_v4()));
        let outside_dir = std::env::temp_dir().join(format!("sf-out-target-{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&storage_root);
        let _ = fs::create_dir_all(&outside_dir);
        let outside_file = outside_dir.join("outside.txt");
        let _ = fs::write(&outside_file, "sensitive");

        assert!(safe_storage_path(&storage_root, outside_file.to_str().unwrap()).is_none());
        assert!(!is_safe_to_delete(&outside_file, &storage_root));

        let _ = fs::remove_dir_all(&outside_dir);
        let _ = fs::remove_dir_all(&storage_root);
    }

    #[test]
    fn test_delete_folder_preserves_user_files() {
        let db = Database::open_in_memory().unwrap();
        let storage_root = std::env::temp_dir().join(format!("sf-userfile-test-{}", uuid::Uuid::new_v4()));
        db.set_setting("storage_dir", storage_root.to_str().unwrap()).unwrap();
        let _ = fs::create_dir_all(&storage_root);

        let project = create_folder(&db, "Projects", None).unwrap();
        let group = create_folder(&db, "Research", Some(&project.id)).unwrap();
        let item = save_generic_item(
            &db,
            &group.id,
            "generic",
            "Doc 1",
            Some("https://example.com/doc1".to_string()),
            None,
            Some("# Doc 1 Content"),
            None,
            None,
            None,
        ).unwrap();

        let rel_path = item.storage_path.as_ref().unwrap();
        let item_file = storage_root.join(rel_path);
        assert!(item_file.is_file(), "Item file should exist on disk at {:?}", item_file);

        // User adds an extra file in the same group folder
        let folder_dir = storage_root.join("Projects").join("Research");
        let user_file = folder_dir.join("my-notes.txt");
        fs::write(&user_file, "Do not delete my manual notes!").unwrap();
        assert!(user_file.is_file());

        // Delete the group folder via service
        delete_folder(&db, &group.id).unwrap();

        // Database delete succeeded: group and item are marked deleted
        assert!(db.get_folder(&group.id).is_err());
        assert!(db.get_item(&item.id).is_err(), "Deleted item should not be returned by get_item");

        // Item's own file is deleted
        assert!(!item_file.exists(), "Item file must be deleted");

        // User's manual file and its folder MUST remain intact
        assert!(user_file.is_file(), "User's extra file must NOT be deleted");
        assert!(folder_dir.is_dir(), "Folder containing user's extra file must NOT be deleted");

        // Cleanup
        let _ = fs::remove_dir_all(&storage_root);
    }
}
