//! The indexer: brings each project's index file in line with the catalog.
//!
//! A source is read only when its fingerprint (size + modified time) changed, and re-chunked only
//! when the bytes did (`content_hash`) or its title did (the title is part of what is embedded).
//! Each source is written in one transaction, so a search sees either its old or its new passages.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::time::UNIX_EPOCH;

use super::catalog::{Catalog, CatalogEntry};
use super::chunker::chunk_markdown;
use super::hash::fnv1a64_hex;
use super::store::{SearchStore, SourceRow};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PassStats {
    pub reindexed: usize,
    pub unchanged: usize,
    pub removed: usize,
    pub failed: usize,
    /// The first thing that went wrong, for the status message.
    pub first_error: Option<String>,
}

impl PassStats {
    fn fail(&mut self, message: String) {
        self.failed += 1;
        if self.first_error.is_none() {
            self.first_error = Some(message);
        }
    }
}

/// File size and modified time, as one string.
pub fn fingerprint(path: &std::path::Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Some(format!("{}-{}", meta.len(), modified))
}

fn file_stem_title(entry: &CatalogEntry) -> String {
    entry
        .path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_string()
}

/// Brings one project's index in line with its entries.
pub fn sync_project(store: &SearchStore, project_id: &str, entries: &[&CatalogEntry]) -> PassStats {
    let mut stats = PassStats::default();
    let existing = match store.source_rows(project_id) {
        Ok(rows) => rows,
        Err(message) => {
            stats.fail(message);
            return stats;
        }
    };
    let mut changed = false;

    for entry in entries {
        let path_text = entry.path.to_string_lossy().to_string();
        let old = existing.get(&entry.item_id);
        let Some(fp) = fingerprint(&entry.path) else {
            // Not on disk (yet): keep whatever the index has.
            continue;
        };
        let title_changed = old.is_some_and(|o| !entry.title.is_empty() && o.title != entry.title);

        if let Some(old) = old {
            if old.fingerprint == fp && !title_changed {
                let moved = old.folder_id != entry.folder_id
                    || old.kind != entry.kind
                    || old.path != path_text;
                if moved {
                    let mut row = old.clone();
                    row.folder_id = entry.folder_id.clone();
                    row.kind = entry.kind.clone();
                    row.path = path_text;
                    match store.touch_source(project_id, &row) {
                        Ok(()) => {}
                        Err(message) => stats.fail(message),
                    }
                }
                stats.unchanged += 1;
                continue;
            }
        }

        let bytes = match fs::read(&entry.path) {
            Ok(bytes) => bytes,
            Err(e) => {
                stats.fail(format!("Search couldn't read {}: {}", path_text, e));
                continue;
            }
        };
        let content_hash = fnv1a64_hex(&bytes);
        let text = String::from_utf8_lossy(&bytes);
        let chunked = chunk_markdown(&text, &entry.kind);
        let title = if !entry.title.is_empty() {
            entry.title.clone()
        } else {
            chunked
                .front_title
                .clone()
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| file_stem_title(entry))
        };
        let row = SourceRow {
            item_id: entry.item_id.clone(),
            folder_id: entry.folder_id.clone(),
            title,
            kind: entry.kind.clone(),
            url: chunked.front_url.clone().or_else(|| entry.url.clone()),
            path: path_text,
            fingerprint: fp,
            content_hash: content_hash.clone(),
        };

        let same_text = old.is_some_and(|o| o.content_hash == content_hash && o.title == row.title);
        let result = if same_text {
            store.touch_source(project_id, &row)
        } else {
            changed = true;
            store.replace_source(project_id, &row, &chunked.passages)
        };
        match result {
            Ok(()) => {
                if same_text {
                    stats.unchanged += 1;
                } else {
                    stats.reindexed += 1;
                }
            }
            Err(message) => stats.fail(message),
        }
    }

    let wanted: HashSet<&str> = entries.iter().map(|e| e.item_id.as_str()).collect();
    let gone: Vec<String> =
        existing.keys().filter(|id| !wanted.contains(id.as_str())).cloned().collect();
    if !gone.is_empty() {
        match store.remove_sources(project_id, &gone) {
            Ok(()) => {
                stats.removed += gone.len();
                changed = true;
            }
            Err(message) => stats.fail(message),
        }
    }
    if changed {
        if let Err(message) = store.prune_vectors(project_id) {
            stats.fail(message);
        }
    }
    stats
}

/// One full pass over a catalog: every project with sources is synced, and the index files of
/// projects that have none any more are deleted.
pub fn sync_catalog(store: &SearchStore, catalog: &Catalog) -> PassStats {
    let mut total = PassStats::default();
    let mut by_project: HashMap<&str, Vec<&CatalogEntry>> = HashMap::new();
    for entry in &catalog.entries {
        by_project.entry(entry.project_id.as_str()).or_default().push(entry);
    }

    let mut projects: Vec<&str> = by_project.keys().copied().collect();
    projects.sort_unstable();
    for project in projects {
        let entries = &by_project[project];
        let stats = sync_project(store, project, entries);
        total.reindexed += stats.reindexed;
        total.unchanged += stats.unchanged;
        total.removed += stats.removed;
        total.failed += stats.failed;
        if total.first_error.is_none() {
            total.first_error = stats.first_error;
        }
    }

    for project in store.list_projects() {
        if !by_project.contains_key(project.as_str()) {
            if let Err(message) = store.delete_project(&project) {
                total.fail(message);
            }
        }
    }
    total
}
