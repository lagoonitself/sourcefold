//! Signed in, the library lives in the web account and Google Drive. This keeps a copy of every
//! file on this computer, in the storage folder (by default `Documents/Sourcefold`), with the same
//! layout and content as Drive (docs/FILE-FORMAT.md).
//!
//! The web app lists every file with its path and a version (`GET /api/mirror`); files whose
//! version changed are downloaded again (`GET /api/items/:id/content`). Only files this module
//! wrote (tracked in `local_copy_files`) are ever moved or deleted.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::db::Database;
use crate::service::{is_safe_to_delete, remove_empty_parent_dirs, resolve_storage_dir};
use crate::session::{load_session, Session};

const SETTING_KEY: &str = "local_copy";
const CONCURRENCY: usize = 4;

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteFile {
    pub id: String,
    pub kind: String,
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct LocalCopyFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct LocalCopyReport {
    /// "done", "busy" (another run is going), "off" (turned off, offline or signed out).
    pub status: String,
    pub folder: String,
    pub total: usize,
    pub written: usize,
    pub moved: usize,
    pub removed: usize,
    pub failed: Vec<LocalCopyFailure>,
}

pub fn is_enabled(db: &Database) -> bool {
    !matches!(db.get_setting(SETTING_KEY), Ok(Some(v)) if v == "off")
}

pub fn set_enabled(db: &Database, enabled: bool) -> Result<(), String> {
    db.set_setting(SETTING_KEY, if enabled { "on" } else { "off" })
        .map_err(|e| e.to_string())
}

fn is_offline(db: &Database) -> bool {
    matches!(db.get_setting("offline_mode"), Ok(Some(v)) if v == "true")
}

/// Turns a manifest path into a path under `root`, refusing anything that could escape it.
pub fn local_path(root: &Path, rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\\') || rel.contains(':') {
        return None;
    }
    let rel_path = Path::new(rel);
    let mut out = root.to_path_buf();
    let mut parts = 0;
    for c in rel_path.components() {
        match c {
            Component::Normal(part) => {
                out.push(part);
                parts += 1;
            }
            _ => return None,
        }
    }
    // A file always sits inside at least a project folder.
    if parts < 2 {
        return None;
    }
    Some(out)
}

fn updated_at(version: &str) -> &str {
    version.split('|').next().unwrap_or(version)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}.sourcefold-tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn remove_tracked(root: &Path, rel: &str) {
    if let Some(path) = local_path(root, rel) {
        if path.is_file() && is_safe_to_delete(&path, root) {
            let _ = fs::remove_file(&path);
        }
        if let Some(parent) = path.parent() {
            remove_empty_parent_dirs(parent, root);
        }
    }
}

fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(String::from));
    match (status.as_u16(), message) {
        (401, _) => "Your session expired. Sign in again in Settings.".to_string(),
        (404, _) if body.trim_start().starts_with('<') => {
            "The web app doesn't have the local copy feature yet. Deploy the latest version."
                .to_string()
        }
        (_, Some(m)) => m,
        (code, None) => format!("The web app answered with an error ({}).", code),
    }
}

async fn fetch_manifest(client: &reqwest::Client, session: &Session) -> Result<Vec<RemoteFile>, String> {
    #[derive(Deserialize)]
    struct Data {
        files: Vec<RemoteFile>,
    }
    #[derive(Deserialize)]
    struct Envelope {
        data: Data,
    }
    let url = format!("{}/api/mirror", session.web_url.trim_end_matches('/'));
    let res = client
        .get(url)
        .bearer_auth(&session.token)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the web app: {}", e))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    serde_json::from_str::<Envelope>(&body)
        .map(|e| e.data.files)
        .map_err(|e| format!("The web app sent an unexpected answer: {}", e))
}

async fn fetch_content(client: &reqwest::Client, session: &Session, id: &str) -> Result<Vec<u8>, String> {
    let url = format!(
        "{}/api/items/{}/content",
        session.web_url.trim_end_matches('/'),
        id
    );
    let res = client
        .get(url)
        .bearer_auth(&session.token)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the web app: {}", e))?;
    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(api_error(status, &body));
    }
    res.bytes().await.map(|b| b.to_vec()).map_err(|e| e.to_string())
}

enum Plan {
    /// Same bytes, new place (images only; their content never changes).
    Move { from: String },
    Download { from: Option<String> },
}

/// What has to happen for each remote file, given what was written last time.
fn plan(
    root: &Path,
    remote: &[RemoteFile],
    tracked: &HashMap<String, (String, String)>,
) -> Vec<(RemoteFile, Plan)> {
    let mut out = Vec::new();
    for file in remote {
        let Some(target) = local_path(root, &file.path) else { continue };
        match tracked.get(&file.id) {
            Some((_, version)) if version == &file.version && target.is_file() => {}
            Some((path, version))
                if file.kind == "image"
                    && path != &file.path
                    && updated_at(version) == updated_at(&file.version)
                    && local_path(root, path).is_some_and(|p| p.is_file())
                    && !target.exists() =>
            {
                out.push((file.clone(), Plan::Move { from: path.clone() }));
            }
            Some((path, _)) => {
                let from = (path != &file.path).then(|| path.clone());
                out.push((file.clone(), Plan::Download { from }));
            }
            None => out.push((file.clone(), Plan::Download { from: None })),
        }
    }
    out
}

/// Brings the local copy up to date. Never runs twice at once; never deletes files it didn't write.
pub async fn sync(db: &Database) -> LocalCopyReport {
    let root = resolve_storage_dir(db);
    let mut report = LocalCopyReport {
        folder: root.to_string_lossy().to_string(),
        ..Default::default()
    };

    let session = match load_session() {
        Some(s) if is_enabled(db) && !is_offline(db) => s,
        _ => {
            report.status = "off".into();
            return report;
        }
    };
    if RUNNING.swap(true, Ordering::SeqCst) {
        report.status = "busy".into();
        return report;
    }
    struct Release;
    impl Drop for Release {
        fn drop(&mut self) {
            RUNNING.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release;

    let result = run(db, &root, &session, &mut report).await;
    if let Err(message) = result {
        report.failed.push(LocalCopyFailure { path: String::new(), message });
    }
    report.status = "done".into();
    report
}

async fn run(db: &Database, root: &Path, session: &Session, report: &mut LocalCopyReport) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let remote = fetch_manifest(&client, session).await?;
    report.total = remote.len();

    let tracked: HashMap<String, (String, String)> = db
        .local_copy_files()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, path, version)| (id, (path, version)))
        .collect();

    // Files of items that are gone (deleted, or no longer saved) go first, so a new file can take
    // their name.
    let remote_ids: HashSet<&str> = remote.iter().map(|f| f.id.as_str()).collect();
    for (id, (path, _)) in &tracked {
        if !remote_ids.contains(id.as_str()) {
            remove_tracked(root, path);
            let _ = db.remove_local_copy_file(id);
            report.removed += 1;
        }
    }

    let mut downloads = Vec::new();
    for (file, step) in plan(root, &remote, &tracked) {
        match step {
            Plan::Move { from } => {
                let (Some(src), Some(dst)) = (local_path(root, &from), local_path(root, &file.path)) else {
                    continue;
                };
                let moved = dst
                    .parent()
                    .map(fs::create_dir_all)
                    .transpose()
                    .and_then(|_| fs::rename(&src, &dst));
                match moved {
                    Ok(()) => {
                        if let Some(parent) = src.parent() {
                            remove_empty_parent_dirs(parent, root);
                        }
                        let _ = db.set_local_copy_file(&file.id, &file.path, &file.version);
                        report.moved += 1;
                    }
                    Err(_) => downloads.push((file, Some(from))),
                }
            }
            Plan::Download { from } => downloads.push((file, from)),
        }
    }

    for chunk in downloads.chunks(CONCURRENCY) {
        let mut set = tokio::task::JoinSet::new();
        for (i, (file, _)) in chunk.iter().enumerate() {
            let (client, session, id) = (client.clone(), session.clone(), file.id.clone());
            set.spawn(async move { (i, fetch_content(&client, &session, &id).await) });
        }
        let mut fetched: Vec<Result<Vec<u8>, String>> =
            (0..chunk.len()).map(|_| Err("Download stopped.".to_string())).collect();
        while let Some(joined) = set.join_next().await {
            if let Ok((i, result)) = joined {
                fetched[i] = result;
            }
        }
        for ((file, from), bytes) in chunk.iter().zip(fetched) {
            let bytes = match bytes {
                Ok(b) => b,
                Err(message) => {
                    report.failed.push(LocalCopyFailure { path: file.path.clone(), message });
                    continue;
                }
            };
            let Some(target) = local_path(root, &file.path) else { continue };
            // A rename that only changes letter case is the same file on Windows and macOS: never
            // delete the old path after writing the new one.
            let same_file = from
                .as_deref()
                .is_some_and(|f| f.eq_ignore_ascii_case(&file.path));
            if same_file {
                if let Some(old) = from.as_deref().and_then(|f| local_path(root, f)) {
                    let _ = fs::rename(&old, &target);
                }
            }
            if let Err(e) = write_atomic(&target, &bytes) {
                report.failed.push(LocalCopyFailure {
                    path: file.path.clone(),
                    message: format!("Couldn't write the file: {}", e),
                });
                continue;
            }
            if let (Some(old), false) = (from.as_deref(), same_file) {
                remove_tracked(root, old);
            }
            let _ = db.set_local_copy_file(&file.id, &file.path, &file.version);
            report.written += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("sf_local_copy_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn file(id: &str, kind: &str, path: &str, version: &str) -> RemoteFile {
        RemoteFile { id: id.into(), kind: kind.into(), path: path.into(), version: version.into() }
    }

    #[test]
    fn local_path_refuses_escapes() {
        let root = PathBuf::from("/tmp/sf");
        assert!(local_path(&root, "Cars/Engines/Turbo.md").is_some());
        assert!(local_path(&root, "../x/y.md").is_none());
        assert!(local_path(&root, "Cars/../../y.md").is_none());
        assert!(local_path(&root, "/etc/passwd").is_none());
        assert!(local_path(&root, "C:/Windows/x.md").is_none());
        assert!(local_path(&root, "Cars\\..\\x.md").is_none());
        assert!(local_path(&root, "loose.md").is_none());
        assert!(local_path(&root, "").is_none());
    }

    #[test]
    fn plan_skips_unchanged_downloads_changed_and_moves_images() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/Old")).unwrap();
        fs::write(root.join("Cars/Old/Same.md"), "x").unwrap();
        fs::write(root.join("Cars/Old/Pic.png"), "png").unwrap();

        let mut tracked = HashMap::new();
        tracked.insert("same".to_string(), ("Cars/Old/Same.md".to_string(), "t1|Cars/Old/Same.md".to_string()));
        tracked.insert("pic".to_string(), ("Cars/Old/Pic.png".to_string(), "t1|Cars/Old/Pic.png".to_string()));
        tracked.insert("renamed".to_string(), ("Cars/Old/A.md".to_string(), "t1|Cars/Old/A.md".to_string()));

        let remote = vec![
            file("same", "grokipedia", "Cars/Old/Same.md", "t1|Cars/Old/Same.md"),
            file("pic", "image", "Cars/New/Pic.png", "t1|Cars/New/Pic.png"),
            file("renamed", "substack", "Cars/Old/B.md", "t2|Cars/Old/B.md"),
            file("new", "note", "Cars/Old/N.md", "t1|Cars/Old/N.md"),
        ];
        let steps = plan(&root, &remote, &tracked);
        let summary: Vec<(String, String)> = steps
            .iter()
            .map(|(f, p)| {
                let what = match p {
                    Plan::Move { from } => format!("move from {}", from),
                    Plan::Download { from: Some(from) } => format!("download, drop {}", from),
                    Plan::Download { from: None } => "download".to_string(),
                };
                (f.id.clone(), what)
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("pic".to_string(), "move from Cars/Old/Pic.png".to_string()),
                ("renamed".to_string(), "download, drop Cars/Old/A.md".to_string()),
                ("new".to_string(), "download".to_string()),
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plan_downloads_again_when_the_file_was_deleted_by_hand() {
        let root = temp_root();
        let mut tracked = HashMap::new();
        tracked.insert("a".to_string(), ("Cars/G/A.md".to_string(), "t1|Cars/G/A.md".to_string()));
        let remote = vec![file("a", "grokipedia", "Cars/G/A.md", "t1|Cars/G/A.md")];
        assert_eq!(plan(&root, &remote, &tracked).len(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_tracked_deletes_the_file_and_empty_folders_only() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/G")).unwrap();
        fs::write(root.join("Cars/G/A.md"), "x").unwrap();
        fs::write(root.join("Cars/keep.txt"), "mine").unwrap();
        remove_tracked(&root, "Cars/G/A.md");
        assert!(!root.join("Cars/G").exists());
        assert!(root.join("Cars/keep.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_atomic_replaces_the_file() {
        let root = temp_root();
        let path = root.join("Cars/G/A.md");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "two");
        assert_eq!(fs::read_dir(root.join("Cars/G")).unwrap().count(), 1);
        let _ = fs::remove_dir_all(&root);
    }
}
