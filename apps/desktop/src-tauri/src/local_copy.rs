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
    /// Unique per file: the item id, or `<id>:docx` for its Word copy. Older web apps send none,
    /// and then the item id is the key.
    #[serde(default)]
    pub key: String,
    /// The item the file belongs to.
    pub id: String,
    pub kind: String,
    pub path: String,
    pub version: String,
    /// "file" (the item's own file) or "docx" (the Word copy of a text file).
    #[serde(default)]
    pub format: String,
}

impl RemoteFile {
    /// What the file is tracked by in `local_copy_files` (the table's `item_id` column).
    pub fn key(&self) -> &str {
        if self.key.is_empty() {
            &self.id
        } else {
            &self.key
        }
    }

    pub fn is_docx(&self) -> bool {
        self.format == "docx"
    }
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

fn remove_tracked(root: &Path, rel: &str, keep: &HashSet<PathBuf>) {
    if let Some(path) = local_path(root, rel) {
        if path.is_file() && is_safe_to_delete(&path, root) {
            let _ = fs::remove_file(&path);
        }
        if let Some(dir) = images_dir(&path) {
            clean_images_dir(&dir, root, &HashSet::new(), keep);
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

/// True for the web app's "its Google Doc isn't in Drive yet" answer, which is not a failure.
fn is_not_ready(status: reqwest::StatusCode, body: &str) -> bool {
    status.as_u16() == 404
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| v.pointer("/error/code").and_then(|c| c.as_str()).map(|c| c == "not_ready"))
            .unwrap_or(false)
}

/// The file's bytes. `Ok(None)` for a Word copy whose Google Doc isn't ready yet: skip it quietly
/// and try again next time.
async fn fetch_content(
    client: &reqwest::Client,
    session: &Session,
    file: &RemoteFile,
) -> Result<Option<Vec<u8>>, String> {
    let docx = file.is_docx();
    let url = format!(
        "{}/api/items/{}/content{}",
        session.web_url.trim_end_matches('/'),
        file.id,
        if docx { "?format=docx" } else { "" }
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
        if docx && is_not_ready(status, &body) {
            return Ok(None);
        }
        return Err(api_error(status, &body));
    }
    res.bytes().await.map(|b| Some(b.to_vec())).map_err(|e| e.to_string())
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
        match tracked.get(file.key()) {
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

/// Tracked files whose key the web app no longer lists: `(key, path)`.
fn stale(remote: &[RemoteFile], tracked: &HashMap<String, (String, String)>) -> Vec<(String, String)> {
    let keys: HashSet<&str> = remote.iter().map(|f| f.key()).collect();
    let mut out: Vec<(String, String)> = tracked
        .iter()
        .filter(|(key, _)| !keys.contains(key.as_str()))
        .map(|(key, (path, _))| (key.clone(), path.clone()))
        .collect();
    out.sort();
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
    // their name. A Word copy is tracked on its own, so it goes with its post the same way.
    // Files that belong to the library; image clean-up never deletes these.
    let keep: HashSet<PathBuf> = remote.iter().filter_map(|f| local_path(root, &f.path)).collect();
    for (key, path) in stale(&remote, &tracked) {
        remove_tracked(root, &path, &keep);
        let _ = db.remove_local_copy_file(&key);
        report.removed += 1;
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
                        let _ = db.set_local_copy_file(file.key(), &file.path, &file.version);
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
            let (client, session, file) = (client.clone(), session.clone(), file.clone());
            set.spawn(async move { (i, fetch_content(&client, &session, &file).await) });
        }
        let mut fetched: Vec<Result<Option<Vec<u8>>, String>> =
            (0..chunk.len()).map(|_| Err("Download stopped.".to_string())).collect();
        while let Some(joined) = set.join_next().await {
            if let Ok((i, result)) = joined {
                fetched[i] = result;
            }
        }
        for ((file, from), bytes) in chunk.iter().zip(fetched) {
            let bytes = match bytes {
                Ok(Some(b)) => b,
                // A Word copy whose Google Doc isn't made yet: whatever is on disk stays, and the
                // next run asks again.
                Ok(None) => continue,
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
            let old_path = from.as_deref().and_then(|f| local_path(root, f));
            if let Some(old) = &old_path {
                if same_file {
                    let _ = fs::rename(old, &target);
                }
                move_images_dir(old, &target);
            }
            let bytes = if file.kind == "image" || file.is_docx() {
                bytes
            } else {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                localize_images(&client, root, &target, &text, &keep).await.into_bytes()
            };
            if let Err(e) = write_atomic(&target, &bytes) {
                report.failed.push(LocalCopyFailure {
                    path: file.path.clone(),
                    message: format!("Couldn't write the file: {}", e),
                });
                continue;
            }
            if let (Some(old), false) = (from.as_deref(), same_file) {
                remove_tracked(root, old, &keep);
            }
            let _ = db.set_local_copy_file(file.key(), &file.path, &file.version);
            report.written += 1;
        }
    }
    Ok(())
}

// -----------------------------------------------------------------------------
// Post images: a copy of each image in `<file name>_files/` next to the post, with the post's
// links pointed at those copies so they show without a connection (docs/FILE-FORMAT.md).
// -----------------------------------------------------------------------------

const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 7] = ["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"];

fn image_link_regex() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"!\[(?:[^\]\\]|\\.)*\]\((https?://[^\s)]+)\)").unwrap())
}

/// The web image links in a Markdown body, each once, in order.
pub fn image_urls(markdown: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    image_link_regex()
        .captures_iter(markdown)
        .map(|c| c[1].to_string())
        .filter(|u| seen.insert(u.clone()))
        .collect()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn last_segment(path: &str) -> String {
    path.split('/')
        .rfind(|s| !s.is_empty())
        .map(percent_decode)
        .unwrap_or_default()
}

// Substack's CDN wraps the original: /image/fetch/<options>/https%3A%2F%2F…/name.jpeg
fn original_name(url: &str) -> String {
    let Ok(parsed) = reqwest::Url::parse(url) else { return String::new() };
    let segment = last_segment(parsed.path());
    if segment.starts_with("https://") || segment.starts_with("http://") {
        if let Ok(inner) = reqwest::Url::parse(&segment) {
            return last_segment(inner.path());
        }
    }
    segment
}

/// File names for a post's images, the same as `postImageFileNames` in packages/core.
pub fn image_file_names(urls: &[String]) -> Vec<String> {
    let mut used: HashSet<String> = HashSet::new();
    urls.iter()
        .enumerate()
        .map(|(index, url)| {
            let name = original_name(url);
            let (stem, ext) = match name.rfind('.') {
                Some(dot) if dot > 0 => (&name[..dot], name[dot + 1..].to_ascii_lowercase()),
                _ => (name.as_str(), String::new()),
            };
            let known = IMAGE_EXTENSIONS.contains(&ext.as_str());
            let mut base = crate::service::safe_name(if known { stem } else { &name });
            if name.is_empty() || base == "Untitled" {
                base = format!("image-{}", index + 1);
            }
            let extension = if known { ext } else { "jpg".to_string() };
            let mut candidate = format!("{}.{}", base, extension);
            let mut n = 2;
            while used.contains(&candidate.to_lowercase()) {
                candidate = format!("{} ({}).{}", base, n, extension);
                n += 1;
            }
            used.insert(candidate.to_lowercase());
            candidate
        })
        .collect()
}

/// `Cars/G/Title.md` → `Cars/G/Title_files`. None for files that aren't posts.
fn images_dir(md_path: &Path) -> Option<PathBuf> {
    let is_md = md_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md"));
    let stem = md_path.file_stem()?.to_str()?;
    is_md.then(|| md_path.with_file_name(format!("{}_files", stem)))
}

fn link_part(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '%' => out.push_str("%25"),
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '#' => out.push_str("%23"),
            '?' => out.push_str("%3F"),
            '<' => out.push_str("%3C"),
            '>' => out.push_str("%3E"),
            _ => out.push(c),
        }
    }
    out
}

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// Removes image files the post no longer uses, then the folder if it's empty. Never touches
/// folders, other kinds of files, or files that are themselves part of the library (`keep`), in
/// case a group happens to be called `<title>_files`.
fn clean_images_dir(dir: &Path, root: &Path, wanted: &HashSet<String>, keep: &HashSet<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if path.is_file()
            && is_image_file(&path)
            && !wanted.contains(&name)
            && !keep.contains(&path)
            && is_safe_to_delete(&path, root)
        {
            let _ = fs::remove_file(&path);
        }
    }
    let empty = fs::read_dir(dir).map(|mut e| e.next().is_none()).unwrap_or(false);
    if empty && is_safe_to_delete(dir, root) {
        let _ = fs::remove_dir(dir);
    }
}

// Only public web addresses: never a bare IP or a local name.
fn is_fetchable(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else { return false };
    let host = parsed.host_str().unwrap_or("");
    parsed.scheme() == "https"
        && host.contains('.')
        && !host.starts_with('[')
        && host.parse::<std::net::IpAddr>().is_err()
        && !host.ends_with(".local")
        && !host.ends_with(".internal")
}

async fn download_image(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    if !is_fetchable(url) {
        return None;
    }
    let res = client.get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let kind = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !kind.is_empty() && !kind.starts_with("image/") && !kind.starts_with("application/octet-stream") {
        return None;
    }
    if res.content_length().unwrap_or(0) as usize > MAX_IMAGE_BYTES {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    (!bytes.is_empty() && bytes.len() <= MAX_IMAGE_BYTES).then(|| bytes.to_vec())
}

/// Saves the post's images next to it (reusing ones already there) and returns the Markdown with
/// each saved image's link pointing at its copy. Images that can't be downloaded keep their web
/// link.
async fn localize_images(
    client: &reqwest::Client,
    root: &Path,
    md_path: &Path,
    markdown: &str,
    keep: &HashSet<PathBuf>,
) -> String {
    let Some(dir) = images_dir(md_path) else { return markdown.to_string() };
    let dir_name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let urls = image_urls(markdown);
    let names = image_file_names(&urls);

    let mut out = markdown.to_string();
    for (url, name) in urls.iter().zip(&names) {
        let dest = dir.join(name);
        let saved = dest.is_file()
            || match download_image(client, url).await {
                Some(bytes) => write_atomic(&dest, &bytes).is_ok(),
                None => false,
            };
        if saved {
            out = out.replace(
                &format!("]({})", url),
                &format!("]({}/{})", link_part(&dir_name), link_part(name)),
            );
        }
    }
    let wanted: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
    clean_images_dir(&dir, root, &wanted, keep);
    out
}

/// Moves a post's image folder along with the post (rename or move).
fn move_images_dir(old_md: &Path, new_md: &Path) {
    let (Some(old_dir), Some(new_dir)) = (images_dir(old_md), images_dir(new_md)) else { return };
    let case_only = old_dir.to_string_lossy().eq_ignore_ascii_case(&new_dir.to_string_lossy());
    if old_dir.is_dir() && (case_only || !new_dir.exists()) {
        if let Some(parent) = new_dir.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::rename(&old_dir, &new_dir);
    }
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
        RemoteFile {
            key: String::new(),
            id: id.into(),
            kind: kind.into(),
            path: path.into(),
            version: version.into(),
            format: String::new(),
        }
    }

    fn docx(id: &str, kind: &str, path: &str, version: &str) -> RemoteFile {
        RemoteFile {
            key: format!("{}:docx", id),
            format: "docx".into(),
            ..file(id, kind, path, version)
        }
    }

    fn tracked_of(rows: &[(&str, &str, &str)]) -> HashMap<String, (String, String)> {
        rows.iter()
            .map(|(k, p, v)| (k.to_string(), (p.to_string(), v.to_string())))
            .collect()
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
        remove_tracked(&root, "Cars/G/A.md", &HashSet::new());
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

    #[test]
    fn image_urls_finds_web_images_once_in_order() {
        let md = "![Chart \\[GDP\\]](https://cdn.example/a.png)\n\n[page](https://example.com/p)\n\n![](https://cdn.example/b.jpeg)\n\n![x](https://cdn.example/a.png)\n\n![l](Title_files/c.png)";
        assert_eq!(image_urls(md), vec!["https://cdn.example/a.png", "https://cdn.example/b.jpeg"]);
    }

    // Same cases as packages/core/src/post-images.test.ts: both apps name images alike.
    #[test]
    fn image_file_names_match_the_web_app() {
        let urls: Vec<String> = [
            "https://substack-post-media.s3.amazonaws.com/public/images/9a0a_1630x1630.jpeg",
            "https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd46a_1320x450.png",
            "https://a.example/x/chart.PNG",
            "https://b.example/y/chart.png",
            "https://c.example/",
            "https://d.example/photo?id=1",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            image_file_names(&urls),
            vec!["9a0a_1630x1630.jpeg", "d46a_1320x450.png", "chart.png", "chart (2).png", "image-5.jpg", "photo.jpg"]
        );
    }

    #[test]
    fn images_dir_sits_next_to_posts_only() {
        assert_eq!(
            images_dir(Path::new("/r/Cars/G/Why AI.md")),
            Some(PathBuf::from("/r/Cars/G/Why AI_files"))
        );
        assert_eq!(images_dir(Path::new("/r/Cars/G/photo.png")), None);
        assert_eq!(link_part("Why AI (2)_files"), "Why%20AI%20%282%29_files");
    }

    #[test]
    fn is_fetchable_refuses_private_addresses() {
        assert!(is_fetchable("https://substack-post-media.s3.amazonaws.com/a.png"));
        assert!(!is_fetchable("http://cdn.example/a.png"));
        assert!(!is_fetchable("https://169.254.169.254/latest"));
        assert!(!is_fetchable("https://[::1]/a.png"));
        assert!(!is_fetchable("https://localhost/a.png"));
        assert!(!is_fetchable("https://printer.local/a.png"));
    }

    #[tokio::test]
    async fn localize_images_points_links_at_saved_copies_and_cleans_up() {
        let root = temp_root();
        let md_path = root.join("Cars/G/Post.md");
        let dir = root.join("Cars/G/Post_files");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), "png").unwrap(); // already saved: no download needed
        fs::write(dir.join("old.png"), "png").unwrap(); // no longer used: removed
        fs::write(dir.join("notes.txt"), "mine").unwrap(); // not an image: kept
        let kept_library_file = dir.join("lib.png");
        fs::write(&kept_library_file, "png").unwrap(); // part of the library: kept

        let md = "Intro\n\n![A](https://cdn.example/a.png)\n\n*Cap*\n\n![](http://insecure.example/b.png)\n";
        let client = reqwest::Client::new();
        let keep: HashSet<PathBuf> = [kept_library_file.clone()].into_iter().collect();
        let out = localize_images(&client, &root, &md_path, md, &keep).await;

        assert_eq!(
            out,
            "Intro\n\n![A](Post_files/a.png)\n\n*Cap*\n\n![](http://insecure.example/b.png)\n"
        );
        assert!(dir.join("a.png").exists());
        assert!(!dir.join("old.png").exists());
        assert!(dir.join("notes.txt").exists());
        assert!(kept_library_file.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn images_follow_a_rename_and_go_with_a_delete() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/G/Old_files")).unwrap();
        fs::write(root.join("Cars/G/Old.md"), "x").unwrap();
        fs::write(root.join("Cars/G/Old_files/a.png"), "png").unwrap();

        move_images_dir(&root.join("Cars/G/Old.md"), &root.join("Cars/H/New.md"));
        assert!(root.join("Cars/H/New_files/a.png").exists());
        assert!(!root.join("Cars/G/Old_files").exists());

        fs::write(root.join("Cars/H/New.md"), "x").unwrap();
        remove_tracked(&root, "Cars/H/New.md", &HashSet::new());
        assert!(!root.join("Cars/H").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn manifest_entries_parse_with_or_without_keys() {
        let old: RemoteFile = serde_json::from_str(
            r#"{"id":"a","kind":"grokipedia","path":"Cars/G/A.md","version":"t|Cars/G/A.md"}"#,
        )
        .unwrap();
        assert_eq!(old.key(), "a");
        assert!(!old.is_docx());

        let new: RemoteFile = serde_json::from_str(
            r#"{"key":"a:docx","format":"docx","id":"a","kind":"grokipedia","path":"Cars/G/A.docx","version":"t|Cars/G/A.docx","extra":1}"#,
        )
        .unwrap();
        assert_eq!(new.key(), "a:docx");
        assert_eq!(new.id, "a");
        assert!(new.is_docx());
    }

    #[test]
    fn not_ready_is_only_the_404_with_that_code() {
        use reqwest::StatusCode;
        let body = r#"{"error":{"message":"Not in Drive yet.","code":"not_ready"}}"#;
        assert!(is_not_ready(StatusCode::NOT_FOUND, body));
        assert!(!is_not_ready(StatusCode::INTERNAL_SERVER_ERROR, body));
        assert!(!is_not_ready(StatusCode::NOT_FOUND, r#"{"error":{"message":"Item not found."}}"#));
        assert!(!is_not_ready(StatusCode::NOT_FOUND, "<html>404</html>"));
    }

    #[test]
    fn a_post_and_its_word_copy_are_tracked_separately() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/G")).unwrap();
        fs::write(root.join("Cars/G/A.md"), "x").unwrap();
        fs::write(root.join("Cars/G/A.docx"), "d").unwrap();
        // Each file has its own row, so the bare id and the `:docx` key never mix up.
        let tracked = tracked_of(&[
            ("a", "Cars/G/A.md", "t1|Cars/G/A.md"),
            ("a:docx", "Cars/G/A.docx", "s1|Cars/G/A.docx"),
        ]);

        let unchanged = vec![
            file("a", "grokipedia", "Cars/G/A.md", "t1|Cars/G/A.md"),
            docx("a", "grokipedia", "Cars/G/A.docx", "s1|Cars/G/A.docx"),
        ];
        assert!(plan(&root, &unchanged, &tracked).is_empty());

        // Pushed to Drive again: only the Word copy changes.
        let pushed = vec![
            file("a", "grokipedia", "Cars/G/A.md", "t1|Cars/G/A.md"),
            docx("a", "grokipedia", "Cars/G/A.docx", "s2|Cars/G/A.docx"),
        ];
        let steps = plan(&root, &pushed, &tracked);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].0.key(), "a:docx");
        assert!(matches!(&steps[0].1, Plan::Download { from: None }));

        // Renamed: both files download at the new path and drop the old one.
        let renamed = vec![
            file("a", "grokipedia", "Cars/G/B.md", "t2|Cars/G/B.md"),
            docx("a", "grokipedia", "Cars/G/B.docx", "s2|Cars/G/B.docx"),
        ];
        let froms: Vec<(String, Option<String>)> = plan(&root, &renamed, &tracked)
            .into_iter()
            .map(|(f, p)| match p {
                Plan::Download { from } => (f.key().to_string(), from),
                Plan::Move { from } => (f.key().to_string(), Some(from)),
            })
            .collect();
        assert_eq!(
            froms,
            vec![
                ("a".to_string(), Some("Cars/G/A.md".to_string())),
                ("a:docx".to_string(), Some("Cars/G/A.docx".to_string())),
            ]
        );

        // A Word copy that isn't on disk any more is fetched again.
        fs::remove_file(root.join("Cars/G/A.docx")).unwrap();
        let steps = plan(&root, &unchanged, &tracked);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].0.key(), "a:docx");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deleting_a_post_removes_its_word_copy_and_only_that() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/G")).unwrap();
        for name in ["A.md", "A.docx", "B.md", "B.docx", "mine.docx"] {
            fs::write(root.join("Cars/G").join(name), "x").unwrap();
        }
        let tracked = tracked_of(&[
            ("a", "Cars/G/A.md", "t|x"),
            ("a:docx", "Cars/G/A.docx", "s|x"),
            ("b", "Cars/G/B.md", "t|x"),
            ("b:docx", "Cars/G/B.docx", "s|x"),
        ]);

        // A is deleted. B stays, but its Word copy is no longer listed (e.g. its Doc is gone).
        let remote = vec![file("b", "note", "Cars/G/B.md", "t|x")];
        let gone = stale(&remote, &tracked);
        assert_eq!(
            gone,
            vec![
                ("a".to_string(), "Cars/G/A.md".to_string()),
                ("a:docx".to_string(), "Cars/G/A.docx".to_string()),
                ("b:docx".to_string(), "Cars/G/B.docx".to_string()),
            ]
        );
        for (_, path) in &gone {
            remove_tracked(&root, path, &HashSet::new());
        }
        assert!(!root.join("Cars/G/A.md").exists());
        assert!(!root.join("Cars/G/A.docx").exists());
        assert!(!root.join("Cars/G/B.docx").exists());
        assert!(root.join("Cars/G/B.md").exists());
        // Not written by the local copy, so never touched.
        assert!(root.join("Cars/G/mine.docx").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rows_written_before_keys_existed_still_match() {
        let root = temp_root();
        fs::create_dir_all(root.join("Cars/G")).unwrap();
        fs::write(root.join("Cars/G/A.md"), "x").unwrap();
        // Old rows are keyed by the bare item id, which is the key of the item's own file.
        let tracked = tracked_of(&[("a", "Cars/G/A.md", "t1|Cars/G/A.md")]);
        let remote = vec![
            file("a", "grokipedia", "Cars/G/A.md", "t1|Cars/G/A.md"),
            docx("a", "grokipedia", "Cars/G/A.docx", "s1|Cars/G/A.docx"),
        ];
        assert!(stale(&remote, &tracked).is_empty());
        let steps = plan(&root, &remote, &tracked);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].0.key(), "a:docx");
        let _ = fs::remove_dir_all(&root);
    }
}
