use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde_json::Value;

use crate::models::{
    AddXPostRequest, CheckUrlResult, Folder, Highlight, HighlightCitation, Item, RecentXItem,
    SaveItemRequest, XPost,
};

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new() -> Result<Self> {
        let db_dir = crate::session::app_data_dir();
        fs::create_dir_all(&db_dir).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;

        let db_path = db_dir.join("sourcefold.db");
        Self::open(db_path)
    }

    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                source_url TEXT,
                canonical_url TEXT,
                status TEXT NOT NULL DEFAULT 'saved',
                error TEXT,
                markdown TEXT,
                meta TEXT NOT NULL DEFAULT '{}',
                note TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                storage_path TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS x_posts (
                id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL,
                parent_id TEXT,
                post_url TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                author_name TEXT NOT NULL,
                handle TEXT NOT NULL,
                author_url TEXT NOT NULL,
                posted_at TEXT,
                text TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Files the signed-in local copy wrote (see local_copy.rs). Only these are ever
            -- moved or deleted by it.
            CREATE TABLE IF NOT EXISTS local_copy_files (
                item_id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                version TEXT NOT NULL
            );

            -- Reader highlights (docs/handoff-highlights.md). Hidden with their item when it is
            -- soft-deleted; removed with it if the row is ever hard-deleted.
            CREATE TABLE IF NOT EXISTS highlights (
                id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
                quote TEXT NOT NULL,
                prefix TEXT NOT NULL DEFAULT '',
                suffix TEXT NOT NULL DEFAULT '',
                start_offset INTEGER NOT NULL,
                end_offset INTEGER NOT NULL,
                image_src TEXT,
                note TEXT,
                seconds INTEGER,
                cited TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_highlights_item_id ON highlights(item_id);
            CREATE INDEX IF NOT EXISTS idx_items_folder_id ON items(folder_id);
            CREATE INDEX IF NOT EXISTS idx_items_canonical_url ON items(canonical_url);
            CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
            CREATE INDEX IF NOT EXISTS idx_x_posts_item_id ON x_posts(item_id);
            CREATE INDEX IF NOT EXISTS idx_x_posts_canonical_url ON x_posts(canonical_url);
            CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
            ",
        )?;

        Self::migrate_to_projects_and_groups(&conn)?;

        Ok(())
    }

    /// Brings databases created by older versions in line with the spec: a project is a
    /// top-level folder, groups live inside projects, and sources only live in groups.
    /// Idempotent; runs on every open.
    fn migrate_to_projects_and_groups(conn: &Connection) -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        let now = Utc::now().to_rfc3339();

        // Default "Inbox" project (created once; a soft-deleted row is never recreated).
        let inbox_exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM folders WHERE id = 'inbox')",
            [],
            |row| row.get(0),
        )?;
        if !inbox_exists {
            tx.execute(
                "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
                 VALUES ('inbox', NULL, 'Inbox', 0, NULL, NULL, ?1, ?1)",
                params![now],
            )?;
        }

        // Older versions kept a hidden top-level `general` folder that held loose sources. It is
        // now an ordinary group "General" inside the Inbox project. A fresh database starts with
        // the same visible group so there is somewhere to save to.
        let general: Option<(Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT parent_id, deleted_at FROM folders WHERE id = 'general'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        match general {
            None => {
                tx.execute(
                    "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
                     VALUES ('general', 'inbox', 'General', 0, NULL, NULL, ?1, ?1)",
                    params![now],
                )?;
            }
            Some((None, None)) => {
                tx.execute(
                    "UPDATE folders SET parent_id = 'inbox', name = 'General', updated_at = ?1 WHERE id = 'general'",
                    params![now],
                )?;
            }
            Some(_) => {}
        }

        // Sources that sit directly in a project move into a "General" group of that project.
        let projects_with_sources: Vec<String> = {
            let mut stmt = tx.prepare(
                "SELECT DISTINCT f.id
                 FROM folders f
                 JOIN items i ON i.folder_id = f.id
                 WHERE f.parent_id IS NULL AND f.deleted_at IS NULL AND i.deleted_at IS NULL",
            )?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>>>()?
        };
        for project_id in projects_with_sources {
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM folders
                     WHERE parent_id = ?1 AND name = 'General' AND deleted_at IS NULL
                     ORDER BY position ASC LIMIT 1",
                    params![project_id],
                    |row| row.get(0),
                )
                .optional()?;
            let group_id = match existing {
                Some(id) => id,
                None => {
                    let id = uuid::Uuid::new_v4().to_string();
                    let position: i32 = tx.query_row(
                        "SELECT COALESCE(MAX(position), -1) + 1 FROM folders
                         WHERE parent_id = ?1 AND deleted_at IS NULL",
                        params![project_id],
                        |row| row.get(0),
                    )?;
                    tx.execute(
                        "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
                         VALUES (?1, ?2, 'General', ?3, NULL, NULL, ?4, ?4)",
                        params![id, project_id, position, now],
                    )?;
                    id
                }
            };
            tx.execute(
                "UPDATE items SET folder_id = ?1, updated_at = ?2
                 WHERE folder_id = ?3 AND deleted_at IS NULL",
                params![group_id, now, project_id],
            )?;
        }

        tx.commit()
    }

    pub fn check_url(&self, canonical_url: &str, folder_id: &str) -> CheckUrlResult {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        let row: Option<(String, String, String)> = conn
            .query_row(
                "SELECT i.id, i.folder_id, f.name
                 FROM items i
                 JOIN folders f ON i.folder_id = f.id
                 WHERE i.canonical_url = ?1 AND i.deleted_at IS NULL AND f.deleted_at IS NULL",
                params![canonical_url],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .unwrap_or(None);

        match row {
            Some((id, fid, folder_name)) => CheckUrlResult {
                exists: true,
                item_id: Some(id),
                folder_id: Some(fid),
                folder_name: Some(folder_name),
            },
            None => {
                let _ = folder_id;
                CheckUrlResult {
                    exists: false,
                    item_id: None,
                    folder_id: None,
                    folder_name: None,
                }
            }
        }
    }

    pub fn get_folders(&self, include_archived: bool) -> Vec<Folder> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        let sql = if include_archived {
            "SELECT f.id, f.parent_id, f.name, f.position, f.archived_at, f.deleted_at, f.created_at, f.updated_at,
                    (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id AND i.deleted_at IS NULL) as item_count
             FROM folders f
             WHERE f.deleted_at IS NULL
             ORDER BY f.position ASC, f.name ASC"
        } else {
            "SELECT f.id, f.parent_id, f.name, f.position, f.archived_at, f.deleted_at, f.created_at, f.updated_at,
                    (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id AND i.deleted_at IS NULL) as item_count
             FROM folders f
             WHERE f.deleted_at IS NULL AND f.archived_at IS NULL
             ORDER BY f.position ASC, f.name ASC"
        };

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                position: row.get(3)?,
                archived_at: row.get(4)?,
                deleted_at: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                item_count: row.get(8)?,
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(Result::ok).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn get_projects(&self) -> Vec<Folder> {
        self.get_folders(false)
    }

    pub fn get_folder(&self, id: &str) -> Result<Folder> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        conn.query_row(
            "SELECT f.id, f.parent_id, f.name, f.position, f.archived_at, f.deleted_at, f.created_at, f.updated_at,
                    (SELECT COUNT(*) FROM items i WHERE i.folder_id = f.id AND i.deleted_at IS NULL) as item_count
             FROM folders f WHERE f.id = ?1 AND f.deleted_at IS NULL",
            params![id],
            |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    position: row.get(3)?,
                    archived_at: row.get(4)?,
                    deleted_at: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    item_count: row.get(8)?,
                })
            },
        )
    }

    pub fn create_folder(&self, name: &str, parent_id: Option<&str>) -> Result<Folder> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // If parent_id is specified, ensure it exists and is not deleted
        if let Some(pid) = parent_id {
            let parent_exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1 AND deleted_at IS NULL)",
                    params![pid],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !parent_exists {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Parent folder does not exist or has been deleted".to_string()),
                ));
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let max_pos: Option<i32> = conn
            .query_row(
                "SELECT MAX(position) FROM folders WHERE parent_id IS ?1 AND deleted_at IS NULL",
                params![parent_id],
                |row| row.get::<_, Option<i32>>(0),
            )
            .unwrap_or(None);
        let position = max_pos.unwrap_or(-1) + 1;

        conn.execute(
            "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?5)",
            params![id, parent_id, name, position, now],
        )?;

        Ok(Folder {
            id,
            parent_id: parent_id.map(|s| s.to_string()),
            name: name.to_string(),
            position,
            archived_at: None,
            deleted_at: None,
            created_at: now.clone(),
            updated_at: now,
            item_count: Some(0),
        })
    }

    pub fn rename_folder(&self, id: &str, name: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![name, now, id],
        )?;
        Ok(())
    }

    pub fn move_folder(&self, id: &str, parent_id: Option<&str>, position: i32) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Reject making a group with sources into a project (parent_id IS NULL)
        if parent_id.is_none() {
            let has_items: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM items WHERE folder_id = ?1 AND deleted_at IS NULL)",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if has_items {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Cannot make a group containing items into a project".to_string()),
                ));
            }
        }

        // Prevent moving a folder into itself or its descendants
        if let Some(target_parent) = parent_id {
            let parent_exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1 AND deleted_at IS NULL)",
                    params![target_parent],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if !parent_exists {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Parent folder does not exist or has been deleted".to_string()),
                ));
            }

            if target_parent == id {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Cannot move a folder into itself".to_string()),
                ));
            }

            let is_descendant: bool = conn
                .query_row(
                    "WITH RECURSIVE subfolders AS (
                        SELECT id FROM folders WHERE parent_id = ?1 AND deleted_at IS NULL
                        UNION ALL
                        SELECT f.id FROM folders f
                        JOIN subfolders s ON f.parent_id = s.id
                        WHERE f.deleted_at IS NULL
                     )
                     SELECT EXISTS(SELECT 1 FROM subfolders WHERE id = ?2)",
                    params![id, target_parent],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if is_descendant {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Cannot move a folder into one of its descendants".to_string()),
                ));
            }
        }

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE folders SET parent_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
            params![parent_id, position, now, id],
        )?;
        Ok(())
    }

    pub fn archive_project(&self, id: &str, archived: bool) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        let archived_at = if archived { Some(now.as_str()) } else { None };
        conn.execute(
            "UPDATE folders SET archived_at = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![archived_at, now, id],
        )?;
        Ok(())
    }

    pub fn delete_folder(&self, id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Check if folder exists
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1 AND deleted_at IS NULL)",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        let now = Utc::now().to_rfc3339();

        // Cascading soft-delete to children subfolders and items
        conn.execute(
            "WITH RECURSIVE subfolders AS (
                SELECT id FROM folders WHERE id = ?1
                UNION ALL
                SELECT f.id FROM folders f
                JOIN subfolders s ON f.parent_id = s.id
             )
             UPDATE items
             SET deleted_at = ?2, updated_at = ?2
             WHERE folder_id IN (SELECT id FROM subfolders)
               AND deleted_at IS NULL",
            params![id, now],
        )?;

        conn.execute(
            "WITH RECURSIVE subfolders AS (
                SELECT id FROM folders WHERE id = ?1
                UNION ALL
                SELECT f.id FROM folders f
                JOIN subfolders s ON f.parent_id = s.id
             )
             UPDATE folders
             SET deleted_at = ?2, updated_at = ?2
             WHERE id IN (SELECT id FROM subfolders)
               AND deleted_at IS NULL",
            params![id, now],
        )?;

        Ok(())
    }

    pub fn get_items(&self, folder_id: &str) -> Vec<Item> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        let mut stmt = match conn.prepare(
            "SELECT id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at
             FROM items
             WHERE folder_id = ?1 AND deleted_at IS NULL
             ORDER BY position ASC, created_at DESC",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = stmt.query_map(params![folder_id], |row| {
            let meta_str: String = row.get(9).unwrap_or_else(|_| "{}".to_string());
            let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));

            Ok(Item {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                source_url: row.get(4)?,
                canonical_url: row.get(5)?,
                status: row.get(6)?,
                error: row.get(7)?,
                markdown: row.get(8)?,
                meta,
                note: row.get(10)?,
                position: row.get(11)?,
                storage_path: row.get(12)?,
                deleted_at: row.get(13)?,
                created_at: row.get(14)?,
                updated_at: row.get(15)?,
            })
        });

        match rows {
            Ok(iter) => iter.filter_map(Result::ok).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn get_item(&self, id: &str) -> Result<Item> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        conn.query_row(
            "SELECT id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at
             FROM items WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |row| {
                let meta_str: String = row.get(9).unwrap_or_else(|_| "{}".to_string());
                let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));

                Ok(Item {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    kind: row.get(2)?,
                    title: row.get(3)?,
                    source_url: row.get(4)?,
                    canonical_url: row.get(5)?,
                    status: row.get(6)?,
                    error: row.get(7)?,
                    markdown: row.get(8)?,
                    meta,
                    note: row.get(10)?,
                    position: row.get(11)?,
                    storage_path: row.get(12)?,
                    deleted_at: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            },
        )
    }

    pub fn save_item(&self, req: SaveItemRequest) -> Result<Item> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Reject saving directly into a project (must belong to a group with parent_id IS NOT NULL)
        let target_parent: Option<Option<String>> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1 AND deleted_at IS NULL",
                params![req.folder_id],
                |row| row.get(0),
            )
            .optional()?;

        let parent_id = match target_parent {
            Some(p) => p,
            None => {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Target folder does not exist or has been deleted".to_string()),
                ));
            }
        };

        if parent_id.is_none() {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some("Items cannot be saved directly into a project; must belong to a group".to_string()),
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let max_pos: Option<i32> = conn
            .query_row(
                "SELECT MAX(position) FROM items WHERE folder_id = ?1 AND deleted_at IS NULL",
                params![req.folder_id],
                |row| row.get::<_, Option<i32>>(0),
            )
            .unwrap_or(None);
        let position = req.position.unwrap_or_else(|| max_pos.unwrap_or(-1) + 1);
        let meta_str = req.meta.as_ref().map(|m| m.to_string()).unwrap_or_else(|| "{}".to_string());

        conn.execute(
            "INSERT INTO items (id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, ?13, ?13)",
            params![
                id,
                req.folder_id,
                req.kind,
                req.title,
                req.source_url,
                req.canonical_url,
                req.status,
                req.error,
                req.markdown,
                meta_str,
                req.note,
                position,
                now,
            ],
        )?;

        let meta = req.meta.unwrap_or_else(|| serde_json::json!({}));

        Ok(Item {
            id,
            folder_id: req.folder_id,
            kind: req.kind,
            title: req.title,
            source_url: req.source_url,
            canonical_url: req.canonical_url,
            status: req.status,
            error: req.error,
            markdown: req.markdown,
            meta,
            note: req.note,
            position,
            storage_path: None,
            deleted_at: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn rename_item(&self, id: &str, title: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE items SET title = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn move_item(&self, id: &str, folder_id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Reject moving directly into a project
        let target_parent: Option<Option<String>> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1 AND deleted_at IS NULL",
                params![folder_id],
                |row| row.get(0),
            )
            .optional()?;

        let parent_id = match target_parent {
            Some(p) => p,
            None => {
                return Err(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                    Some("Target folder does not exist or has been deleted".to_string()),
                ));
            }
        };

        if parent_id.is_none() {
            return Err(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT),
                Some("Items cannot be moved directly into a project; must belong to a group".to_string()),
            ));
        }

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE items SET folder_id = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![folder_id, now, id],
        )?;
        Ok(())
    }

    pub fn delete_item(&self, id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )?;
        if rows == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    pub fn update_item_note(&self, id: &str, note: Option<&str>) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE items SET note = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![note, now, id],
        )?;
        Ok(())
    }

    pub fn update_item_content(&self, id: &str, title: Option<&str>, markdown: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        if let Some(t) = title {
            conn.execute(
                "UPDATE items SET title = ?1, markdown = ?2, updated_at = ?3 WHERE id = ?4 AND deleted_at IS NULL",
                params![t, markdown, now, id],
            )?;
        } else {
            conn.execute(
                "UPDATE items SET markdown = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![markdown, now, id],
            )?;
        }
        Ok(())
    }

    pub fn update_item_storage_path(&self, id: &str, path: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE items SET storage_path = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![path, now, id],
        )?;
        Ok(())
    }

    pub fn create_standalone_note(&self, folder_id: &str, title: &str, markdown: &str) -> Result<Item> {
        self.save_item(SaveItemRequest {
            folder_id: folder_id.to_string(),
            kind: "note".to_string(),
            title: title.to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: Some(markdown.to_string()),
            meta: None,
            note: None,
            position: None,
        })
    }

    pub fn update_standalone_note(&self, id: &str, title: Option<&str>, markdown: &str) -> Result<()> {
        self.update_item_content(id, title, markdown)
    }

    pub fn search_items(&self, query: &str, project_id: Option<&str>) -> Result<Vec<Item>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let search_pattern = format!("%{}%", query);

        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::ToSql>>) = match project_id {
            Some(fid) => (
                "SELECT id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at
                 FROM items
                 WHERE folder_id = ?1 AND deleted_at IS NULL AND (title LIKE ?2 OR markdown LIKE ?2 OR note LIKE ?2)
                 ORDER BY created_at DESC LIMIT 50".to_string(),
                vec![Box::new(fid.to_string()), Box::new(search_pattern)],
            ),
            None => (
                "SELECT id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at
                 FROM items
                 WHERE deleted_at IS NULL AND (title LIKE ?1 OR markdown LIKE ?1 OR note LIKE ?1)
                 ORDER BY created_at DESC LIMIT 50".to_string(),
                vec![Box::new(search_pattern)],
            ),
        };

        let mut stmt = conn.prepare(&sql)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let items = stmt
            .query_map(params_refs.as_slice(), |row| {
                let meta_str: String = row.get(9).unwrap_or_else(|_| "{}".to_string());
                let meta: Value = serde_json::from_str(&meta_str).unwrap_or_else(|_| serde_json::json!({}));

                Ok(Item {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    kind: row.get(2)?,
                    title: row.get(3)?,
                    source_url: row.get(4)?,
                    canonical_url: row.get(5)?,
                    status: row.get(6)?,
                    error: row.get(7)?,
                    markdown: row.get(8)?,
                    meta,
                    note: row.get(10)?,
                    position: row.get(11)?,
                    storage_path: row.get(12)?,
                    deleted_at: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    pub fn add_x_post(&self, req: AddXPostRequest) -> Result<(String, String)> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        let post_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let max_pos: Option<i32> = conn
            .query_row(
                "SELECT MAX(position) FROM x_posts WHERE item_id = ?1",
                params![req.item_id],
                |row| row.get::<_, Option<i32>>(0),
            )
            .unwrap_or(None);
        let position = req.position.unwrap_or_else(|| max_pos.unwrap_or(-1) + 1);

        conn.execute(
            "INSERT INTO x_posts (id, item_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                post_id,
                req.item_id,
                req.parent_post_url,
                req.post_url,
                req.canonical_url,
                req.author_name,
                req.handle,
                req.author_url,
                req.posted_at,
                req.text,
                position,
                now,
            ],
        )?;

        // Update item updated_at and post count in meta
        let mut stmt = conn.prepare(
            "SELECT id, item_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, position, created_at, updated_at
             FROM x_posts WHERE item_id = ?1 ORDER BY position ASC, created_at ASC",
        )?;

        let all_posts = stmt
            .query_map(params![req.item_id], |row| {
                Ok(XPost {
                    id: row.get(0)?,
                    item_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    post_url: row.get(3)?,
                    canonical_url: row.get(4)?,
                    author_name: row.get(5)?,
                    handle: row.get(6)?,
                    author_url: row.get(7)?,
                    posted_at: row.get(8)?,
                    text: row.get(9)?,
                    position: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let post_count = all_posts.len();
        let meta = serde_json::json!({
            "post_count": post_count,
            "latest_post_url": req.post_url,
        });

        conn.execute(
            "UPDATE items SET updated_at = ?1, meta = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![now, meta.to_string(), req.item_id],
        )?;

        Ok((req.item_id, post_id))
    }

    pub fn get_x_posts(&self, item_id: &str) -> Result<Vec<XPost>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };

        // If the parent item is deleted or doesn't exist, return empty
        let item_active: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL)",
                params![item_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !item_active {
            return Ok(Vec::new());
        }

        let mut stmt = conn.prepare(
            "SELECT id, item_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, position, created_at, updated_at
             FROM x_posts WHERE item_id = ?1 ORDER BY position ASC, created_at ASC",
        )?;

        let posts = stmt
            .query_map(params![item_id], |row| {
                Ok(XPost {
                    id: row.get(0)?,
                    item_id: row.get(1)?,
                    parent_id: row.get(2)?,
                    post_url: row.get(3)?,
                    canonical_url: row.get(4)?,
                    author_name: row.get(5)?,
                    handle: row.get(6)?,
                    author_url: row.get(7)?,
                    posted_at: row.get(8)?,
                    text: row.get(9)?,
                    position: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(posts)
    }

    pub fn get_recent_x_items(&self, folder_id: &str) -> Result<Vec<RecentXItem>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut stmt = conn.prepare(
            "SELECT id, title, folder_id, created_at FROM items
             WHERE folder_id = ?1 AND kind = 'x' AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 10",
        )?;

        let items = stmt
            .query_map(params![folder_id], |row| {
                Ok(RecentXItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    folder_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(items)
    }

    // ----------------- Highlights -----------------

    const HIGHLIGHT_COLUMNS: &'static str = "h.id, h.item_id, h.kind, h.quote, h.prefix, h.suffix, h.start_offset, h.end_offset, h.image_src, h.note, h.seconds, h.cited, h.created_at, h.updated_at";

    fn highlight_from_row(row: &rusqlite::Row) -> Result<Highlight> {
        let cited_str: String = row.get(11)?;
        let cited: Vec<HighlightCitation> = serde_json::from_str(&cited_str).unwrap_or_default();
        Ok(Highlight {
            id: row.get(0)?,
            item_id: row.get(1)?,
            kind: row.get(2)?,
            quote: row.get(3)?,
            prefix: row.get(4)?,
            suffix: row.get(5)?,
            start_offset: row.get(6)?,
            end_offset: row.get(7)?,
            image_src: row.get(8)?,
            note: row.get(9)?,
            seconds: row.get(10)?,
            cited,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
        })
    }

    /// Creates the highlight, or replaces the one with the same id (keeping its created_at).
    pub fn put_highlight(&self, h: &Highlight) -> Result<Highlight> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        let cited = serde_json::to_string(&h.cited).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO highlights (id, item_id, kind, quote, prefix, suffix, start_offset, end_offset, image_src, note, seconds, cited, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
             ON CONFLICT(id) DO UPDATE SET
                item_id = excluded.item_id, kind = excluded.kind, quote = excluded.quote,
                prefix = excluded.prefix, suffix = excluded.suffix,
                start_offset = excluded.start_offset, end_offset = excluded.end_offset,
                image_src = excluded.image_src, note = excluded.note, seconds = excluded.seconds,
                cited = excluded.cited, updated_at = excluded.updated_at",
            params![
                h.id, h.item_id, h.kind, h.quote, h.prefix, h.suffix, h.start_offset,
                h.end_offset, h.image_src, h.note, h.seconds, cited, now
            ],
        )?;
        let sql = format!("SELECT {} FROM highlights h WHERE h.id = ?1", Self::HIGHLIGHT_COLUMNS);
        conn.query_row(&sql, params![h.id], Self::highlight_from_row)
    }

    pub fn get_highlight(&self, id: &str) -> Result<Highlight> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let sql = format!("SELECT {} FROM highlights h WHERE h.id = ?1", Self::HIGHLIGHT_COLUMNS);
        conn.query_row(&sql, params![id], Self::highlight_from_row)
    }

    /// Highlights of one live item, in file order.
    pub fn get_highlights_for_item(&self, item_id: &str) -> Result<Vec<Highlight>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let sql = format!(
            "SELECT {} FROM highlights h JOIN items i ON i.id = h.item_id
             WHERE h.item_id = ?1 AND i.deleted_at IS NULL
             ORDER BY h.start_offset ASC, h.created_at ASC, h.id ASC",
            Self::HIGHLIGHT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![item_id], Self::highlight_from_row)?;
        rows.collect()
    }

    /// Highlights of the live items directly in a folder.
    pub fn get_highlights_for_folder(&self, folder_id: &str) -> Result<Vec<Highlight>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let sql = format!(
            "SELECT {} FROM highlights h JOIN items i ON i.id = h.item_id
             WHERE i.folder_id = ?1 AND i.deleted_at IS NULL
             ORDER BY h.item_id ASC, h.start_offset ASC, h.created_at ASC, h.id ASC",
            Self::HIGHLIGHT_COLUMNS
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![folder_id], Self::highlight_from_row)?;
        rows.collect()
    }

    pub fn update_highlight_note(&self, id: &str, note: Option<&str>) -> Result<Highlight> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE highlights SET note = ?1, updated_at = ?2 WHERE id = ?3",
            params![note, now, id],
        )?;
        if rows == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        let sql = format!("SELECT {} FROM highlights h WHERE h.id = ?1", Self::HIGHLIGHT_COLUMNS);
        conn.query_row(&sql, params![id], Self::highlight_from_row)
    }

    pub fn delete_highlight(&self, id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let rows = conn.execute("DELETE FROM highlights WHERE id = ?1", params![id])?;
        if rows == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    /// Moves an item's updated_at (a highlight change counts as an edit of the item).
    pub fn touch_item(&self, id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE items SET updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        ).optional()
    }

    pub fn local_copy_files(&self) -> Result<Vec<(String, String, String)>> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut stmt = conn.prepare("SELECT item_id, path, version FROM local_copy_files")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        rows.collect()
    }

    pub fn set_local_copy_file(&self, item_id: &str, path: &str, version: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        conn.execute(
            "INSERT INTO local_copy_files (item_id, path, version) VALUES (?1, ?2, ?3)
             ON CONFLICT(item_id) DO UPDATE SET path = excluded.path, version = excluded.version",
            params![item_id, path, version],
        )?;
        Ok(())
    }

    pub fn remove_local_copy_file(&self, item_id: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        conn.execute("DELETE FROM local_copy_files WHERE item_id = ?1", params![item_id])?;
        Ok(())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(poisoned) => poisoned.into_inner(),
        };
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_in_memory_db_init() {
        let db = Database::open_in_memory().unwrap();

        // Inbox project should exist by default
        let inbox = db.get_folder("inbox").expect("inbox project must exist");
        assert_eq!(inbox.id, "inbox");
        assert_eq!(inbox.name, "Inbox");
        assert_eq!(inbox.parent_id, None);

        // General group should exist inside Inbox project
        let general = db.get_folder("general").expect("general group must exist");
        assert_eq!(general.id, "general");
        assert_eq!(general.name, "General");
        assert_eq!(general.parent_id, Some("inbox".to_string()));

        // Folders list should contain inbox and general
        let folders = db.get_folders(false);
        assert_eq!(folders.len(), 2);
    }

    #[test]
    fn test_folder_crud() {
        let db = Database::open_in_memory().unwrap();

        // Create root project (Inbox is pos 0, next root project is pos 1)
        let project = db.create_folder("AI Research", None).unwrap();
        assert_eq!(project.name, "AI Research");
        assert_eq!(project.parent_id, None);
        assert_eq!(project.position, 1);

        // Create child group inside project
        let group = db.create_folder("LLMs", Some(&project.id)).unwrap();
        assert_eq!(group.name, "LLMs");
        assert_eq!(group.parent_id, Some(project.id.clone()));
        assert_eq!(group.position, 0);

        // Create second child group
        let group2 = db.create_folder("Vision", Some(&project.id)).unwrap();
        assert_eq!(group2.position, 1);

        // Get folder by ID
        let fetched = db.get_folder(&group.id).unwrap();
        assert_eq!(fetched.name, "LLMs");

        // Rename folder
        db.rename_folder(&group.id, "Large Language Models").unwrap();
        let renamed = db.get_folder(&group.id).unwrap();
        assert_eq!(renamed.name, "Large Language Models");

        // Move folder position and parent (group2 has no items, so moving to root project is allowed)
        db.move_folder(&group2.id, None, 5).unwrap();
        let moved = db.get_folder(&group2.id).unwrap();
        assert_eq!(moved.parent_id, None);
        assert_eq!(moved.position, 5);

        // Archive project
        db.archive_project(&project.id, true).unwrap();
        let unarchived = db.get_folders(false);
        assert!(!unarchived.iter().any(|f| f.id == project.id));
        let all_folders = db.get_folders(true);
        assert!(all_folders.iter().any(|f| f.id == project.id && f.archived_at.is_some()));

        // Unarchive
        db.archive_project(&project.id, false).unwrap();
        let restored = db.get_folders(false);
        assert!(restored.iter().any(|f| f.id == project.id && f.archived_at.is_none()));
    }

    #[test]
    fn test_delete_folder_cascading() {
        let db = Database::open_in_memory().unwrap();

        // Create parent project and child group
        let parent = db.create_folder("Parent Project", None).unwrap();
        let child = db.create_folder("Sub Group", Some(&parent.id)).unwrap();
        let grandchild = db.create_folder("Grandchild Group", Some(&child.id)).unwrap();

        // Reject saving item directly into parent project (must be in group)
        let root_item_res = db.save_item(SaveItemRequest {
            folder_id: parent.id.clone(),
            kind: "note".to_string(),
            title: "Parent Note".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: Some("Parent note text".to_string()),
            meta: None,
            note: None,
            position: None,
        });
        assert!(root_item_res.is_err());

        // Add item to child group
        let item1 = db.save_item(SaveItemRequest {
            folder_id: child.id.clone(),
            kind: "note".to_string(),
            title: "Child Note".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: Some("Child note text".to_string()),
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        // Add item to grandchild group
        let item2 = db.save_item(SaveItemRequest {
            folder_id: grandchild.id.clone(),
            kind: "note".to_string(),
            title: "Grandchild Note".to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: Some("Grandchild note text".to_string()),
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        // Reject turning child group into project because it has items
        assert!(db.move_folder(&child.id, None, 0).is_err());

        // Delete parent project -> soft-delete cascades to child, grandchild, item1, item2
        db.delete_folder(&parent.id).unwrap();

        // Folders should be soft-deleted (get_folder returns error)
        assert!(db.get_folder(&parent.id).is_err());
        assert!(db.get_folder(&child.id).is_err());
        assert!(db.get_folder(&grandchild.id).is_err());

        // Items should be soft-deleted (get_item returns error)
        assert!(db.get_item(&item1.id).is_err());
        assert!(db.get_item(&item2.id).is_err());

        // Un-deleted folders should not contain parent, child, or grandchild
        let folders = db.get_folders(false);
        assert!(!folders.iter().any(|f| f.id == parent.id || f.id == child.id || f.id == grandchild.id));
    }

    #[test]
    fn test_legacy_general_migration() {
        let conn = Connection::open_in_memory().unwrap();
        // Create schema with legacy root general folder containing an item
        conn.execute_batch(
            "CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE items (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                source_url TEXT,
                canonical_url TEXT,
                status TEXT NOT NULL DEFAULT 'saved',
                error TEXT,
                markdown TEXT,
                meta TEXT NOT NULL DEFAULT '{}',
                note TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                storage_path TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE x_posts (
                id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL,
                parent_id TEXT,
                post_url TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                author_name TEXT NOT NULL,
                handle TEXT NOT NULL,
                author_url TEXT NOT NULL,
                posted_at TEXT,
                text TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
            VALUES ('general', NULL, 'General', 0, NULL, NULL, '2026-01-01', '2026-01-01');
            INSERT INTO items (id, folder_id, kind, title, created_at, updated_at)
            VALUES ('item-legacy', 'general', 'note', 'Legacy Note', '2026-01-01', '2026-01-01');",
        ).unwrap();

        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema().unwrap();

        let general = db.get_folder("general").unwrap();
        assert_eq!(general.parent_id, Some("inbox".to_string()));
        assert_eq!(general.name, "General");

        let inbox = db.get_folder("inbox").unwrap();
        assert_eq!(inbox.parent_id, None);
        assert_eq!(inbox.name, "Inbox");

        let item = db.get_item("item-legacy").unwrap();
        assert_eq!(item.folder_id, "general");
    }

    #[test]
    fn test_item_crud_and_check_url() {
        let db = Database::open_in_memory().unwrap();
        let proj = db.create_folder("Test Project", None).unwrap();
        let folder1 = db.create_folder("Folder 1", Some(&proj.id)).unwrap();
        let folder2 = db.create_folder("Folder 2", Some(&proj.id)).unwrap();

        let url = "https://example.com/test-article";

        // Initial check_url -> not exists
        let check_none = db.check_url(url, &folder1.id);
        assert!(!check_none.exists);
        assert_eq!(check_none.item_id, None);

        // Save item in folder 1
        let item = db.save_item(SaveItemRequest {
            folder_id: folder1.id.clone(),
            kind: "article".to_string(),
            title: "Original Title".to_string(),
            source_url: Some(url.to_string()),
            canonical_url: Some(url.to_string()),
            status: "saved".to_string(),
            error: None,
            markdown: Some("# Article Markdown".to_string()),
            meta: Some(serde_json::json!({ "word_count": 500 })),
            note: Some("My note".to_string()),
            position: Some(0),
        }).unwrap();

        // check_url within folder 1 -> exists in folder 1
        let check_f1 = db.check_url(url, &folder1.id);
        assert!(check_f1.exists);
        assert_eq!(check_f1.item_id.as_deref(), Some(item.id.as_str()));
        assert_eq!(check_f1.folder_id.as_deref(), Some(folder1.id.as_str()));
        assert_eq!(check_f1.folder_name.as_deref(), Some("Folder 1"));

        // check_url from folder 2 -> detects duplicate saved in folder 1
        let check_f2 = db.check_url(url, &folder2.id);
        assert!(check_f2.exists);
        assert_eq!(check_f2.item_id.as_deref(), Some(item.id.as_str()));
        assert_eq!(check_f2.folder_id.as_deref(), Some(folder1.id.as_str()));
        assert_eq!(check_f2.folder_name.as_deref(), Some("Folder 1"));

        // Update item note
        db.update_item_note(&item.id, Some("Updated Note")).unwrap();
        let item_updated = db.get_item(&item.id).unwrap();
        assert_eq!(item_updated.note.as_deref(), Some("Updated Note"));

        // Rename item
        db.rename_item(&item.id, "Renamed Title").unwrap();
        assert_eq!(db.get_item(&item.id).unwrap().title, "Renamed Title");

        // Update item content
        db.update_item_content(&item.id, Some("Final Title"), "# New Content").unwrap();
        let content_item = db.get_item(&item.id).unwrap();
        assert_eq!(content_item.title, "Final Title");
        assert_eq!(content_item.markdown.as_deref(), Some("# New Content"));

        // Update storage path
        db.update_item_storage_path(&item.id, "/path/to/drive/file.md").unwrap();
        assert_eq!(db.get_item(&item.id).unwrap().storage_path.as_deref(), Some("/path/to/drive/file.md"));

        // Move item to folder 2
        db.move_item(&item.id, &folder2.id).unwrap();
        let moved_item = db.get_item(&item.id).unwrap();
        assert_eq!(moved_item.folder_id, folder2.id);
        assert_eq!(db.get_items(&folder1.id).len(), 0);
        assert_eq!(db.get_items(&folder2.id).len(), 1);

        // Search items
        let search_res = db.search_items("Content", None).unwrap();
        assert_eq!(search_res.len(), 1);
        assert_eq!(search_res[0].id, item.id);

        let search_scoped = db.search_items("Content", Some(&folder1.id)).unwrap();
        assert_eq!(search_scoped.len(), 0);

        // Standalone note
        let note = db.create_standalone_note(&folder2.id, "Quick Note", "Don't forget this").unwrap();
        assert_eq!(note.kind, "note");
        assert_eq!(note.title, "Quick Note");
        db.update_standalone_note(&note.id, Some("Updated Quick Note"), "Remember that").unwrap();
        assert_eq!(db.get_item(&note.id).unwrap().title, "Updated Quick Note");

        // Delete item
        db.delete_item(&item.id).unwrap();
        assert!(db.get_item(&item.id).is_err());
        let check_after_del = db.check_url(url, &folder2.id);
        assert!(!check_after_del.exists);
    }

    #[test]
    fn test_x_post_and_recent() {
        let db = Database::open_in_memory().unwrap();
        let proj = db.create_folder("X Project", None).unwrap();
        let folder = db.create_folder("Tweets", Some(&proj.id)).unwrap();

        // Create root item for X thread
        let item = db.save_item(SaveItemRequest {
            folder_id: folder.id.clone(),
            kind: "x".to_string(),
            title: "Thread by @alice".to_string(),
            source_url: Some("https://x.com/alice/status/100".to_string()),
            canonical_url: Some("https://x.com/alice/status/100".to_string()),
            status: "saved".to_string(),
            error: None,
            markdown: None,
            meta: None,
            note: None,
            position: None,
        }).unwrap();

        // Add root post
        let (_, post1_id) = db.add_x_post(AddXPostRequest {
            item_id: item.id.clone(),
            post_url: "https://x.com/alice/status/100".to_string(),
            canonical_url: "https://x.com/alice/status/100".to_string(),
            author_name: "Alice".to_string(),
            handle: "alice".to_string(),
            author_url: "https://x.com/alice".to_string(),
            posted_at: Some("2026-10-15T10:00:00Z".to_string()),
            text: "Root post content".to_string(),
            parent_post_url: None,
            position: None,
        }).unwrap();

        // Add reply post
        let (_, post2_id) = db.add_x_post(AddXPostRequest {
            item_id: item.id.clone(),
            post_url: "https://x.com/alice/status/101".to_string(),
            canonical_url: "https://x.com/alice/status/101".to_string(),
            author_name: "Alice".to_string(),
            handle: "alice".to_string(),
            author_url: "https://x.com/alice".to_string(),
            posted_at: Some("2026-10-15T10:05:00Z".to_string()),
            text: "Reply post content".to_string(),
            parent_post_url: Some("https://x.com/alice/status/100".to_string()),
            position: None,
        }).unwrap();

        // Get posts and verify tree order and metadata
        let posts = db.get_x_posts(&item.id).unwrap();
        assert_eq!(posts.len(), 2);
        assert_eq!(posts[0].id, post1_id);
        assert_eq!(posts[0].parent_id, None);
        assert_eq!(posts[1].id, post2_id);
        assert_eq!(posts[1].parent_id.as_deref(), Some("https://x.com/alice/status/100"));

        // Verify item meta was updated with post_count
        let updated_item = db.get_item(&item.id).unwrap();
        assert_eq!(updated_item.meta["post_count"], 2);

        // Get recent x items
        let recent = db.get_recent_x_items(&folder.id).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, item.id);
        assert_eq!(recent[0].title, "Thread by @alice");

        // Deleting item cascades to remove its x_posts
        db.delete_item(&item.id).unwrap();
        let posts_after = db.get_x_posts(&item.id).unwrap();
        assert!(posts_after.is_empty());
    }

    #[test]
    fn test_settings() {
        let db = Database::open_in_memory().unwrap();

        assert_eq!(db.get_setting("theme").unwrap(), None);

        db.set_setting("theme", "dark").unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), Some("dark".to_string()));

        db.set_setting("theme", "light").unwrap();
        assert_eq!(db.get_setting("theme").unwrap(), Some("light".to_string()));

        db.set_setting("sync_enabled", "true").unwrap();
        assert_eq!(db.get_setting("sync_enabled").unwrap(), Some("true".to_string()));
    }

    fn note_in(folder_id: &str, title: &str) -> SaveItemRequest {
        SaveItemRequest {
            folder_id: folder_id.to_string(),
            kind: "note".to_string(),
            title: title.to_string(),
            source_url: None,
            canonical_url: None,
            status: "saved".to_string(),
            error: None,
            markdown: Some("text".to_string()),
            meta: None,
            note: None,
            position: None,
        }
    }

    fn legacy_connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                name TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                archived_at TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE items (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                source_url TEXT,
                canonical_url TEXT,
                status TEXT NOT NULL DEFAULT 'saved',
                error TEXT,
                markdown TEXT,
                meta TEXT NOT NULL DEFAULT '{}',
                note TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                storage_path TEXT,
                deleted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE x_posts (
                id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL,
                parent_id TEXT,
                post_url TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                author_name TEXT NOT NULL,
                handle TEXT NOT NULL,
                author_url TEXT NOT NULL,
                posted_at TEXT,
                text TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_legacy_project_with_loose_sources_gets_a_group() {
        let conn = legacy_connection();
        conn.execute_batch(
            "INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
             VALUES ('p1', NULL, 'Old Project', 1, '2026-01-01', '2026-01-01');
             INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
             VALUES ('p2', NULL, 'Empty Project', 2, '2026-01-01', '2026-01-01');
             INSERT INTO items (id, folder_id, kind, title, created_at, updated_at)
             VALUES ('loose', 'p1', 'note', 'Loose', '2026-01-01', '2026-01-01');",
        )
        .unwrap();
        let db = Database { conn: Arc::new(Mutex::new(conn)) };
        db.init_schema().unwrap();

        let item = db.get_item("loose").unwrap();
        assert_ne!(item.folder_id, "p1");
        let group = db.get_folder(&item.folder_id).unwrap();
        assert_eq!(group.name, "General");
        assert_eq!(group.parent_id.as_deref(), Some("p1"));

        // Projects without sources are left alone.
        assert!(db.get_folders(false).iter().all(|f| f.parent_id.as_deref() != Some("p2")));
        assert_eq!(db.get_folder("p2").unwrap().parent_id, None);

        // Running the migration again changes nothing.
        let folders_before = db.get_folders(true).len();
        db.init_schema().unwrap();
        assert_eq!(db.get_folders(true).len(), folders_before);
        assert_eq!(db.get_item("loose").unwrap().folder_id, group.id);
    }

    #[test]
    fn test_legacy_empty_general_becomes_group_in_inbox() {
        let conn = legacy_connection();
        conn.execute_batch(
            "INSERT INTO folders (id, parent_id, name, position, created_at, updated_at)
             VALUES ('general', NULL, 'General', 0, '2026-01-01', '2026-01-01');",
        )
        .unwrap();
        let db = Database { conn: Arc::new(Mutex::new(conn)) };
        db.init_schema().unwrap();

        let general = db.get_folder("general").unwrap();
        assert_eq!(general.parent_id.as_deref(), Some("inbox"));
        // No folder other than the Inbox project is top-level.
        let roots: Vec<_> = db
            .get_folders(true)
            .into_iter()
            .filter(|f| f.parent_id.is_none())
            .collect();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].id, "inbox");
    }

    #[test]
    fn test_deleted_general_is_not_recreated() {
        let db = Database::open_in_memory().unwrap();
        db.delete_folder("general").unwrap();
        assert!(db.get_folder("general").is_err());

        db.init_schema().unwrap();
        assert!(db.get_folder("general").is_err());
        assert!(db.get_folder("inbox").is_ok());
    }

    #[test]
    fn test_delete_group_cascades_and_leaves_siblings() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Project", None).unwrap();
        let group = db.create_folder("Group", Some(&project.id)).unwrap();
        let subgroup = db.create_folder("Subgroup", Some(&group.id)).unwrap();
        let sibling = db.create_folder("Sibling", Some(&project.id)).unwrap();

        let in_group = db.save_item(note_in(&group.id, "In group")).unwrap();
        let in_subgroup = db.save_item(note_in(&subgroup.id, "In subgroup")).unwrap();
        let in_sibling = db.save_item(note_in(&sibling.id, "In sibling")).unwrap();

        db.delete_folder(&group.id).unwrap();

        assert!(db.get_folder(&group.id).is_err());
        assert!(db.get_folder(&subgroup.id).is_err());
        assert!(db.get_item(&in_group.id).is_err());
        assert!(db.get_item(&in_subgroup.id).is_err());
        assert!(db.get_items(&subgroup.id).is_empty());

        // The project and the sibling group are untouched, and nothing was re-parented.
        assert_eq!(db.get_folder(&project.id).unwrap().parent_id, None);
        assert_eq!(
            db.get_folder(&sibling.id).unwrap().parent_id.as_deref(),
            Some(project.id.as_str())
        );
        assert!(db.get_item(&in_sibling.id).is_ok());
    }

    #[test]
    fn test_deleting_a_group_never_moves_sources_elsewhere() {
        let db = Database::open_in_memory().unwrap();
        let group = db.create_folder("Group", Some("inbox")).unwrap();
        let item = db.save_item(note_in(&group.id, "Doomed")).unwrap();
        db.delete_folder(&group.id).unwrap();

        assert!(db.get_item(&item.id).is_err());
        assert!(db.get_items("general").is_empty());
        assert!(db.get_items("inbox").is_empty());
    }

    #[test]
    fn test_sources_must_live_in_groups() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Project", None).unwrap();
        let group = db.create_folder("Group", Some(&project.id)).unwrap();

        assert!(db.save_item(note_in(&project.id, "Direct")).is_err());
        assert!(db.create_standalone_note(&project.id, "Direct", "text").is_err());
        assert!(db.save_item(note_in("no-such-folder", "Nowhere")).is_err());

        let item = db.save_item(note_in(&group.id, "OK")).unwrap();
        assert!(db.move_item(&item.id, &project.id).is_err());
        assert_eq!(db.get_item(&item.id).unwrap().folder_id, group.id);
    }

    #[test]
    fn test_group_with_sources_cannot_become_project() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Project", None).unwrap();
        let full = db.create_folder("Full", Some(&project.id)).unwrap();
        let empty = db.create_folder("Empty", Some(&project.id)).unwrap();
        db.save_item(note_in(&full.id, "Source")).unwrap();

        assert!(db.move_folder(&full.id, None, 0).is_err());
        assert_eq!(
            db.get_folder(&full.id).unwrap().parent_id.as_deref(),
            Some(project.id.as_str())
        );
        assert!(db.move_folder(&empty.id, None, 0).is_ok());
    }

    #[test]
    fn test_move_folder_rejects_bad_parents() {
        let db = Database::open_in_memory().unwrap();
        let project = db.create_folder("Project", None).unwrap();
        let group = db.create_folder("Group", Some(&project.id)).unwrap();
        let child = db.create_folder("Child", Some(&group.id)).unwrap();
        let gone = db.create_folder("Gone", Some(&project.id)).unwrap();
        db.delete_folder(&gone.id).unwrap();

        assert!(db.move_folder(&group.id, Some(&group.id), 0).is_err());
        assert!(db.move_folder(&group.id, Some(&child.id), 0).is_err());
        assert!(db.move_folder(&group.id, Some(&gone.id), 0).is_err());
        assert!(db.move_folder(&group.id, Some("missing"), 0).is_err());
        assert!(db.move_folder(&child.id, Some(&project.id), 2).is_ok());
    }

    #[test]
    fn test_file_database_uses_wal_and_busy_timeout() {
        let dir = std::env::temp_dir().join(format!("sf_test_db_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db = Database::open(dir.join("sourcefold.db")).unwrap();

        {
            let conn = db.conn.lock().unwrap();
            let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
            assert_eq!(mode.to_lowercase(), "wal");
            let timeout: i64 = conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0)).unwrap();
            assert_eq!(timeout, 5000);
            let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
            assert_eq!(fk, 1);
        }
        drop(db);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_in_memory_database_skips_wal() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode.to_lowercase(), "memory");
        let timeout: i64 = conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0)).unwrap();
        assert_eq!(timeout, 5000);
    }
}
