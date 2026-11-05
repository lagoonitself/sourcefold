//! The Link Shelf offline (docs/dev/PLAN-shelf.md): the `shelf_links` table, mirroring Supabase's.
//! Signed in, the webview and the extension use `/api/shelf` in the account API instead.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

use crate::db::Database;

const URL_MAX: usize = 2048;
const TITLE_MAX: usize = 300;
const NOTE_MAX: usize = 8000;
const TAGS_MAX: usize = 20;
const TAG_MAX: usize = 40;
pub const BATCH_MAX: usize = 500;

/// Mirrors `ShelfLink` in packages/core/src/shelf.ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShelfLink {
    pub id: String,
    pub url: String,
    pub key: String,
    pub title: String,
    pub note: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub open_count: i64,
    pub last_opened_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Mirrors `ShelfLinkInput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ShelfLinkInput {
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

/// Mirrors `ShelfLinkPatch`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ShelfLinkPatch {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub pinned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShelfAddResult {
    pub added: Vec<ShelfLink>,
    pub existing: Vec<ShelfLink>,
}

/// Why a shelf call failed: bad input (400), unknown id (404), the URL is another link's (409).
#[derive(Debug, Clone, PartialEq)]
pub enum ShelfError {
    Invalid(String),
    NotFound,
    Conflict,
    Db(String),
}

impl ShelfError {
    pub fn message(&self) -> String {
        match self {
            ShelfError::Invalid(m) => m.clone(),
            ShelfError::NotFound => "Link not found.".into(),
            ShelfError::Conflict => "That link is already on your shelf.".into(),
            ShelfError::Db(m) => format!("Database error: {}", m),
        }
    }
    pub fn status(&self) -> u16 {
        match self {
            ShelfError::Invalid(_) => 400,
            ShelfError::NotFound => 404,
            ShelfError::Conflict => 409,
            ShelfError::Db(_) => 500,
        }
    }
}

impl From<rusqlite::Error> for ShelfError {
    fn from(e: rusqlite::Error) -> Self {
        ShelfError::Db(e.to_string())
    }
}

fn chars(s: &str) -> usize {
    s.chars().count()
}

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// `normalizeShelfUrl` + `shelfKey` from core: the URL (https:// added when the scheme is missing)
/// and its duplicate key, or None when it isn't a web address.
pub fn normalize_url(input: &str) -> Option<(String, String)> {
    let mut text = input.trim().to_string();
    if text.is_empty() || chars(&text) > URL_MAX {
        return None;
    }
    let has_scheme = text
        .split_once(':')
        .map(|(s, _)| {
            !s.is_empty()
                && s.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '.' || c == '-')
        })
        .unwrap_or(false);
    // "localhost:3000" reads as scheme "localhost"; only real web schemes count.
    if has_scheme {
        let lower = text.to_ascii_lowercase();
        if !lower.starts_with("http:") && !lower.starts_with("https:") {
            let first = lower.split(':').next().unwrap_or("");
            if first.contains('.') || first == "localhost" {
                text = format!("https://{}", text);
            } else {
                return None;
            }
        }
    } else {
        text = format!("https://{}", text);
    }
    let parsed = reqwest::Url::parse(&text).ok()?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return None;
    }
    let raw_host = parsed.host_str()?.to_lowercase();
    if raw_host.is_empty() || (!raw_host.contains('.') && raw_host != "localhost") {
        return None;
    }
    let host = raw_host.strip_prefix("www.").unwrap_or(&raw_host).to_string();
    let port = match parsed.port() {
        Some(p) if p != 80 && p != 443 => format!(":{}", p),
        _ => String::new(),
    };
    let path = parsed.path().trim_end_matches('/');
    let query = parsed.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let key = format!("{}{}{}{}", host, port, path, query);
    if chars(&key) > URL_MAX {
        return None;
    }
    Some((parsed.to_string(), key))
}

fn title_fallback(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
        .map(|h| h.strip_prefix("www.").unwrap_or(&h).to_string())
        .unwrap_or_else(|| url.to_string())
}

/// `normalizeShelfTags` from core.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in tags {
        let t = raw.trim().trim_start_matches('#');
        let collapsed = t.split_whitespace().collect::<Vec<_>>().join(" ");
        let tag = clip(&collapsed, TAG_MAX).trim().to_string();
        if tag.is_empty() {
            continue;
        }
        if !seen.insert(tag.to_lowercase()) {
            continue;
        }
        out.push(tag);
        if out.len() >= TAGS_MAX {
            break;
        }
    }
    out
}

fn clean_title(title: &str) -> Result<String, ShelfError> {
    let t = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if chars(&t) > TITLE_MAX {
        return Err(ShelfError::Invalid(format!("A title can be at most {} characters.", TITLE_MAX)));
    }
    Ok(t)
}

fn clean_note(note: &str) -> Result<String, ShelfError> {
    let n = note.replace("\r\n", "\n").trim().to_string();
    if chars(&n) > NOTE_MAX {
        return Err(ShelfError::Invalid(format!("A note can be at most {} characters.", NOTE_MAX)));
    }
    Ok(n)
}

fn bad_url(input: &str) -> ShelfError {
    ShelfError::Invalid(format!("\"{}\" isn't a web address.", clip(input, 80)))
}

const COLUMNS: &str =
    "id, url, key, title, note, tags, pinned, open_count, last_opened_at, created_at, updated_at";

fn row_to_link(row: &rusqlite::Row) -> Result<ShelfLink> {
    let tags: String = row.get(5)?;
    Ok(ShelfLink {
        id: row.get(0)?,
        url: row.get(1)?,
        key: row.get(2)?,
        title: row.get(3)?,
        note: row.get(4)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        pinned: row.get::<_, i64>(6)? != 0,
        open_count: row.get(7)?,
        last_opened_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn get_link(conn: &Connection, id: &str) -> Result<Option<ShelfLink>> {
    let sql = format!("SELECT {COLUMNS} FROM shelf_links WHERE id = ?1");
    conn.query_row(&sql, params![id], row_to_link).optional()
}

fn get_by_key(conn: &Connection, key: &str) -> Result<Option<ShelfLink>> {
    let sql = format!("SELECT {COLUMNS} FROM shelf_links WHERE key = ?1");
    conn.query_row(&sql, params![key], row_to_link).optional()
}

pub const CREATE_TABLE_SQL: &str = "
    CREATE TABLE IF NOT EXISTS shelf_links (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        pinned INTEGER NOT NULL DEFAULT 0,
        open_count INTEGER NOT NULL DEFAULT 0,
        last_opened_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
";

impl Database {
    pub fn list_shelf(&self) -> Result<Vec<ShelfLink>, ShelfError> {
        Ok(self.with_conn(|conn| {
            let sql = format!("SELECT {COLUMNS} FROM shelf_links ORDER BY created_at DESC");
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map([], row_to_link)?;
            rows.collect()
        })?)
    }

    /// Adds the links the shelf doesn't have; ones already there come back in `existing`. All or
    /// nothing: one bad URL refuses the batch, like the account API.
    pub fn add_shelf_links(&self, inputs: &[ShelfLinkInput]) -> Result<ShelfAddResult, ShelfError> {
        if inputs.is_empty() {
            return Err(ShelfError::Invalid("Give at least one link.".into()));
        }
        if inputs.len() > BATCH_MAX {
            return Err(ShelfError::Invalid(format!("Add at most {} links at a time.", BATCH_MAX)));
        }
        let mut prepared = Vec::with_capacity(inputs.len());
        for input in inputs {
            let (url, key) = normalize_url(&input.url).ok_or_else(|| bad_url(&input.url))?;
            let title = clean_title(input.title.as_deref().unwrap_or(""))?;
            let title = if title.is_empty() { title_fallback(&url) } else { title };
            let note = clean_note(input.note.as_deref().unwrap_or(""))?;
            let tags = normalize_tags(input.tags.as_deref().unwrap_or(&[]));
            prepared.push((url, key, title, note, tags, input.pinned.unwrap_or(false)));
        }
        let mut result = ShelfAddResult { added: Vec::new(), existing: Vec::new() };
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let mut seen = std::collections::HashSet::new();
            for (url, key, title, note, tags, pinned) in prepared {
                if !seen.insert(key.clone()) {
                    continue;
                }
                if let Some(old) = get_by_key(&tx, &key)? {
                    result.existing.push(old);
                    continue;
                }
                let id = uuid::Uuid::new_v4().to_string();
                let now = Utc::now().to_rfc3339();
                tx.execute(
                    "INSERT INTO shelf_links (id, url, key, title, note, tags, pinned, open_count, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
                    params![
                        id,
                        url,
                        key,
                        title,
                        note,
                        serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into()),
                        pinned as i64,
                        now
                    ],
                )?;
                if let Some(link) = get_link(&tx, &id)? {
                    result.added.push(link);
                }
            }
            tx.commit()
        })?;
        Ok(result)
    }

    pub fn update_shelf_link(&self, id: &str, patch: &ShelfLinkPatch) -> Result<ShelfLink, ShelfError> {
        let url_key = match &patch.url {
            Some(u) => Some(normalize_url(u).ok_or_else(|| bad_url(u))?),
            None => None,
        };
        let title = patch.title.as_deref().map(clean_title).transpose()?;
        let note = patch.note.as_deref().map(clean_note).transpose()?;
        let tags = patch.tags.as_deref().map(normalize_tags);
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let Some(current) = get_link(&tx, id)? else {
                return Ok(Err(ShelfError::NotFound));
            };
            if let Some((_, key)) = &url_key {
                if let Some(other) = get_by_key(&tx, key)? {
                    if other.id != id {
                        return Ok(Err(ShelfError::Conflict));
                    }
                }
            }
            let (url, key) = url_key.clone().unwrap_or((current.url.clone(), current.key.clone()));
            let title = title.clone().unwrap_or(current.title.clone());
            let note = note.clone().unwrap_or(current.note.clone());
            let tags = tags.clone().unwrap_or(current.tags.clone());
            let pinned = patch.pinned.unwrap_or(current.pinned);
            tx.execute(
                "UPDATE shelf_links SET url = ?2, key = ?3, title = ?4, note = ?5, tags = ?6, pinned = ?7, updated_at = ?8
                 WHERE id = ?1",
                params![
                    id,
                    url,
                    key,
                    title,
                    note,
                    serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into()),
                    pinned as i64,
                    Utc::now().to_rfc3339()
                ],
            )?;
            let link = get_link(&tx, id)?;
            tx.commit()?;
            Ok(link.ok_or(ShelfError::NotFound))
        })?
    }

    pub fn delete_shelf_link(&self, id: &str) -> Result<(), ShelfError> {
        let changed = self.with_conn(|conn| conn.execute("DELETE FROM shelf_links WHERE id = ?1", params![id]))?;
        if changed == 0 {
            return Err(ShelfError::NotFound);
        }
        Ok(())
    }

    pub fn open_shelf_link(&self, id: &str) -> Result<ShelfLink, ShelfError> {
        self.with_conn(|conn| {
            let now = Utc::now().to_rfc3339();
            let changed = conn.execute(
                "UPDATE shelf_links SET open_count = open_count + 1, last_opened_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            if changed == 0 {
                return Ok(Err(ShelfError::NotFound));
            }
            Ok(get_link(conn, id)?.ok_or(ShelfError::NotFound))
        })?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(url: &str) -> ShelfLinkInput {
        ShelfLinkInput { url: url.into(), ..Default::default() }
    }

    #[test]
    fn keys_match_core() {
        assert_eq!(
            normalize_url("https://WWW.Example.com:443/Docs/?q=1#top").unwrap().1,
            "example.com/Docs?q=1"
        );
        assert_eq!(normalize_url("http://example.com/").unwrap().1, "example.com");
        assert_eq!(normalize_url("http://localhost:3000/app").unwrap().1, "localhost:3000/app");
        assert_eq!(normalize_url("supabase.com/dashboard").unwrap().0, "https://supabase.com/dashboard");
        assert_eq!(normalize_url("localhost:3000").unwrap().1, "localhost:3000");
        assert!(normalize_url("hello").is_none());
        assert!(normalize_url("mailto:a@b.com").is_none());
        assert!(normalize_url("javascript:alert(1)").is_none());
        assert!(normalize_url("ftp://example.com").is_none());
    }

    #[test]
    fn tags_match_core() {
        let tags: Vec<String> = vec![" #Dev ".into(), "dev".into(), "AI  tools".into(), "".into()];
        assert_eq!(normalize_tags(&tags), vec!["Dev".to_string(), "AI tools".to_string()]);
    }

    #[test]
    fn adds_dedupes_updates_opens_and_deletes() {
        let db = Database::open_in_memory().unwrap();
        let first = db
            .add_shelf_links(&[
                ShelfLinkInput {
                    url: "https://www.figma.com/files".into(),
                    note: Some(" design files ".into()),
                    tags: Some(vec!["design".into()]),
                    ..Default::default()
                },
                input("figma.com/files/"),
                input("https://vercel.com"),
            ])
            .unwrap();
        assert_eq!(first.added.len(), 2);
        assert_eq!(first.added[0].title, "figma.com");
        assert_eq!(first.added[0].note, "design files");

        let again = db.add_shelf_links(&[input("https://figma.com/files")]).unwrap();
        assert!(again.added.is_empty());
        assert_eq!(again.existing.len(), 1);

        assert!(matches!(db.add_shelf_links(&[input("nope")]), Err(ShelfError::Invalid(_))));
        assert_eq!(db.list_shelf().unwrap().len(), 2);

        let figma = &first.added[0];
        let vercel = &first.added[1];
        let pinned = db
            .update_shelf_link(&figma.id, &ShelfLinkPatch { pinned: Some(true), title: Some("Figma".into()), ..Default::default() })
            .unwrap();
        assert!(pinned.pinned);
        assert_eq!(pinned.title, "Figma");
        assert_eq!(pinned.note, "design files");

        let clash = db.update_shelf_link(
            &vercel.id,
            &ShelfLinkPatch { url: Some("figma.com/files".into()), ..Default::default() },
        );
        assert_eq!(clash, Err(ShelfError::Conflict));

        let opened = db.open_shelf_link(&vercel.id).unwrap();
        assert_eq!(opened.open_count, 1);
        assert!(opened.last_opened_at.is_some());

        db.delete_shelf_link(&vercel.id).unwrap();
        assert_eq!(db.delete_shelf_link(&vercel.id), Err(ShelfError::NotFound));
        assert_eq!(db.open_shelf_link("missing"), Err(ShelfError::NotFound));
        assert_eq!(db.list_shelf().unwrap().len(), 1);
    }
}
