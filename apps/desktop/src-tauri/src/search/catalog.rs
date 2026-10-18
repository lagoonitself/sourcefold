//! Which files belong to which project (docs/handoff-search.md, "Catalog").
//!
//! Offline, the catalog comes from the `items` and `folders` tables: the project of an item is the
//! top-level ancestor of its group, and an item with no group goes to `unsorted`. Signed in, it
//! comes from `local_copy_files`, which the web app's file list fills in with the project ids.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::db::Database;
use crate::local_copy;
use crate::service::{resolve_storage_dir, safe_storage_path};

/// Project id for sources that sit in no group.
pub const UNSORTED: &str = "unsorted";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogEntry {
    pub item_id: String,
    pub project_id: String,
    pub folder_id: String,
    /// May be empty (signed in, older web app); the indexer then uses the file's own title.
    pub title: String,
    pub kind: String,
    pub url: Option<String>,
    pub path: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogState {
    /// The entries are the complete list of searchable files.
    Ready,
    /// Signed in with Local copy off: there are no files to read.
    NeedsLocalCopy,
    /// Signed in, but the web app's file list carries no project ids.
    NeedsWebUpdate,
    /// Signed in with Local copy on, but the first local copy pass hasn't described the files yet.
    Waiting,
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub state: CatalogState,
    pub entries: Vec<CatalogEntry>,
}

impl Catalog {
    fn with_state(state: CatalogState) -> Self {
        Self { state, entries: Vec::new() }
    }

    /// Searchable sources per project.
    pub fn counts(&self) -> HashMap<String, usize> {
        let mut out: HashMap<String, usize> = HashMap::new();
        for entry in &self.entries {
            *out.entry(entry.project_id.clone()).or_insert(0) += 1;
        }
        out
    }
}

enum Lookup {
    Project(String),
    Unsorted,
    Deleted,
}

/// The top-level ancestor of a group. A group that isn't in the table at all is "no group"; one
/// that sits under a deleted folder is gone with it.
fn project_of(folder_id: &str, folders: &HashMap<String, (Option<String>, bool)>) -> Lookup {
    let mut current = folder_id.to_string();
    let mut visited: HashSet<String> = HashSet::new();
    loop {
        let Some((parent, deleted)) = folders.get(&current) else {
            return if visited.is_empty() { Lookup::Unsorted } else { Lookup::Project(current) };
        };
        if *deleted {
            return Lookup::Deleted;
        }
        if !visited.insert(current.clone()) {
            // A loop in the table: treat the repeated folder as the top.
            return Lookup::Project(current);
        }
        match parent {
            Some(parent_id) if !parent_id.is_empty() => {
                if !folders.contains_key(parent_id) {
                    // The parent is missing; this folder is as high as the table goes.
                    return Lookup::Project(current);
                }
                current = parent_id.clone();
            }
            _ => return Lookup::Project(current),
        }
    }
}

fn is_text_path(path: &str) -> bool {
    !path.to_ascii_lowercase().ends_with(".docx")
}

/// The catalog for offline mode. `root` is the storage folder.
pub fn build_offline(db: &Database, root: &Path) -> Result<Catalog, String> {
    let folder_rows = db.search_folder_rows().map_err(|e| e.to_string())?;
    let folders: HashMap<String, (Option<String>, bool)> = folder_rows
        .into_iter()
        .map(|(id, parent, deleted_at)| (id, (parent, deleted_at.is_some())))
        .collect();
    let items = db.search_item_rows().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for (id, folder_id, kind, title, url, storage_path) in items {
        if !is_text_path(&storage_path) {
            continue;
        }
        let project_id = match project_of(&folder_id, &folders) {
            Lookup::Project(id) => id,
            Lookup::Unsorted => UNSORTED.to_string(),
            Lookup::Deleted => continue,
        };
        let Some(path) = safe_storage_path(root, &storage_path) else { continue };
        entries.push(CatalogEntry {
            item_id: id,
            project_id,
            folder_id,
            title,
            kind,
            url,
            path,
        });
    }
    Ok(Catalog { state: CatalogState::Ready, entries })
}

/// The catalog for a signed-in account, from the files the local copy wrote.
pub fn build_signed_in(db: &Database, root: &Path) -> Result<Catalog, String> {
    if !local_copy::is_enabled(db) {
        return Ok(Catalog::with_state(CatalogState::NeedsLocalCopy));
    }
    let (with_project, without_project, undescribed) =
        db.search_local_copy_counts().map_err(|e| e.to_string())?;
    if with_project == 0 && without_project > 0 {
        return Ok(Catalog::with_state(CatalogState::NeedsWebUpdate));
    }
    if with_project == 0 && undescribed > 0 {
        return Ok(Catalog::with_state(CatalogState::Waiting));
    }
    let rows = db.search_local_copy_rows().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for (key, path, project_id, folder_id, title, kind) in rows {
        let Some(project_id) = project_id.filter(|p| !p.is_empty()) else { continue };
        if key.ends_with(":docx") || !is_text_path(&path) {
            continue;
        }
        let Some(full) = local_copy::local_path(root, &path) else { continue };
        entries.push(CatalogEntry {
            item_id: key,
            project_id,
            folder_id: folder_id.unwrap_or_default(),
            title: title.unwrap_or_default(),
            kind,
            url: None,
            path: full,
        });
    }
    Ok(Catalog { state: CatalogState::Ready, entries })
}

/// Offline when nobody is signed in; otherwise the signed-in local copy.
pub fn build(db: &Database) -> Result<Catalog, String> {
    let root = resolve_storage_dir(db);
    if crate::session::load_session().is_some() {
        build_signed_in(db, &root)
    } else {
        build_offline(db, &root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(rows: &[(&str, Option<&str>, bool)]) -> HashMap<String, (Option<String>, bool)> {
        rows.iter()
            .map(|(id, parent, deleted)| (id.to_string(), (parent.map(String::from), *deleted)))
            .collect()
    }

    fn id_of(lookup: Lookup) -> String {
        match lookup {
            Lookup::Project(id) => id,
            Lookup::Unsorted => "<unsorted>".into(),
            Lookup::Deleted => "<deleted>".into(),
        }
    }

    #[test]
    fn the_project_is_the_top_level_ancestor() {
        let folders = table(&[
            ("inbox", None, false),
            ("general", Some("inbox"), false),
            ("proj", None, false),
            ("group", Some("proj"), false),
            ("sub", Some("group"), false),
            ("gone", None, true),
            ("under-gone", Some("gone"), false),
        ]);
        assert_eq!(id_of(project_of("general", &folders)), "inbox");
        assert_eq!(id_of(project_of("group", &folders)), "proj");
        assert_eq!(id_of(project_of("sub", &folders)), "proj");
        assert_eq!(id_of(project_of("proj", &folders)), "proj");
        assert_eq!(id_of(project_of("nope", &folders)), "<unsorted>");
        assert_eq!(id_of(project_of("", &folders)), "<unsorted>");
        assert_eq!(id_of(project_of("under-gone", &folders)), "<deleted>");
    }

    #[test]
    fn a_loop_in_the_folder_table_ends() {
        let folders = table(&[("a", Some("b"), false), ("b", Some("a"), false)]);
        let id = id_of(project_of("a", &folders));
        assert!(id == "a" || id == "b");
    }
}
