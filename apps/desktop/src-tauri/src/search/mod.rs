//! Search inside sources, by keyword and by meaning (docs/dev/handoff-search.md).
//!
//! One SQLite index file per project (`store`), a background thread that keeps them in line with
//! the files on disk (`indexer`, `catalog`), and the query side (`query`). The meaning vectors
//! are made by the webview and handed over through `search_put_vectors`.

pub mod catalog;
pub mod chunker;
pub mod hash;
pub mod indexer;
pub mod query;
pub mod store;

use std::collections::HashMap;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use serde::Serialize;

use crate::db::Database;
use catalog::{Catalog, CatalogState};

/// The indexer looks again at least this often, in case a file changed behind the app's back.
const PASS_EVERY: Duration = Duration::from_secs(30);
/// How long the indexer waits after being woken before it looks.
const SETTLE: Duration = Duration::from_millis(400);
const PAUSED_KEY: &str = "search_paused";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// -----------------------------------------------------------------------------
// Waking the indexer
// -----------------------------------------------------------------------------

struct Wake {
    pending: Mutex<bool>,
    signal: Condvar,
}

fn wake() -> &'static Wake {
    static WAKE: OnceLock<Wake> = OnceLock::new();
    WAKE.get_or_init(|| Wake { pending: Mutex::new(false), signal: Condvar::new() })
}

/// Asks the indexer to look again now. Does nothing useful (and nothing harmful) in a process
/// where the indexer isn't running, such as the native-host process or a test.
pub fn notify() {
    let w = wake();
    *lock(&w.pending) = true;
    w.signal.notify_all();
}

/// Waits for a notify or the timeout; true when notified.
fn wait_for_wake(timeout: Duration) -> bool {
    let w = wake();
    let mut pending = lock(&w.pending);
    if !*pending {
        let (guard, _) = w
            .signal
            .wait_timeout_while(pending, timeout, |p| !*p)
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending = guard;
    }
    std::mem::replace(&mut *pending, false)
}

// -----------------------------------------------------------------------------
// Shared state (what `search_status` reports)
// -----------------------------------------------------------------------------

struct Shared {
    running: bool,
    indexing: bool,
    error: Option<String>,
    catalog_state: CatalogState,
    /// Searchable sources per project, from the last catalog.
    sources: HashMap<String, usize>,
}

fn shared() -> &'static Mutex<Shared> {
    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
    SHARED.get_or_init(|| {
        Mutex::new(Shared {
            running: false,
            indexing: false,
            error: None,
            catalog_state: CatalogState::Ready,
            sources: HashMap::new(),
        })
    })
}

/// Only one pass runs at a time, whoever asks.
fn pass_lock() -> &'static Mutex<()> {
    static PASS: OnceLock<Mutex<()>> = OnceLock::new();
    PASS.get_or_init(|| Mutex::new(()))
}

pub fn is_paused(db: &Database) -> bool {
    matches!(db.get_setting(PAUSED_KEY), Ok(Some(v)) if v == "true")
}

pub fn set_paused(db: &Database, paused: bool) -> Result<(), String> {
    db.set_setting(PAUSED_KEY, if paused { "true" } else { "false" }).map_err(|e| e.to_string())?;
    if !paused {
        notify();
    }
    Ok(())
}

/// One pass: build the catalog, sync every project. Skipped when paused or when a pass is already
/// running (it will see the same files).
pub fn run_pass(db: &Database) {
    if is_paused(db) {
        return;
    }
    let Ok(_pass) = pass_lock().try_lock() else { return };
    lock(shared()).indexing = true;

    let outcome = catalog::build(db).map(|catalog| {
        let stats = apply_catalog(store::global(), &catalog);
        (catalog, stats)
    });

    let mut state = lock(shared());
    state.indexing = false;
    match outcome {
        Ok((catalog, stats)) => {
            state.catalog_state = catalog.state;
            state.sources = catalog.counts();
            state.error = if stats.failed > 0 { stats.first_error } else { None };
        }
        Err(message) => {
            state.error = Some(format!("Search couldn't list your sources: {}", message));
        }
    }
}

/// Syncs the index files with a catalog. Index files are only touched when the catalog is
/// complete; a catalog that says there is nothing to read leaves them alone.
fn apply_catalog(store: &store::SearchStore, catalog: &Catalog) -> indexer::PassStats {
    match catalog.state {
        CatalogState::Ready => indexer::sync_catalog(store, catalog),
        _ => indexer::PassStats::default(),
    }
}

/// Starts the background indexer. Call once, from the app's `setup` (never from the native-host
/// process). Calling it again does nothing.
pub fn start(db: Database) {
    {
        let mut state = lock(shared());
        if state.running {
            return;
        }
        state.running = true;
        state.indexing = !is_paused(&db);
    }
    let spawned = std::thread::Builder::new().name("sourcefold-search-indexer".into()).spawn(move || {
        loop {
            run_pass(&db);
            if wait_for_wake(PASS_EVERY) {
                // A save usually touches the database, then the file, then the database again;
                // let it finish, and fold a burst of saves into one pass.
                std::thread::sleep(SETTLE);
            }
        }
    });
    if spawned.is_err() {
        let mut state = lock(shared());
        state.running = false;
        state.indexing = false;
        state.error = Some("Search couldn't start its indexer.".to_string());
    }
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SearchStatus {
    /// "idle", "indexing", "paused", "needs_local_copy", "needs_web_update" or "error".
    pub state: &'static str,
    pub message: Option<String>,
    pub sources_total: i64,
    pub sources_indexed: i64,
    pub passages_total: i64,
    pub passages_embedded: i64,
    pub disk_bytes: u64,
}

pub fn status(
    db: &Database,
    store: &store::SearchStore,
    project_id: Option<&str>,
    model: Option<&str>,
) -> Result<SearchStatus, String> {
    let counts = store.counts(project_id, model.filter(|m| !m.is_empty()))?;
    let (indexing, error, catalog_state, sources_total) = {
        let state = lock(shared());
        let total: usize = match project_id {
            Some(id) => state.sources.get(id).copied().unwrap_or(0),
            None => state.sources.values().sum(),
        };
        (state.indexing, state.error.clone(), state.catalog_state, total as i64)
    };

    let (state, message) = if is_paused(db) {
        ("paused", None)
    } else {
        match catalog_state {
            CatalogState::NeedsLocalCopy => (
                "needs_local_copy",
                Some("Turn on Local copy in Settings to search inside sources.".to_string()),
            ),
            CatalogState::NeedsWebUpdate => (
                "needs_web_update",
                Some("Update the web app to search inside sources.".to_string()),
            ),
            _ if error.is_some() => ("error", error),
            _ if indexing => ("indexing", None),
            _ => ("idle", None),
        }
    };

    Ok(SearchStatus {
        state,
        message,
        sources_total,
        sources_indexed: counts.sources_indexed,
        passages_total: counts.passages_total,
        passages_embedded: counts.passages_embedded,
        disk_bytes: store.disk_bytes(),
    })
}

#[cfg(test)]
mod tests;
