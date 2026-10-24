//! TL;DRs offline (docs/dev/PLAN-tldr.md): the `item_tldrs` table, mirroring Supabase's. The
//! webview checks and tidies a TL;DR with `normalizeTldr` from `@sourcefold/core`; Rust checks
//! the shape and the limits again before storing it.

use chrono::Utc;
use rusqlite::{params, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::Database;

const GIST_MAX: usize = 600;
const POINT_MAX: usize = 300;
const POINTS_MAX: usize = 6;
const BEST_PART_MAX: usize = 300;
const MODEL_MAX: usize = 200;
const HASH_MAX: usize = 128;

/// Mirrors `ItemTldr` in packages/core/src/tldr/types.ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemTldr {
    pub item_id: String,
    pub tldr: Value,
    pub source: String,
    pub model: Option<String>,
    pub body_hash: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Mirrors `ItemTldrInput`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemTldrInput {
    pub tldr: Value,
    pub source: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub body_hash: Option<String>,
}

fn chars(s: &str) -> usize {
    s.chars().count()
}

/// The stored form of a TL;DR: `{ gist, points, best_part }` within the limits, or an error
/// message for the user.
pub fn check_tldr_input(input: &ItemTldrInput) -> Result<(String, Option<String>, Option<String>), String> {
    if input.source != "article" && input.source != "ai" {
        return Err("Source must be article or ai.".into());
    }
    let obj = input.tldr.as_object().ok_or("A TL;DR must be an object.")?;
    let gist = obj.get("gist").and_then(Value::as_str).map(str::trim).unwrap_or("");
    if gist.is_empty() {
        return Err("A TL;DR needs a gist.".into());
    }
    if chars(gist) > GIST_MAX {
        return Err("The gist is too long.".into());
    }
    let points: Vec<String> = match obj.get("points") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(list)) => {
            let mut out = Vec::new();
            for p in list {
                let text = p.as_str().ok_or("Points must be text.")?.trim();
                if chars(text) > POINT_MAX {
                    return Err("A point is too long.".into());
                }
                if !text.is_empty() {
                    out.push(text.to_string());
                }
            }
            out
        }
        Some(_) => return Err("Points must be a list.".into()),
    };
    if points.len() > POINTS_MAX {
        return Err("A TL;DR has at most 6 points.".into());
    }
    let best_part = match obj.get("best_part") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s.trim().is_empty() => None,
        Some(Value::String(s)) => {
            if chars(s.trim()) > BEST_PART_MAX {
                return Err("The best part is too long.".into());
            }
            Some(s.trim().to_string())
        }
        Some(_) => return Err("The best part must be text.".into()),
    };
    let model = input.model.as_deref().map(str::trim).filter(|m| !m.is_empty()).map(String::from);
    if model.as_deref().map(chars).unwrap_or(0) > MODEL_MAX {
        return Err("The model name is too long.".into());
    }
    let hash = input.body_hash.as_deref().filter(|h| !h.is_empty()).map(String::from);
    if hash.as_deref().map(str::len).unwrap_or(0) > HASH_MAX {
        return Err("Invalid body hash.".into());
    }
    let stored = serde_json::json!({ "gist": gist, "points": points, "best_part": best_part });
    Ok((stored.to_string(), model, hash))
}

fn row_to_tldr(row: &rusqlite::Row) -> Result<ItemTldr> {
    let text: String = row.get(1)?;
    Ok(ItemTldr {
        item_id: row.get(0)?,
        tldr: serde_json::from_str(&text).unwrap_or(Value::Null),
        source: row.get(2)?,
        model: row.get(3)?,
        body_hash: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const COLUMNS: &str = "t.item_id, t.tldr, t.source, t.model, t.body_hash, t.created_at, t.updated_at";

impl Database {
    /// TL;DRs of the live items directly in a folder.
    pub fn list_tldrs_for_folder(&self, folder_id: &str) -> Result<Vec<ItemTldr>> {
        self.with_conn(|conn| {
            let sql = format!(
                "SELECT {COLUMNS} FROM item_tldrs t JOIN items i ON i.id = t.item_id
                 WHERE i.folder_id = ?1 AND i.deleted_at IS NULL ORDER BY t.item_id"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![folder_id], row_to_tldr)?;
            rows.collect()
        })
    }

    /// TL;DRs of every live item in a project (all its groups, at any depth).
    pub fn list_tldrs_for_project(&self, project_id: &str) -> Result<Vec<ItemTldr>> {
        self.with_conn(|conn| {
            let sql = format!(
                "WITH RECURSIVE project_folders AS (
                    SELECT id FROM folders WHERE id = ?1 AND deleted_at IS NULL
                    UNION ALL
                    SELECT f.id FROM folders f JOIN project_folders pf ON f.parent_id = pf.id
                    WHERE f.deleted_at IS NULL
                 )
                 SELECT {COLUMNS} FROM item_tldrs t JOIN items i ON i.id = t.item_id
                 WHERE i.folder_id IN (SELECT id FROM project_folders) AND i.deleted_at IS NULL
                 ORDER BY t.item_id"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params![project_id], row_to_tldr)?;
            rows.collect()
        })
    }

    /// Sets an item's TL;DR (already checked by `check_tldr_input`). None when the item isn't a
    /// live item. Keeps the first created_at.
    pub fn put_tldr(
        &self,
        item_id: &str,
        tldr_json: &str,
        source: &str,
        model: Option<&str>,
        body_hash: Option<&str>,
    ) -> Result<Option<ItemTldr>> {
        self.with_conn(|conn| {
            let live: Option<String> = conn
                .query_row(
                    "SELECT id FROM items WHERE id = ?1 AND deleted_at IS NULL",
                    params![item_id],
                    |r| r.get(0),
                )
                .optional()?;
            if live.is_none() {
                return Ok(None);
            }
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO item_tldrs (item_id, tldr, source, model, body_hash, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
                 ON CONFLICT(item_id) DO UPDATE SET tldr = excluded.tldr, source = excluded.source,
                    model = excluded.model, body_hash = excluded.body_hash, updated_at = excluded.updated_at",
                params![item_id, tldr_json, source, model, body_hash, now],
            )?;
            let sql = format!("SELECT {COLUMNS} FROM item_tldrs t WHERE t.item_id = ?1");
            conn.query_row(&sql, params![item_id], row_to_tldr).optional()
        })
    }

    pub fn delete_tldr(&self, item_id: &str) -> Result<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM item_tldrs WHERE item_id = ?1", params![item_id])?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SaveItemRequest;
    use serde_json::json;

    fn input(tldr: Value) -> ItemTldrInput {
        ItemTldrInput { tldr, source: "ai".into(), model: Some("GPT-6 Luna".into()), body_hash: Some("h".into()) }
    }

    #[test]
    fn checks_shape_and_limits() {
        let (stored, model, hash) =
            check_tldr_input(&input(json!({ "gist": " Turbos cut lag. ", "points": ["a", ""], "best_part": "" })))
                .unwrap();
        assert_eq!(stored, r#"{"best_part":null,"gist":"Turbos cut lag.","points":["a"]}"#);
        assert_eq!(model.as_deref(), Some("GPT-6 Luna"));
        assert_eq!(hash.as_deref(), Some("h"));

        assert!(check_tldr_input(&input(json!({ "points": [] }))).is_err());
        assert!(check_tldr_input(&input(json!({ "gist": "x".repeat(601) }))).is_err());
        assert!(check_tldr_input(&input(json!({ "gist": "g", "points": vec!["p"; 7] }))).is_err());
        let mut bad = input(json!({ "gist": "g" }));
        bad.source = "llm".into();
        assert!(check_tldr_input(&bad).is_err());
    }

    #[test]
    fn stores_lists_and_deletes() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Cars", None).unwrap();
        let group = db.create_folder("Engines", Some(&project.id)).unwrap();
        let sub = db.create_folder("Turbos", Some(&group.id)).unwrap();
        let item = db
            .save_item(SaveItemRequest {
                folder_id: sub.id.clone(),
                kind: "web".into(),
                title: "Twin scroll".into(),
                source_url: Some("https://example.com/a".into()),
                canonical_url: Some("https://example.com/a".into()),
                status: "saved".into(),
                error: None,
                markdown: Some("Body".into()),
                meta: None,
                note: None,
                position: None,
            })
            .unwrap();

        let (stored, model, hash) = check_tldr_input(&input(json!({ "gist": "Turbos cut lag." }))).unwrap();
        let saved = db.put_tldr(&item.id, &stored, "ai", model.as_deref(), hash.as_deref()).unwrap().unwrap();
        assert_eq!(saved.tldr["gist"], "Turbos cut lag.");

        assert_eq!(db.list_tldrs_for_folder(&sub.id).unwrap().len(), 1);
        assert_eq!(db.list_tldrs_for_folder(&group.id).unwrap().len(), 0);
        assert_eq!(db.list_tldrs_for_project(&project.id).unwrap().len(), 1);

        // Replacing keeps one row.
        let again = db.put_tldr(&item.id, &stored, "article", None, None).unwrap().unwrap();
        assert_eq!(again.source, "article");
        assert_eq!(again.created_at, saved.created_at);
        assert_eq!(db.list_tldrs_for_project(&project.id).unwrap().len(), 1);

        assert!(db.put_tldr("missing", &stored, "ai", None, None).unwrap().is_none());

        db.delete_tldr(&item.id).unwrap();
        assert!(db.list_tldrs_for_project(&project.id).unwrap().is_empty());
    }
}
