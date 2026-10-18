//! The index files: one SQLite file per project (docs/handoff-search.md, "Index file schema").
//!
//! A project's file is only opened when that project is searched or indexed. Every project has a
//! writer connection (the indexer, vector writes) and a reader connection (queries) so a search
//! never waits for a write transaction to finish: the files use WAL.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use rusqlite::{params, Connection, OptionalExtension};

use super::chunker::Passage;
use super::hash::fnv1a64_hex;

pub const SCHEMA_VERSION: i64 = 1;
/// Vectors are cut to this many numbers (Matryoshka) and stored as little-endian f32.
pub const VECTOR_DIMS: usize = 256;

const CLOSED: &str = "The search index is being rebuilt. Try again in a moment.";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn db_error(e: rusqlite::Error) -> String {
    format!("Search couldn't read its index: {}", e)
}

/// Project ids are UUIDs or `unsorted`. Anything that could change a file path is refused.
pub fn is_valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// What gets embedded for a passage: `title: <title or none> | text: <passage>`.
pub fn embed_input(title: &str, text: &str) -> String {
    let title = title.trim();
    format!("title: {} | text: {}", if title.is_empty() { "none" } else { title }, text)
}

pub fn text_hash(title: &str, text: &str) -> String {
    fnv1a64_hex(embed_input(title, text).as_bytes())
}

#[derive(Debug, Clone, PartialEq)]
pub struct SourceRow {
    pub item_id: String,
    pub folder_id: String,
    pub title: String,
    pub kind: String,
    pub url: Option<String>,
    pub path: String,
    pub fingerprint: String,
    pub content_hash: String,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub sources_indexed: i64,
    pub passages_total: i64,
    pub passages_embedded: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmbedJobRow {
    pub project_id: String,
    pub text_hash: String,
    pub input: String,
}

pub struct Handle {
    write: Mutex<Option<Connection>>,
    read: Mutex<Option<Connection>>,
}

impl Handle {
    pub fn with_write<R>(
        &self,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<R>,
    ) -> Result<R, String> {
        let mut guard = lock(&self.write);
        let conn = guard.as_mut().ok_or_else(|| CLOSED.to_string())?;
        f(conn).map_err(db_error)
    }

    pub fn with_read<R>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<R>,
    ) -> Result<R, String> {
        let guard = lock(&self.read);
        let conn = guard.as_ref().ok_or_else(|| CLOSED.to_string())?;
        f(conn).map_err(db_error)
    }

    fn close(&self) {
        *lock(&self.write) = None;
        *lock(&self.read) = None;
    }
}

/// Every passage that has a vector for one model, normalized, for dot-product search.
pub struct VectorCache {
    pub model: String,
    pub ids: Vec<i64>,
    pub is_body: Vec<bool>,
    data: Vec<f32>,
}

impl VectorCache {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// The `k` best passages (`body` or not) as `(passage id, cosine)`, best first. `query` must
    /// be normalized.
    pub fn top(&self, query: &[f32], body: bool, k: usize) -> Vec<(i64, f32)> {
        let mut scored: Vec<(f32, usize)> = Vec::new();
        for (index, row) in self.data.as_chunks::<VECTOR_DIMS>().0.iter().enumerate() {
            if self.is_body[index] != body {
                continue;
            }
            let score: f32 = row.iter().zip(query).map(|(a, b)| a * b).sum();
            scored.push((score, index));
        }
        let by_score = |a: &(f32, usize), b: &(f32, usize)| {
            b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal)
        };
        if k > 0 && scored.len() > k {
            scored.select_nth_unstable_by(k - 1, by_score);
            scored.truncate(k);
        }
        scored.sort_by(by_score);
        scored.into_iter().map(|(score, index)| (self.ids[index], score)).collect()
    }
}

pub fn normalize(vector: &[f32]) -> Option<Vec<f32>> {
    if vector.len() != VECTOR_DIMS || vector.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return None;
    }
    Some(vector.iter().map(|v| v / norm).collect())
}

fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(vector.len() * 4);
    for v in vector {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn blob_to_vector(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.len() != VECTOR_DIMS * 4 {
        return None;
    }
    Some(blob.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect())
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sources (
    item_id TEXT PRIMARY KEY, folder_id TEXT, title TEXT, kind TEXT, url TEXT,
    path TEXT, fingerprint TEXT, content_hash TEXT, indexed_at TEXT
);
CREATE TABLE IF NOT EXISTS passages (
    id INTEGER PRIMARY KEY, item_id TEXT NOT NULL, ord INTEGER NOT NULL, type TEXT NOT NULL,
    heading TEXT NOT NULL, text TEXT NOT NULL, passage_start TEXT NOT NULL, seconds REAL,
    text_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_passages_item ON passages(item_id);
CREATE INDEX IF NOT EXISTS idx_passages_hash ON passages(text_hash);
CREATE VIRTUAL TABLE IF NOT EXISTS passages_fts USING fts5(
    text, heading, content='passages', content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS passages_ai AFTER INSERT ON passages BEGIN
    INSERT INTO passages_fts(rowid, text, heading) VALUES (new.id, new.text, new.heading);
END;
CREATE TRIGGER IF NOT EXISTS passages_ad AFTER DELETE ON passages BEGIN
    INSERT INTO passages_fts(passages_fts, rowid, text, heading)
    VALUES ('delete', old.id, old.text, old.heading);
END;
CREATE TABLE IF NOT EXISTS vectors (
    text_hash TEXT NOT NULL, model TEXT NOT NULL, vec BLOB NOT NULL,
    PRIMARY KEY (text_hash, model)
);
";

fn open_connection(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA synchronous = NORMAL;",
    )?;
    Ok(conn)
}

fn user_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
}

pub struct SearchStore {
    dir: PathBuf,
    handles: Mutex<HashMap<String, Arc<Handle>>>,
    generations: Mutex<HashMap<String, u64>>,
    vector_caches: Mutex<HashMap<String, (u64, Arc<VectorCache>)>>,
}

impl SearchStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            handles: Mutex::new(HashMap::new()),
            generations: Mutex::new(HashMap::new()),
            vector_caches: Mutex::new(HashMap::new()),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn index_path(&self, project_id: &str) -> PathBuf {
        self.dir.join(format!("{}.sqlite", project_id))
    }

    fn check_id(project_id: &str) -> Result<(), String> {
        if is_valid_project_id(project_id) {
            Ok(())
        } else {
            Err("That project can't be searched.".to_string())
        }
    }

    fn open_new(&self, project_id: &str) -> Result<Handle, String> {
        let path = self.index_path(project_id);
        fs::create_dir_all(&self.dir)
            .map_err(|e| format!("Search couldn't create its folder: {}", e))?;
        for attempt in 0..2 {
            let write = open_connection(&path).map_err(db_error)?;
            let version = user_version(&write).map_err(db_error)?;
            if version != 0 && version != SCHEMA_VERSION {
                // An index from another version of the app: start over.
                drop(write);
                if attempt == 1 {
                    return Err("Search couldn't reset its index.".to_string());
                }
                remove_index_files(&path);
                continue;
            }
            write.execute_batch(SCHEMA).map_err(db_error)?;
            write
                .execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION))
                .map_err(db_error)?;
            write
                .execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?1)",
                    params![SCHEMA_VERSION.to_string()],
                )
                .map_err(db_error)?;
            write
                .execute(
                    "INSERT OR IGNORE INTO meta (key, value) VALUES ('project_id', ?1)",
                    params![project_id],
                )
                .map_err(db_error)?;
            let read = open_connection(&path).map_err(db_error)?;
            return Ok(Handle { write: Mutex::new(Some(write)), read: Mutex::new(Some(read)) });
        }
        Err("Search couldn't open its index.".to_string())
    }

    /// The project's index. `create` makes the file when it isn't there; otherwise `Ok(None)`.
    pub fn handle(&self, project_id: &str, create: bool) -> Result<Option<Arc<Handle>>, String> {
        Self::check_id(project_id)?;
        let mut handles = lock(&self.handles);
        if let Some(h) = handles.get(project_id) {
            return Ok(Some(h.clone()));
        }
        if !create && !self.index_path(project_id).exists() {
            return Ok(None);
        }
        let handle = Arc::new(self.open_new(project_id)?);
        handles.insert(project_id.to_string(), handle.clone());
        Ok(Some(handle))
    }

    /// Projects that have an index file, sorted.
    pub fn list_projects(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("sqlite") {
                    continue;
                }
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    if is_valid_project_id(stem) {
                        out.push(stem.to_string());
                    }
                }
            }
        }
        out.sort();
        out
    }

    fn generation(&self, project_id: &str) -> u64 {
        lock(&self.generations).get(project_id).copied().unwrap_or(0)
    }

    /// Drops the project's in-memory vectors; call after any change to its passages or vectors.
    pub fn invalidate(&self, project_id: &str) {
        *lock(&self.generations).entry(project_id.to_string()).or_insert(0) += 1;
        lock(&self.vector_caches).remove(project_id);
    }

    // ---- sources and passages ------------------------------------------------------------

    pub fn source_rows(&self, project_id: &str) -> Result<HashMap<String, SourceRow>, String> {
        let handle = self.handle(project_id, true)?.ok_or_else(|| CLOSED.to_string())?;
        handle.with_read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT item_id, folder_id, title, kind, url, path, fingerprint, content_hash
                 FROM sources",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(SourceRow {
                    item_id: row.get(0)?,
                    folder_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    kind: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    url: row.get(4)?,
                    path: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    fingerprint: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    content_hash: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                })
            })?;
            let mut out = HashMap::new();
            for row in rows {
                let row = row?;
                out.insert(row.item_id.clone(), row);
            }
            Ok(out)
        })
    }

    /// Replaces a source's passages in one transaction, so a search sees the old or the new ones.
    pub fn replace_source(
        &self,
        project_id: &str,
        source: &SourceRow,
        passages: &[Passage],
    ) -> Result<(), String> {
        let handle = self.handle(project_id, true)?.ok_or_else(|| CLOSED.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        let result = handle.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM passages WHERE item_id = ?1", params![source.item_id])?;
            upsert_source(&tx, source, &now)?;
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO passages
                       (item_id, ord, type, heading, text, passage_start, seconds, text_hash)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )?;
                for (ord, p) in passages.iter().enumerate() {
                    stmt.execute(params![
                        source.item_id,
                        ord as i64,
                        p.kind.as_str(),
                        p.heading,
                        p.text,
                        p.passage_start,
                        p.seconds,
                        text_hash(&source.title, &p.text),
                    ])?;
                }
            }
            tx.commit()
        });
        self.invalidate(project_id);
        result
    }

    /// Updates what is known about a source whose text didn't change.
    pub fn touch_source(&self, project_id: &str, source: &SourceRow) -> Result<(), String> {
        let handle = self.handle(project_id, true)?.ok_or_else(|| CLOSED.to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        handle.with_write(|conn| upsert_source(conn, source, &now).map(|_| ()))
    }

    pub fn remove_sources(&self, project_id: &str, item_ids: &[String]) -> Result<(), String> {
        if item_ids.is_empty() {
            return Ok(());
        }
        let handle = self.handle(project_id, true)?.ok_or_else(|| CLOSED.to_string())?;
        let result = handle.with_write(|conn| {
            let tx = conn.transaction()?;
            for id in item_ids {
                tx.execute("DELETE FROM passages WHERE item_id = ?1", params![id])?;
                tx.execute("DELETE FROM sources WHERE item_id = ?1", params![id])?;
            }
            tx.commit()
        });
        self.invalidate(project_id);
        result
    }

    /// Deletes vectors that no passage uses any more. Returns how many.
    pub fn prune_vectors(&self, project_id: &str) -> Result<usize, String> {
        let Some(handle) = self.handle(project_id, false)? else { return Ok(0) };
        let removed = handle.with_write(|conn| {
            conn.execute(
                "DELETE FROM vectors WHERE text_hash NOT IN (SELECT text_hash FROM passages)",
                [],
            )
        })?;
        if removed > 0 {
            self.invalidate(project_id);
        }
        Ok(removed)
    }

    // ---- removing files ----------------------------------------------------------------------

    pub fn delete_project(&self, project_id: &str) -> Result<(), String> {
        Self::check_id(project_id)?;
        let handle = lock(&self.handles).remove(project_id);
        if let Some(h) = handle {
            h.close();
        }
        self.invalidate(project_id);
        remove_index_files(&self.index_path(project_id));
        Ok(())
    }

    /// Deletes every index file. Connections are closed first.
    pub fn delete_all(&self) -> Result<(), String> {
        let handles: Vec<Arc<Handle>> = lock(&self.handles).drain().map(|(_, h)| h).collect();
        for h in handles {
            h.close();
        }
        lock(&self.vector_caches).clear();
        lock(&self.generations).values_mut().for_each(|g| *g += 1);
        let mut failed = false;
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if is_index_file(&path) && fs::remove_file(&path).is_err() {
                    failed = true;
                }
            }
        }
        if failed {
            return Err("Couldn't delete the search index. Close other windows and try again.".into());
        }
        Ok(())
    }

    pub fn disk_bytes(&self) -> u64 {
        let mut total = 0;
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                if is_index_file(&entry.path()) {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        total
    }

    // ---- counts ----------------------------------------------------------------------------

    pub fn counts(&self, project_id: Option<&str>, model: Option<&str>) -> Result<Counts, String> {
        let projects = match project_id {
            Some(id) => {
                Self::check_id(id)?;
                vec![id.to_string()]
            }
            None => self.list_projects(),
        };
        let mut total = Counts::default();
        for project in projects {
            let Some(handle) = self.handle(&project, false)? else { continue };
            let c = handle.with_read(|conn| {
                let sources: i64 =
                    conn.query_row("SELECT COUNT(*) FROM sources", [], |r| r.get(0))?;
                let passages: i64 =
                    conn.query_row("SELECT COUNT(*) FROM passages", [], |r| r.get(0))?;
                let embedded: i64 = match model {
                    Some(model) => conn.query_row(
                        "SELECT COUNT(*) FROM passages p WHERE EXISTS
                           (SELECT 1 FROM vectors v WHERE v.text_hash = p.text_hash AND v.model = ?1)",
                        params![model],
                        |r| r.get(0),
                    )?,
                    None => 0,
                };
                Ok(Counts {
                    sources_indexed: sources,
                    passages_total: passages,
                    passages_embedded: embedded,
                })
            })?;
            total.sources_indexed += c.sources_indexed;
            total.passages_total += c.passages_total;
            total.passages_embedded += c.passages_embedded;
        }
        Ok(total)
    }

    // ---- vectors ---------------------------------------------------------------------------

    /// Passages without a vector for `model`, the preferred project's first, one per distinct
    /// text in each project.
    pub fn embed_jobs(
        &self,
        model: &str,
        limit: usize,
        prefer_project_id: Option<&str>,
    ) -> Result<Vec<EmbedJobRow>, String> {
        let mut projects = self.list_projects();
        if let Some(preferred) = prefer_project_id {
            if let Some(pos) = projects.iter().position(|p| p == preferred) {
                let first = projects.remove(pos);
                projects.insert(0, first);
            }
        }
        let mut out: Vec<EmbedJobRow> = Vec::new();
        for project in projects {
            if out.len() >= limit {
                break;
            }
            let Some(handle) = self.handle(&project, false)? else { continue };
            let remaining = (limit - out.len()) as i64;
            let rows = handle.with_read(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT p.text_hash, s.title, p.text
                     FROM passages p JOIN sources s ON s.item_id = p.item_id
                     WHERE NOT EXISTS
                       (SELECT 1 FROM vectors v WHERE v.text_hash = p.text_hash AND v.model = ?1)
                     GROUP BY p.text_hash
                     ORDER BY MIN(p.id)
                     LIMIT ?2",
                )?;
                let rows = stmt.query_map(params![model, remaining], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        row.get::<_, String>(2)?,
                    ))
                })?;
                rows.collect::<rusqlite::Result<Vec<_>>>()
            })?;
            for (hash, title, text) in rows {
                out.push(EmbedJobRow {
                    project_id: project.clone(),
                    text_hash: hash,
                    input: embed_input(&title, &text),
                });
            }
        }
        Ok(out)
    }

    /// Stores vectors made by the webview. Every vector is checked first; nothing is stored if
    /// one is wrong. A vector is kept only while a passage in that project still has its hash.
    pub fn put_vectors(
        &self,
        model: &str,
        vectors: &[(String, String, Vec<f32>)],
    ) -> Result<usize, String> {
        if model.trim().is_empty() {
            return Err("The search model isn't named.".to_string());
        }
        for (project, hash, vector) in vectors {
            Self::check_id(project)?;
            if hash.is_empty() || hash.len() > 64 {
                return Err("A passage vector came without its id.".to_string());
            }
            if vector.len() != VECTOR_DIMS {
                return Err(format!(
                    "A passage vector has {} numbers; it needs {}.",
                    vector.len(),
                    VECTOR_DIMS
                ));
            }
            if vector.iter().any(|v| !v.is_finite()) {
                return Err("A passage vector has a number that isn't valid.".to_string());
            }
        }

        let mut by_project: HashMap<&str, Vec<(&str, &Vec<f32>)>> = HashMap::new();
        for (project, hash, vector) in vectors {
            by_project.entry(project.as_str()).or_default().push((hash.as_str(), vector));
        }
        let mut stored = 0;
        for (project, items) in by_project {
            let Some(handle) = self.handle(project, false)? else { continue };
            let count = handle.with_write(|conn| {
                let tx = conn.transaction()?;
                let mut count = 0;
                {
                    let mut stmt = tx.prepare(
                        "INSERT OR REPLACE INTO vectors (text_hash, model, vec)
                         SELECT ?1, ?2, ?3
                         WHERE EXISTS (SELECT 1 FROM passages WHERE text_hash = ?1)",
                    )?;
                    for (hash, vector) in &items {
                        count += stmt.execute(params![hash, model, vector_to_blob(vector)])?;
                    }
                }
                tx.commit()?;
                Ok(count)
            })?;
            stored += count;
            self.invalidate(project);
        }
        Ok(stored)
    }

    pub fn delete_vectors(&self) -> Result<(), String> {
        for project in self.list_projects() {
            let Some(handle) = self.handle(&project, false)? else { continue };
            handle.with_write(|conn| conn.execute("DELETE FROM vectors", []).map(|_| ()))?;
            self.invalidate(&project);
        }
        Ok(())
    }

    /// The project's vectors for `model`, loaded once and kept until something in the project
    /// changes. `None` when the project has no index.
    pub fn vector_cache(
        &self,
        project_id: &str,
        model: &str,
    ) -> Result<Option<Arc<VectorCache>>, String> {
        let generation = self.generation(project_id);
        if let Some((cached_generation, cache)) = lock(&self.vector_caches).get(project_id) {
            if *cached_generation == generation && cache.model == model {
                return Ok(Some(cache.clone()));
            }
        }
        let Some(handle) = self.handle(project_id, false)? else { return Ok(None) };
        let cache = handle.with_read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT p.id, p.type, v.vec FROM passages p
                 JOIN vectors v ON v.text_hash = p.text_hash AND v.model = ?1",
            )?;
            let rows = stmt.query_map(params![model], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Vec<u8>>(2)?))
            })?;
            let mut ids = Vec::new();
            let mut is_body = Vec::new();
            let mut data: Vec<f32> = Vec::new();
            for row in rows {
                let (id, kind, blob) = row?;
                let Some(vector) = blob_to_vector(&blob) else { continue };
                let Some(unit) = normalize(&vector) else { continue };
                ids.push(id);
                is_body.push(kind == "body");
                data.extend_from_slice(&unit);
            }
            Ok(VectorCache { model: model.to_string(), ids, is_body, data })
        })?;
        let cache = Arc::new(cache);
        lock(&self.vector_caches).insert(project_id.to_string(), (generation, cache.clone()));
        Ok(Some(cache))
    }
}

fn upsert_source(conn: &Connection, source: &SourceRow, now: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO sources
           (item_id, folder_id, title, kind, url, path, fingerprint, content_hash, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(item_id) DO UPDATE SET
           folder_id = excluded.folder_id, title = excluded.title, kind = excluded.kind,
           url = excluded.url, path = excluded.path, fingerprint = excluded.fingerprint,
           content_hash = excluded.content_hash, indexed_at = excluded.indexed_at",
        params![
            source.item_id,
            source.folder_id,
            source.title,
            source.kind,
            source.url,
            source.path,
            source.fingerprint,
            source.content_hash,
            now
        ],
    )
}

fn is_index_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".sqlite") || n.ends_with(".sqlite-wal") || n.ends_with(".sqlite-shm"))
}

fn remove_index_files(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        let _ = fs::remove_file(PathBuf::from(name));
    }
}

fn default_dir() -> PathBuf {
    #[cfg(test)]
    {
        std::env::temp_dir().join(format!("sourcefold-search-test-{}", std::process::id()))
    }
    #[cfg(not(test))]
    {
        crate::session::app_data_dir().join("search")
    }
}

/// The store the app uses: `<app data>/search`, or a temp folder under `cfg(test)`.
pub fn global() -> &'static SearchStore {
    static STORE: OnceLock<SearchStore> = OnceLock::new();
    STORE.get_or_init(|| SearchStore::new(default_dir()))
}

/// True when the project's file exists, without opening it.
pub fn index_exists(store: &SearchStore, project_id: &str) -> bool {
    is_valid_project_id(project_id) && store.index_path(project_id).exists()
}

/// Reads a single value; used by tests and status code that only need a flag.
pub fn meta_value(handle: &Handle, key: &str) -> Result<Option<String>, String> {
    handle.with_read(|conn| {
        conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0)).optional()
    })
}
