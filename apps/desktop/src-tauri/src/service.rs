use std::fs;
use std::io::{self, Read};
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
    AddXPostRequest, CheckUrlResult, Folder, Item, RecentXItem, SaveItemRequest,
};

// -----------------------------------------------------------------------------
// Compiled Regexes (LazyLock)
// -----------------------------------------------------------------------------

static REF_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"ref-(\d+)").expect("invalid REF_ID_RE regex"));
static DIGITS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d+").expect("invalid DIGITS_RE regex"));
static CITATION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\^\d+\]").expect("invalid CITATION_RE regex"));
static WHITESPACE_COLLAPSE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+").expect("invalid WHITESPACE_COLLAPSE_RE regex"));
static X_I_WEB_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/i/web/status/([^/]+)(?:/.*)?$").expect("invalid X_I_WEB_RE regex"));
static X_STATUS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/([^/]+)/status/([^/]+)(?:/.*)?$").expect("invalid X_STATUS_RE regex"));

pub fn collapse_duplicate_citations(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_end = 0;
    let mut last_citation: Option<String> = None;

    for m in CITATION_RE.find_iter(input) {
        let citation_str = m.as_str();
        let between = &input[last_end..m.start()];

        if let Some(prev) = &last_citation {
            if between.trim().is_empty() && prev == citation_str {
                last_end = m.end();
                continue;
            }
        }

        out.push_str(between);
        out.push_str(citation_str);
        last_citation = Some(citation_str.to_string());
        last_end = m.end();
    }
    out.push_str(&input[last_end..]);
    out
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

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum CapturePayload {
    #[serde(rename = "substack")]
    Substack {
        folder_id: String,
        capture: SubstackCapture,
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

    Ok(if pathname.is_empty() {
        format!("https://{}", host)
    } else {
        format!("https://{}{}", host, pathname)
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

pub fn format_yaml_string(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }

    let needs_quotes = s.contains(':')
        || s.contains('#')
        || s.contains('\n')
        || s.contains('\"')
        || s.contains('\'')
        || s.starts_with(|c: char| {
            matches!(
                c,
                '-' | '?' | ',' | '[' | ']' | '{' | '}' | '*' | '&' | '!' | '|' | '>' | '%' | '@' | '`'
            )
        })
        || s.starts_with(' ')
        || s.ends_with(' ');

    if needs_quotes {
        let escaped = s.replace('\\', "\\\\").replace('\"', "\\\"").replace('\n', "\\n");
        format!("\"{}\"", escaped)
    } else {
        s.to_string()
    }
}

// -----------------------------------------------------------------------------
// Storage Paths
// -----------------------------------------------------------------------------

pub fn resolve_storage_dir(db: &Database) -> PathBuf {
    if let Ok(Some(custom_dir)) = db.get_setting("storage_dir") {
        let path = PathBuf::from(custom_dir);
        if path.is_absolute() {
            return path;
        }
    }
    dirs::document_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Sourcefold")
}

pub fn resolve_folder_path(db: &Database, folder_id: &str) -> (PathBuf, String) {
    if folder_id == "general" {
        return (PathBuf::new(), "General".to_string());
    }

    let mut path_segments = Vec::new();
    let mut current_id = Some(folder_id.to_string());
    let mut visited = std::collections::HashSet::new();

    while let Some(fid) = current_id {
        if fid == "general" || !visited.insert(fid.clone()) {
            break;
        }
        if let Ok(folder) = db.get_folder(&fid) {
            path_segments.push(slugify(&folder.name, 40));
            current_id = folder.parent_id;
        } else {
            break;
        }
    }

    path_segments.reverse();
    let rel_path = path_segments.iter().collect::<PathBuf>();
    let display_str = path_segments.join("/");
    (rel_path, display_str)
}

pub fn save_markdown_file_to_disk(
    storage_root: &Path,
    rel_dir: &Path,
    title: &str,
    item_id: &str,
    markdown: &str,
) -> io::Result<PathBuf> {
    let target_dir = storage_root.join(rel_dir);
    fs::create_dir_all(&target_dir)?;

    let slug = slugify(title, 50);
    let short_id = if item_id.len() >= 8 {
        &item_id[..8]
    } else {
        item_id
    };
    let filename = format!("{}-{}.md", slug, short_id);
    let file_path = target_dir.join(filename);

    fs::write(&file_path, markdown)?;
    Ok(file_path)
}

// -----------------------------------------------------------------------------
// HTTP Client Helper
// -----------------------------------------------------------------------------

pub fn fetch_url_html(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Server returned HTTP status {}", resp.status()));
    }

    // Cap response body at 10 MB
    let mut reader = resp.take(10 * 1024 * 1024);
    let mut body = String::new();
    reader
        .read_to_string(&mut body)
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    Ok(body)
}

// -----------------------------------------------------------------------------
// Grokipedia HTML Parsing using `scraper` & `htmd`
// -----------------------------------------------------------------------------

pub fn parse_grokipedia_html(html: &str, _url: &str) -> Result<GrokipediaArticle, String> {
    let document = Html::parse_document(html);

    // Title from article h1, or h1, or fallback to title
    let h1_selector = Selector::parse("article h1, h1").map_err(|e| format!("{:?}", e))?;
    let title_el = document.select(&h1_selector).next().or_else(|| {
        Selector::parse("title").ok().and_then(|sel| document.select(&sel).next())
    });
    let title = title_el
        .map(|el| el.text().collect::<Vec<_>>().join(" "))
        .map(|t| WHITESPACE_COLLAPSE_RE.replace_all(&t, " ").trim().to_string())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| "Missing article title".to_string())?;

    // Meta description summary
    let meta_sel =
        Selector::parse(r#"meta[name="description"], meta[property="og:description"]"#)
            .map_err(|e| format!("{:?}", e))?;
    let summary = document
        .select(&meta_sel)
        .find_map(|el| el.value().attr("content"))
        .map(|s| WHITESPACE_COLLAPSE_RE.replace_all(s, " ").trim().to_string())
        .filter(|s| !s.is_empty());

    // JSON-LD Fact checked at
    let mut fact_checked_at: Option<String> = None;
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

    // References parsing
    let mut references: Vec<GrokReference> = Vec::new();
    let ref_container_sel =
        Selector::parse(r##"#references, .references, [aria-labelledby="references-title"]"##)
            .map_err(|e| format!("{:?}", e))?;

    if let Some(ref_container) = document.select(&ref_container_sel).next() {
        if let Ok(li_sel) = Selector::parse("li") {
            for (idx, li) in ref_container.select(&li_sel).enumerate() {
                // Find reference number
                let mut num: Option<usize> = None;

                // 1. Check data-backref
                if let Ok(backref_sel) = Selector::parse(r##"a[data-backref], .ref-num, a[href^="#ref-"]"##) {
                    if let Some(backref) = li.select(&backref_sel).next() {
                        if let Some(attr) = backref.value().attr("data-backref") {
                            num = attr.parse::<usize>().ok();
                        }
                        if num.is_none() {
                            let text = backref.text().collect::<Vec<_>>().join("");
                            if let Some(digits) = DIGITS_RE.find(&text) {
                                num = digits.as_str().parse::<usize>().ok();
                            }
                        }
                    }
                }

                // 2. Check li.id
                if num.is_none() {
                    if let Some(id) = li.value().attr("id") {
                        if let Some(caps) = REF_ID_RE.captures(id) {
                            if let Some(m) = caps.get(1) {
                                num = m.as_str().parse::<usize>().ok();
                            }
                        }
                    }
                }

                // 3. Fallback to 1-based list index
                if num.is_none() {
                    num = Some(idx + 1);
                }

                let ref_num = match num {
                    Some(n) => n,
                    None => continue,
                };

                // Find link
                let mut ref_url = String::new();
                let mut ref_title = String::new();

                if let Ok(link_sel) = Selector::parse(r##"a.ref-link, .min-w-0 a, a[target="_blank"], a"##) {
                    for a in li.select(&link_sel) {
                        let href = a.value().attr("href").unwrap_or("").trim();
                        if !href.is_empty() && !href.starts_with('#') {
                            ref_url = if href.starts_with('/') {
                                format!("https://grokipedia.com{}", href)
                            } else {
                                href.to_string()
                            };
                            let text = a.text().collect::<Vec<_>>().join(" ");
                            ref_title = WHITESPACE_COLLAPSE_RE.replace_all(&text, " ").trim().to_string();
                            break;
                        }
                    }
                }

                if ref_title.is_empty() {
                    let full_li_text = li.text().collect::<Vec<_>>().join(" ");
                    ref_title = WHITESPACE_COLLAPSE_RE.replace_all(&full_li_text, " ").trim().to_string();
                }

                let domain = if let Ok(parsed_ref_url) = reqwest::Url::parse(&ref_url) {
                    parsed_ref_url
                        .host_str()
                        .unwrap_or("")
                        .trim_start_matches("www.")
                        .to_string()
                } else if let Ok(hint_sel) = Selector::parse(".type-hint") {
                    li.select(&hint_sel)
                        .next()
                        .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                };

                references.push(GrokReference {
                    number: ref_num,
                    title: ref_title,
                    url: ref_url,
                    domain,
                });
            }
        }
    }

    references.sort_by_key(|r| r.number);

    // Body HTML
    let article_sel = Selector::parse("article").map_err(|e| format!("{:?}", e))?;
    let content_html = if let Some(art) = document.select(&article_sel).next() {
        art.inner_html()
    } else {
        html.to_string()
    };

    // Build htmd converter
    let converter = htmd::HtmlToMarkdown::builder()
        .skip_tags(vec![
            "script", "style", "noscript", "svg", "button", "img", "picture", "video", "audio",
            "iframe", "form", "input", "nav", "header",
        ])
        .add_handler(vec!["h1"], |_: htmd::Element| None)
        .add_handler(vec!["h2", "h3"], |el: htmd::Element| {
            let id = el
                .attrs
                .iter()
                .find(|a| a.name.local.as_ref() == "id")
                .map(|a| a.value.as_ref().to_lowercase())
                .unwrap_or_default();
            let text = el.content.trim();
            if id.contains("references") || text.eq_ignore_ascii_case("references") {
                None
            } else if el.tag == "h2" {
                Some(format!("\n\n## {}\n\n", text))
            } else {
                Some(format!("\n\n### {}\n\n", text))
            }
        })
        .add_handler(vec!["div", "section", "aside"], |el: htmd::Element| {
            for attr in el.attrs {
                let name = attr.name.local.as_ref();
                if name == "id" || name == "class" {
                    let val = attr.value.to_lowercase();
                    if val.contains("references")
                        || val.contains("toc")
                        || val.contains("table-of-contents")
                    {
                        return None;
                    }
                }
            }
            let trimmed = el.content.trim();
            if trimmed.contains("Fact-checked by Grok")
                || trimmed.eq_ignore_ascii_case("suggest edit")
                || trimmed.eq_ignore_ascii_case("edit history")
                || trimmed.eq_ignore_ascii_case("copy link")
                || trimmed.eq_ignore_ascii_case("copy")
            {
                return None;
            }
            Some(el.content.to_string())
        })
        .add_handler(vec!["sup"], |el: htmd::Element| {
            let content = el.content.trim();
            let mut numbers = Vec::new();

            for m in DIGITS_RE.find_iter(content) {
                if let Ok(n) = m.as_str().parse::<usize>() {
                    numbers.push(n);
                }
            }

            if numbers.is_empty() {
                for attr in el.attrs {
                    if attr.name.local.as_ref() == "id" || attr.name.local.as_ref() == "data-backref" {
                        for m in DIGITS_RE.find_iter(&attr.value) {
                            if let Ok(n) = m.as_str().parse::<usize>() {
                                numbers.push(n);
                            }
                        }
                    }
                }
            }

            if !numbers.is_empty() {
                let markers: String = numbers.iter().map(|n| format!("[^{}]", n)).collect();
                Some(markers)
            } else if !content.is_empty() {
                Some(format!("^{}^", content))
            } else {
                None
            }
        })
        .add_handler(vec!["a"], |el: htmd::Element| {
            let mut href = None;
            for attr in el.attrs {
                if attr.name.local.as_ref() == "href" {
                    href = Some(attr.value.as_ref());
                    break;
                }
            }
            match href {
                Some(h) if h.starts_with('#') => Some(el.content.to_string()),
                Some(h) => {
                    let abs_url = if h.starts_with('/') {
                        format!("https://grokipedia.com{}", h)
                    } else {
                        h.to_string()
                    };
                    Some(format!("[{}]({})", el.content.trim(), abs_url))
                }
                None => Some(el.content.to_string()),
            }
        })
        .build();

    let raw_md = converter
        .convert(&content_html)
        .map_err(|e| format!("Markdown conversion error: {}", e))?;

    // Collapse consecutive duplicate citations
    let dedupped_md = collapse_duplicate_citations(&raw_md);
    let normalized = dedupped_md
        .lines()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed_body = normalized.trim().to_string();

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
    if let Some(fc) = &article.fact_checked_at {
        let date_clean = fc.split('T').next().unwrap_or(fc);
        front_matter.push_str(&format!("fact_checked: {}\n", format_yaml_string(date_clean)));
    }
    front_matter.push_str(&format!("saved: {}\n", format_yaml_string(today)));
    if !folder_path_str.is_empty() {
        front_matter.push_str(&format!("folder: {}\n", format_yaml_string(folder_path_str)));
    }
    front_matter.push_str("---\n\n");
    front_matter
}

pub fn build_grokipedia_markdown(article: &GrokipediaArticle, url: &str, today: &str) -> String {
    let mut parts: Vec<String> = Vec::new();

    parts.push(format!("# {}", article.title));
    parts.push(format!(
        "> Saved from Grokipedia on {}. Grokipedia articles change; see the live page and its edit history: {}",
        today, url
    ));

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
            ref_lines.push(format!("[^{}]: [{}]({}){}", r.number, r.title, r.url, domain_suffix));
        }
        parts.push(format!("## References\n\n{}", ref_lines.join("\n")));
    }

    format!("{}\n", parts.join("\n\n"))
}

pub fn x_thread_title(posts: &[XPostCapture]) -> String {
    if posts.is_empty() {
        return "X Post".to_string();
    }
    let root = &posts[0];
    let clean_handle = root.handle.trim_start_matches('@');
    if posts.len() > 1 {
        format!("Thread by {} (@{})", root.author_name, clean_handle)
    } else {
        format!("Post by {} (@{})", root.author_name, clean_handle)
    }
}

pub fn build_x_thread_markdown(posts: &[XPostCapture], title: &str) -> String {
    let mut parts = Vec::new();
    parts.push(format!("# {}\n", title));

    for (i, post) in posts.iter().enumerate() {
        let clean_handle = post.handle.trim_start_matches('@');
        let author_link = if !post.author_url.is_empty() {
            format!("[{} (@{})]({})", post.author_name, clean_handle, post.author_url)
        } else {
            format!("{} (@{})", post.author_name, clean_handle)
        };

        let mut post_block = Vec::new();
        post_block.push(format!("### Post {} by {}\n", i + 1, author_link));
        post_block.push(post.text.trim().to_string());
        post_block.push(format!("\n[View original on X]({})", post.post_url));

        parts.push(post_block.join("\n"));
    }

    parts.join("\n\n---\n\n")
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
    let storage_root = resolve_storage_dir(db);
    let (rel_dir, folder_path_str) = resolve_folder_path(db, folder_id);

    let body_markdown = build_grokipedia_markdown(&article, raw_url, &today);

    let front_matter = build_grokipedia_frontmatter(&article, raw_url, &today, &folder_path_str);

    let full_file_content = format!("{}{}", front_matter, body_markdown);

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

    let item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let _ = save_markdown_file_to_disk(&storage_root, &rel_dir, &article.title, &item.id, &full_file_content);

    Ok(item)
}

pub fn build_substack_markdown(
    capture: &SubstackCapture,
    folder_path_str: &str,
    today: &str,
) -> String {
    let mut fm = String::from("---\n");
    fm.push_str("source: substack\n");
    fm.push_str(&format!("title: {}\n", format_yaml_string(&capture.title)));
    if let Some(sub) = &capture.subtitle {
        fm.push_str(&format!("subtitle: {}\n", format_yaml_string(sub)));
    }
    fm.push_str(&format!("url: {}\n", format_yaml_string(&capture.url)));
    if let Some(auth) = &capture.author {
        fm.push_str(&format!("author: {}\n", format_yaml_string(auth)));
    }
    if let Some(auth_url) = &capture.author_url {
        fm.push_str(&format!("author_url: {}\n", format_yaml_string(auth_url)));
    }
    if let Some(pub_name) = &capture.publication {
        fm.push_str(&format!("publication: {}\n", format_yaml_string(pub_name)));
    }
    if let Some(pub_url) = &capture.publication_url {
        fm.push_str(&format!("publication_url: {}\n", format_yaml_string(pub_url)));
    }
    if let Some(pub_date) = &capture.published {
        let date_clean = pub_date.split('T').next().unwrap_or(pub_date);
        fm.push_str(&format!("published: {}\n", format_yaml_string(date_clean)));
    }
    fm.push_str(&format!("access: {}\n", format_yaml_string(&capture.access)));
    fm.push_str(&format!("saved: {}\n", format_yaml_string(today)));
    if !folder_path_str.is_empty() {
        fm.push_str(&format!("folder: {}\n", format_yaml_string(folder_path_str)));
    }
    fm.push_str("---\n\n");

    let body_content = format!("# {}\n\n{}\n", capture.title, capture.markdown.trim());
    format!("{}{}", fm, body_content)
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
    let storage_root = resolve_storage_dir(db);
    let (rel_dir, folder_path_str) = resolve_folder_path(db, folder_id);

    let full_file_content = build_substack_markdown(&capture, &folder_path_str, &today);

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

    let item = db
        .save_item(save_req)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))?;

    let _ = save_markdown_file_to_disk(&storage_root, &rel_dir, &capture.title, &item.id, &full_file_content);

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
        error: None,
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

    let title = x_thread_title(&posts);
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let storage_root = resolve_storage_dir(db);
    let (rel_dir, folder_path_str) = resolve_folder_path(db, folder_id);

    let mut fm = String::from("---\n");
    fm.push_str("source: x\n");
    fm.push_str(&format!("title: {}\n", format_yaml_string(&title)));
    fm.push_str(&format!("url: {}\n", format_yaml_string(&root_post.post_url)));
    fm.push_str(&format!("author: {}\n", format_yaml_string(&root_post.author_name)));
    if !root_post.author_url.is_empty() {
        fm.push_str(&format!("author_url: {}\n", format_yaml_string(&root_post.author_url)));
    }
    if let Some(posted_at) = &root_post.posted_at {
        let date_clean = posted_at.split('T').next().unwrap_or(posted_at);
        fm.push_str(&format!("posted: {}\n", format_yaml_string(date_clean)));
    }
    fm.push_str(&format!("saved: {}\n", format_yaml_string(&today)));
    if !folder_path_str.is_empty() {
        fm.push_str(&format!("folder: {}\n", format_yaml_string(&folder_path_str)));
    }
    fm.push_str("---\n\n");

    let thread_body = build_x_thread_markdown(&posts, &title);
    let full_file_content = format!("{}{}", fm, thread_body);

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

    let item = db
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

    let _ = save_markdown_file_to_disk(&storage_root, &rel_dir, &title, &item.id, &full_file_content);

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
    if let Ok(item) = db.get_item(&res.0) {
        let storage_root = resolve_storage_dir(db);
        let (rel_dir, _) = resolve_folder_path(db, &item.folder_id);
        if let Some(md) = &item.markdown {
            let _ = save_markdown_file_to_disk(&storage_root, &rel_dir, &item.title, &item.id, md);
        }
    }

    Ok(res)
}

pub fn recent_x_items(db: &Database, folder_id: &str) -> Result<Vec<RecentXItem>, ServiceError> {
    db.get_recent_x_items(folder_id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

// -----------------------------------------------------------------------------
// Images (offline mode)
// -----------------------------------------------------------------------------

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

/// File extension for the image types the web app accepts too.
pub fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

/// Decodes standard base64 (padding optional, whitespace ignored).
pub fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            _ => return Err("The image data isn't valid base64.".to_string()),
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

/// Stores an image on disk next to the group's Markdown files and adds it to the group.
pub fn save_image(
    db: &Database,
    folder_id: &str,
    file_name: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<Item, ServiceError> {
    let extension = image_extension(mime_type)
        .ok_or_else(|| ServiceError::bad_request("Upload a PNG, JPEG, GIF or WebP image."))?;
    if bytes.is_empty() {
        return Err(ServiceError::bad_request("That image file is empty."));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(ServiceError::bad_request("Images can be up to 10 MB."));
    }

    let trimmed_name = file_name.trim();
    let base_name = match trimmed_name.rfind('.') {
        Some(index) if index > 0 => trimmed_name[..index].trim(),
        _ => trimmed_name,
    };
    let title: String = if base_name.is_empty() {
        "Untitled image".to_string()
    } else {
        base_name.chars().take(500).collect()
    };

    let storage_root = resolve_storage_dir(db);
    let (rel_dir, _) = resolve_folder_path(db, folder_id);
    let target_dir = storage_root.join(rel_dir);
    fs::create_dir_all(&target_dir).map_err(|e| {
        ServiceError::internal(format!("Couldn't create the folder for the image: {}", e), "io_error")
    })?;

    let short_id: String = uuid::Uuid::new_v4().to_string().chars().take(8).collect();
    let file_path = target_dir.join(format!("{}-{}.{}", slugify(&title, 50), short_id, extension));
    fs::write(&file_path, bytes).map_err(|e| {
        ServiceError::internal(format!("Couldn't save the image file: {}", e), "io_error")
    })?;

    let request = SaveItemRequest {
        folder_id: folder_id.to_string(),
        kind: "image".to_string(),
        title,
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
    let mut item = match db.save_item(request) {
        Ok(item) => item,
        Err(e) => {
            let _ = fs::remove_file(&file_path);
            return Err(ServiceError::internal(format!("Database error: {}", e), "db_error"));
        }
    };

    let path_string = file_path.to_string_lossy().to_string();
    if let Err(e) = db.update_item_storage_path(&item.id, &path_string) {
        let _ = db.delete_item(&item.id);
        let _ = fs::remove_file(&file_path);
        return Err(ServiceError::internal(format!("Database error: {}", e), "db_error"));
    }
    item.storage_path = Some(path_string);
    Ok(item)
}

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

pub fn get_item(db: &Database, id: &str) -> Result<Item, ServiceError> {
    db.get_item(id)
        .map_err(|e| ServiceError::not_found(format!("Item not found: {}", e)))
}

pub fn delete_item(db: &Database, id: &str) -> Result<(), ServiceError> {
    db.delete_item(id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn delete_folder(db: &Database, id: &str) -> Result<(), ServiceError> {
    db.delete_folder(id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

pub fn search_items(
    db: &Database,
    query: &str,
    folder_id: Option<&str>,
) -> Result<Vec<Item>, ServiceError> {
    db.search_items(query, folder_id)
        .map_err(|e| ServiceError::internal(format!("Database error: {}", e), "db_error"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonicalize_url_x() {
        assert_eq!(
            canonicalize_url("https://twitter.com/user/status/123456?s=20").unwrap(),
            "https://x.com/user/status/123456"
        );
        assert_eq!(
            canonicalize_url("https://x.com/user/status/123456/photo/1").unwrap(),
            "https://x.com/user/status/123456"
        );
        assert_eq!(
            canonicalize_url("https://x.com/i/web/status/123456").unwrap(),
            "https://x.com/i/status/123456"
        );
    }

    #[test]
    fn test_canonicalize_url_grokipedia() {
        assert_eq!(
            canonicalize_url("https://www.grokipedia.com/page/Artificial%20Intelligence").unwrap(),
            "https://grokipedia.com/page/Artificial_Intelligence"
        );
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World!", 80), "hello-world");
        assert_eq!(slugify("Quantum Computing: A Review", 80), "quantum-computing-a-review");
        assert_eq!(slugify("---test---", 80), "test");
    }

    #[test]
    fn test_collapse_duplicate_citations() {
        assert_eq!(collapse_duplicate_citations("qubits[^1][^1]"), "qubits[^1]");
        assert_eq!(collapse_duplicate_citations("qubits[^1] [^1]"), "qubits[^1]");
        assert_eq!(collapse_duplicate_citations("qubits[^1][^2]"), "qubits[^1][^2]");
        assert_eq!(collapse_duplicate_citations("qubits[^1] and[^1]"), "qubits[^1] and[^1]");
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
    fn test_grokipedia_parser_realistic_fixture() {
        let html = r##"
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Impact of Artificial Intelligence - Grokipedia</title>
            <meta name="description" content="A comprehensive analysis of artificial intelligence impacts across sectors.">
            <script type="application/ld+json">
            {
                "@context": "https://schema.org",
                "@type": "Article",
                "headline": "Impact of Artificial Intelligence",
                "dateModified": "2026-04-12T10:00:00Z"
            }
            </script>
        </head>
        <body>
            <nav class="top-nav"><a href="/home">Home</a><button>Search</button></nav>
            <article>
                <h1>Impact of Artificial Intelligence</h1>
                <div class="toc">
                    <h2>Contents</h2>
                    <ul>
                        <li><a href="#overview">Overview</a></li>
                        <li><a href="#healthcare">Healthcare</a></li>
                    </ul>
                </div>
                <p>Artificial intelligence (AI) has <b>rapidly transformed</b> multiple industries worldwide.<sup id="cite_ref-1"><a href="#cite_note-1">[1]</a></sup> Its effects span across <i>automation</i> and analysis.<sup id="cite_ref-2"><a href="#cite_note-2">[2]</a></sup></p>
                <h2 id="healthcare">Healthcare Applications</h2>
                <p>In healthcare, <b>deep neural networks</b> assist in early diagnosis.<sup id="cite_ref-1"><a href="#cite_note-1">[1]</a></sup> Visit <a href="https://example.org/health-ai">Health AI Consortium</a> for clinical trials.<sup id="cite_ref-3"><a href="#cite_note-3">[3]</a></sup></p>
                <h3>Diagnostic Imaging</h3>
                <p>Computer vision models analyze radiologic scans with high precision.</p>
                <div id="references">
                    <h2>References</h2>
                    <ol>
                        <li id="cite_note-1"><a href="https://nature.com/articles/ai-overview">Global AI Transformation Overview</a> - Nature</li>
                        <li id="cite_note-2"><a href="https://science.org/articles/ai-automation">Economic and Societal Automation</a> - Science</li>
                        <li id="cite_note-3"><a href="https://example.org/health-ai">Clinical AI Diagnostic Trials</a> - Example Health</li>
                    </ol>
                </div>
            </article>
        </body>
        </html>
        "##;

        let article = parse_grokipedia_html(html, "https://grokipedia.com/page/Impact_of_Artificial_Intelligence").unwrap();
        assert_eq!(article.title, "Impact of Artificial Intelligence");
        assert_eq!(article.summary.as_deref(), Some("A comprehensive analysis of artificial intelligence impacts across sectors."));
        assert_eq!(article.fact_checked_at.as_deref(), Some("2026-04-12T10:00:00Z"));

        assert_eq!(article.references.len(), 3);
        assert_eq!(article.references[0].number, 1);
        assert_eq!(article.references[0].title, "Global AI Transformation Overview");
        assert_eq!(article.references[0].url, "https://nature.com/articles/ai-overview");
        assert_eq!(article.references[0].domain, "nature.com");

        assert_eq!(article.references[1].number, 2);
        assert_eq!(article.references[1].title, "Economic and Societal Automation");
        assert_eq!(article.references[1].url, "https://science.org/articles/ai-automation");
        assert_eq!(article.references[1].domain, "science.org");

        assert_eq!(article.references[2].number, 3);
        assert_eq!(article.references[2].title, "Clinical AI Diagnostic Trials");
        assert_eq!(article.references[2].url, "https://example.org/health-ai");
        assert_eq!(article.references[2].domain, "example.org");

        let page_url = "https://grokipedia.com/page/Impact_of_Artificial_Intelligence";
        let body_md = build_grokipedia_markdown(&article, page_url, "2026-10-15");
        let fm = build_grokipedia_frontmatter(&article, page_url, "2026-10-15", "Research/AI");
        let md = format!("{}{}", fm, body_md);

        // Front matter assertions
        assert!(md.contains("source: grokipedia\n"));
        assert!(md.contains("title: Impact of Artificial Intelligence\n"));
        assert!(md.contains("url: \"https://grokipedia.com/page/Impact_of_Artificial_Intelligence\"\n"));
        assert!(md.contains("summary: A comprehensive analysis of artificial intelligence impacts across sectors.\n"));
        assert!(md.contains("fact_checked: 2026-04-12\n"));
        assert!(md.contains("saved: 2026-10-15\n"));
        assert!(md.contains("folder: Research/AI\n"));

        // Content assertions: headings, nested formatting, footnotes
        assert!(md.contains("# Impact of Artificial Intelligence"));
        assert!(md.contains("**rapidly transformed**"));
        assert!(md.contains("_automation_"));
        assert!(md.contains("[^1]"));
        assert!(md.contains("[^2]"));
        assert!(md.contains("## Healthcare Applications"));
        assert!(md.contains("**deep neural networks**"));
        assert!(md.contains("[Health AI Consortium](https://example.org/health-ai)"));
        assert!(md.contains("### Diagnostic Imaging"));

        // Footnotes list assertions
        assert!(md.contains("## References"));
        assert!(md.contains("[^1]: [Global AI Transformation Overview](https://nature.com/articles/ai-overview) - nature.com"));
        assert!(md.contains("[^2]: [Economic and Societal Automation](https://science.org/articles/ai-automation) - science.org"));
        assert!(md.contains("[^3]: [Clinical AI Diagnostic Trials](https://example.org/health-ai) - example.org"));

        // Stripped navigation / TOC assertions
        assert!(!md.contains("Contents"));
        assert!(!md.contains("Search"));
        assert!(!md.contains("Home"));
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
        let expected = "---\nsource: substack\ntitle: The Future of Computing\nsubtitle: Why decentralized systems will dominate\nurl: \"https://example.substack.com/p/the-future-of-computing\"\nauthor: Alan Turing\nauthor_url: \"https://substack.com/@alanturing\"\npublication: Computing Weekly\npublication_url: \"https://example.substack.com\"\npublished: 2026-09-01\naccess: free\nsaved: 2026-10-15\nfolder: Technology/Computing\n---\n\n# The Future of Computing\n\nModern computing is at an inflection point.\n\nDecentralized architecture provides fault tolerance.\n";

        assert_eq!(generated, expected);
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
        assert_eq!(fs::read(&path).unwrap(), b"not really a png");
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
}
