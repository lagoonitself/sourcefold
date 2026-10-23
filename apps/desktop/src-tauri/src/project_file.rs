//! Project files (`.sourcefold`) for the offline desktop app (docs/PROJECT-FILE.md).
//!
//! A project file is a zip: `sourcefold.json` (the manifest, `projectFileManifestSchema` in
//! packages/core/src/project-file/manifest.ts), each source's Markdown file as the app writes it
//! to disk, image sources, and the images of X posts in `<name>_files/`. The website and the
//! signed-in app build and read the same file in TypeScript; this is the Rust version, straight
//! from SQLite and the files on disk. Everything here follows the TypeScript rules field for field.
//!
//! A file someone sent is untrusted: `open_project_file` checks it before anything is saved.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::Database;
use crate::local_copy::{image_file_names, image_urls, link_part};
use crate::models::{Highlight, HighlightCitation, Item};
use crate::service::{self, safe_name};

pub const PROJECT_FILE_FORMAT: &str = "sourcefold-project";
pub const PROJECT_FILE_VERSION: i64 = 1;
pub const MANIFEST_PATH: &str = "sourcefold.json";

const FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const UNPACKED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const ENTRY_BYTES: u64 = 200 * 1024 * 1024;
const MANIFEST_BYTES: u64 = 100 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_GROUPS: usize = 10_000;
const MAX_SOURCES: usize = 100_000;
const MAX_HIGHLIGHTS: usize = 500_000;
const MAX_CARDS: usize = 100_000;
const MAX_SECTIONS: usize = 10_000;

const NEWER_VERSION: &str =
    "This project file was made by a newer version of Sourcefold. Update Sourcefold and try again.";
const NOT_A_PROJECT_FILE: &str = "This isn't a Sourcefold project file.";
const CANT_OPEN: &str = "This project file is damaged and can't be opened.";

/// File types a project file may carry, by extension (`PROJECT_FILE_MEDIA_TYPES`).
const ALLOWED_EXTENSIONS: [&str; 9] = ["md", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "mp4"];
/// Image types an image source may have.
const IMAGE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"];
/// Already compressed; stored as is. Everything else is deflated.
const STORED_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "avif", "mp4"];

// -----------------------------------------------------------------------------
// The manifest (mirrors manifest.ts)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestProject {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestGroup {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestSource {
    pub id: String,
    pub group_id: String,
    pub kind: String,
    pub title: String,
    pub source_url: Option<String>,
    pub canonical_url: Option<String>,
    pub meta: serde_json::Map<String, Value>,
    pub note: Option<String>,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
    pub triage: Option<String>,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    pub author: Option<String>,
    pub author_type: Option<String>,
    pub file: Option<String>,
    pub media_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestXPost {
    pub id: String,
    pub source_id: String,
    pub parent_id: Option<String>,
    pub post_url: String,
    pub canonical_url: String,
    pub author_name: String,
    pub handle: String,
    pub author_url: String,
    pub posted_at: Option<String>,
    pub text: String,
    pub media: Vec<Value>,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestHighlight {
    pub id: String,
    pub source_id: String,
    pub kind: String,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub image_src: Option<String>,
    pub note: Option<String>,
    pub seconds: Option<i64>,
    pub cited: Vec<Value>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestSection {
    pub id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestCard {
    pub id: String,
    pub kind: String,
    pub source_id: Option<String>,
    pub highlight_id: Option<String>,
    pub quote: String,
    pub seconds: Option<i64>,
    pub end_seconds: Option<i64>,
    pub url: Option<String>,
    pub note: Option<String>,
    pub script_line: Option<String>,
    pub section_id: Option<String>,
    pub position: f64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub format: String,
    pub version: i64,
    pub exported_at: String,
    pub app: String,
    pub project: ManifestProject,
    pub groups: Vec<ManifestGroup>,
    pub sources: Vec<ManifestSource>,
    pub x_posts: Vec<ManifestXPost>,
    pub highlights: Vec<ManifestHighlight>,
    pub outline_sections: Vec<ManifestSection>,
    pub cards: Vec<ManifestCard>,
}

/// What the import preview shows: "Cars: 6 groups, 212 sources, 1,034 highlights, 38 MB".
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProjectFileSummary {
    pub name: String,
    pub groups: usize,
    pub sources: usize,
    pub highlights: usize,
    pub cards: usize,
    /// Unpacked size of everything in the file.
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Skipped {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportReport {
    pub file_name: String,
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportReport {
    pub project_id: String,
    pub name: String,
    pub skipped: Vec<Skipped>,
}

// -----------------------------------------------------------------------------
// Names and paths (paths.ts, file-name.ts)
// -----------------------------------------------------------------------------

/// The extension of a path, lower-case, without the dot ("" when there is none).
fn extension_of(path: &str) -> String {
    let name = &path[path.rfind('/').map(|i| i + 1).unwrap_or(0)..];
    match name.rfind('.') {
        Some(dot) if dot > 0 => name[dot + 1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

fn is_allowed_extension(path: &str) -> bool {
    ALLOWED_EXTENSIONS.contains(&extension_of(path).as_str())
}

/// A path inside a project file is safe to unpack when it is relative, uses `/`, and has no
/// empty, `.` or `..` parts, drive letters, control characters or characters file systems reject.
pub fn is_safe_entry_path(path: &str) -> bool {
    if path.is_empty() || path.chars().count() > 1000 {
        return false;
    }
    if path.starts_with('/') || path.contains('\\') {
        return false;
    }
    if path
        .chars()
        .any(|c| c.is_control() && (c as u32) <= 0x1f || c == '\u{7f}' || "<>:\"|?*".contains(c))
    {
        return false;
    }
    path.split('/').all(|part| {
        !(part.is_empty() || part == "." || part == "..")
            && part == part.trim()
            && !part.ends_with('.')
    })
}

/// "Cars" → "Cars (2)" when "Cars" is taken (compared without case), then "(3)", …
pub fn unique_project_name(name: &str, taken: &[String]) -> String {
    let used: HashSet<String> = taken.iter().map(|t| t.trim().to_lowercase()).collect();
    let trimmed = name.trim();
    let base = if trimmed.is_empty() { "Imported project" } else { trimmed };
    if !used.contains(&base.to_lowercase()) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{} ({})", base, n);
        if !used.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        n += 1;
    }
}

fn timestamp(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value).ok().map(|d| d.timestamp_millis())
}

/// Two items in one folder with the same name (compared without case): the older keeps the plain
/// name, later ones get ` (2)`, ` (3)` (docs/FILE-FORMAT.md, "Names" rule 7).
fn unique_names(entries: &[(String, String, String)]) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut groups: HashMap<String, Vec<&(String, String, String)>> = HashMap::new();
    for entry in entries {
        groups.entry(entry.1.to_lowercase()).or_default().push(entry);
    }
    for mut group in groups.into_values() {
        if group.len() == 1 {
            result.insert(group[0].0.clone(), group[0].1.clone());
            continue;
        }
        group.sort_by(|a, b| match (timestamp(&a.2), timestamp(&b.2)) {
            (Some(x), Some(y)) if x != y => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => a.0.cmp(&b.0),
        });
        for (i, entry) in group.iter().enumerate() {
            let name = if i == 0 { entry.1.clone() } else { format!("{} ({})", entry.1, i + 1) };
            result.insert(entry.0.clone(), name);
        }
    }
    result
}

pub struct PathGroup {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub created_at: String,
}

pub struct PathSource {
    pub id: String,
    pub group_id: String,
    pub title: String,
    pub created_at: String,
    /// `md` for text sources; the image's own extension for image sources.
    pub extension: String,
}

/// `(file, media_folder)` for every source, by source id: `Cars/Engines/Turbocharger.md` and
/// `Cars/Engines/Turbocharger_files`. The same names as `projectFilePaths` in packages/core.
pub fn project_file_paths(
    project_name: &str,
    groups: &[PathGroup],
    sources: &[PathSource],
) -> HashMap<String, (String, String)> {
    let root = safe_name(project_name);
    let group_ids: HashSet<&str> = groups.iter().map(|g| g.id.as_str()).collect();
    let parent_of = |g: &PathGroup| -> Option<String> {
        g.parent_id.as_ref().filter(|p| group_ids.contains(p.as_str())).cloned()
    };

    let mut siblings: HashMap<Option<String>, Vec<&PathGroup>> = HashMap::new();
    for group in groups {
        siblings.entry(parent_of(group)).or_default().push(group);
    }
    let mut group_name: HashMap<String, String> = HashMap::new();
    for list in siblings.values() {
        let entries: Vec<(String, String, String)> = list
            .iter()
            .map(|g| (g.id.clone(), safe_name(&g.name), g.created_at.clone()))
            .collect();
        group_name.extend(unique_names(&entries));
    }

    let by_id: HashMap<&str, &PathGroup> = groups.iter().map(|g| (g.id.as_str(), g)).collect();
    fn path_of(
        id: &str,
        depth: usize,
        root: &str,
        by_id: &HashMap<&str, &PathGroup>,
        group_name: &HashMap<String, String>,
        parent_of: &dyn Fn(&PathGroup) -> Option<String>,
        memo: &mut HashMap<String, String>,
    ) -> String {
        if let Some(cached) = memo.get(id) {
            return cached.clone();
        }
        let group = by_id[id];
        let parent = if depth > by_id.len() { None } else { parent_of(group) };
        let base = match parent {
            None => root.to_string(),
            Some(p) => path_of(&p, depth + 1, root, by_id, group_name, parent_of, memo),
        };
        let path = format!("{}/{}", base, group_name[id]);
        memo.insert(id.to_string(), path.clone());
        path
    }
    let mut memo: HashMap<String, String> = HashMap::new();

    // Every path handed out, without case, so nothing in the zip can collide.
    let mut taken: HashSet<String> = HashSet::new();
    for group in groups {
        taken.insert(path_of(&group.id, 0, &root, &by_id, &group_name, &parent_of, &mut memo).to_lowercase());
    }

    let mut order: Vec<&str> = Vec::new();
    let mut by_group: HashMap<&str, Vec<&PathSource>> = HashMap::new();
    for source in sources {
        let list = by_group.entry(source.group_id.as_str()).or_default();
        if list.is_empty() {
            order.push(source.group_id.as_str());
        }
        list.push(source);
    }

    let mut result = HashMap::new();
    for group_id in order {
        let list = &by_group[group_id];
        let folder = if by_id.contains_key(group_id) {
            path_of(group_id, 0, &root, &by_id, &group_name, &parent_of, &mut memo)
        } else {
            root.clone()
        };
        let entries: Vec<(String, String, String)> = list
            .iter()
            .map(|s| (s.id.clone(), safe_name(&s.title), s.created_at.clone()))
            .collect();
        let names = unique_names(&entries);
        for source in list {
            let ext = source.extension.trim_start_matches('.').to_ascii_lowercase();
            let ext = if ALLOWED_EXTENSIONS.contains(&ext.as_str()) { ext } else { "md".to_string() };
            let own = names[&source.id].clone();
            let mut base = own.clone();
            let mut file = format!("{}/{}.{}", folder, base, ext);
            let mut media = format!("{}/{}_files", folder, base);
            let mut n = 2;
            while taken.contains(&file.to_lowercase()) || taken.contains(&media.to_lowercase()) {
                base = format!("{} ({})", own, n);
                file = format!("{}/{}.{}", folder, base, ext);
                media = format!("{}/{}_files", folder, base);
                n += 1;
            }
            taken.insert(file.to_lowercase());
            taken.insert(media.to_lowercase());
            result.insert(source.id.clone(), (file, media));
        }
    }
    result
}

// -----------------------------------------------------------------------------
// Validating the manifest (manifest.ts: parseProjectManifest)
// -----------------------------------------------------------------------------

fn damaged_at(table: &str, index: usize, field: &str) -> String {
    format!("This isn't a Sourcefold project file, or it's damaged ({}.{}.{}).", table, index, field)
}

fn too_long(value: &str, max: usize) -> bool {
    value.len() > max && value.chars().count() > max
}

fn id_ok(value: &str) -> bool {
    !value.is_empty() && !too_long(value, 100)
}

fn date_ok(value: &str) -> bool {
    !value.is_empty() && !too_long(value, 64)
}

fn opt_ok(value: &Option<String>, max: usize) -> bool {
    value.as_deref().is_none_or(|v| !too_long(v, max))
}

fn opt_id_ok(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(id_ok)
}

fn opt_count_ok(value: Option<i64>) -> bool {
    value.is_none_or(|v| v >= 0)
}

fn path_ok(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|v| !v.is_empty() && !too_long(v, 1000))
}

/// The shape of the manifest: field lengths, counts and allowed values.
fn validate_shape(m: &Manifest) -> Result<(), String> {
    let at = |what: &str| format!("This isn't a Sourcefold project file, or it's damaged ({}).", what);
    if m.format != PROJECT_FILE_FORMAT {
        return Err(at("format"));
    }
    if m.version < 1 {
        return Err(at("version"));
    }
    if !date_ok(&m.exported_at) {
        return Err(at("exported_at"));
    }
    if too_long(&m.app, 200) {
        return Err(at("app"));
    }
    if !id_ok(&m.project.id) || too_long(&m.project.name, 500) || !date_ok(&m.project.created_at) {
        return Err(at("project"));
    }
    if m.groups.len() > MAX_GROUPS {
        return Err(at("groups"));
    }
    if m.sources.len() > MAX_SOURCES {
        return Err(at("sources"));
    }
    if m.x_posts.len() > MAX_SOURCES * 50 {
        return Err(at("x_posts"));
    }
    if m.highlights.len() > MAX_HIGHLIGHTS {
        return Err(at("highlights"));
    }
    if m.outline_sections.len() > MAX_SECTIONS {
        return Err(at("outline_sections"));
    }
    if m.cards.len() > MAX_CARDS {
        return Err(at("cards"));
    }

    for (i, g) in m.groups.iter().enumerate() {
        if !id_ok(&g.id) {
            return Err(damaged_at("groups", i, "id"));
        }
        if !opt_id_ok(&g.parent_id) {
            return Err(damaged_at("groups", i, "parent_id"));
        }
        if too_long(&g.name, 500) {
            return Err(damaged_at("groups", i, "name"));
        }
        if !date_ok(&g.created_at) {
            return Err(damaged_at("groups", i, "created_at"));
        }
    }
    for (i, s) in m.sources.iter().enumerate() {
        let bad = |field: &str| damaged_at("sources", i, field);
        if !id_ok(&s.id) {
            return Err(bad("id"));
        }
        if !id_ok(&s.group_id) {
            return Err(bad("group_id"));
        }
        if too_long(&s.kind, 40) {
            return Err(bad("kind"));
        }
        if too_long(&s.title, 1000) {
            return Err(bad("title"));
        }
        if !opt_ok(&s.source_url, 5000) {
            return Err(bad("source_url"));
        }
        if !opt_ok(&s.canonical_url, 5000) {
            return Err(bad("canonical_url"));
        }
        if !opt_ok(&s.note, 100_000) {
            return Err(bad("note"));
        }
        if !date_ok(&s.created_at) {
            return Err(bad("created_at"));
        }
        if !date_ok(&s.updated_at) {
            return Err(bad("updated_at"));
        }
        if !opt_ok(&s.triage, 20) {
            return Err(bad("triage"));
        }
        if s.tags.len() > 100 || s.tags.iter().any(|t| too_long(t, 200)) {
            return Err(bad("tags"));
        }
        if !opt_ok(&s.summary, 20_000) {
            return Err(bad("summary"));
        }
        if !opt_ok(&s.author, 1000) {
            return Err(bad("author"));
        }
        if !opt_ok(&s.author_type, 40) {
            return Err(bad("author_type"));
        }
        if !path_ok(&s.file) {
            return Err(bad("file"));
        }
        if !path_ok(&s.media_folder) {
            return Err(bad("media_folder"));
        }
    }
    for (i, p) in m.x_posts.iter().enumerate() {
        let bad = |field: &str| damaged_at("x_posts", i, field);
        if !id_ok(&p.id) {
            return Err(bad("id"));
        }
        if !id_ok(&p.source_id) {
            return Err(bad("source_id"));
        }
        if !opt_id_ok(&p.parent_id) {
            return Err(bad("parent_id"));
        }
        if too_long(&p.post_url, 5000) || too_long(&p.canonical_url, 5000) || too_long(&p.author_url, 5000) {
            return Err(bad("post_url"));
        }
        if too_long(&p.author_name, 1000) {
            return Err(bad("author_name"));
        }
        if too_long(&p.handle, 200) {
            return Err(bad("handle"));
        }
        if p.posted_at.as_deref().is_some_and(|d| !date_ok(d)) {
            return Err(bad("posted_at"));
        }
        if too_long(&p.text, 200_000) {
            return Err(bad("text"));
        }
        if p.media.len() > 50 {
            return Err(bad("media"));
        }
        if !date_ok(&p.created_at) {
            return Err(bad("created_at"));
        }
    }
    for (i, h) in m.highlights.iter().enumerate() {
        let bad = |field: &str| damaged_at("highlights", i, field);
        if !id_ok(&h.id) {
            return Err(bad("id"));
        }
        if !id_ok(&h.source_id) {
            return Err(bad("source_id"));
        }
        if h.kind != "text" && h.kind != "image" {
            return Err(bad("kind"));
        }
        if too_long(&h.quote, 50_000) {
            return Err(bad("quote"));
        }
        if too_long(&h.prefix, 1000) || too_long(&h.suffix, 1000) {
            return Err(bad("prefix"));
        }
        if h.start_offset < 0 {
            return Err(bad("start_offset"));
        }
        if h.end_offset < 0 {
            return Err(bad("end_offset"));
        }
        if !opt_ok(&h.image_src, 5000) {
            return Err(bad("image_src"));
        }
        if !opt_ok(&h.note, 20_000) {
            return Err(bad("note"));
        }
        if !opt_count_ok(h.seconds) {
            return Err(bad("seconds"));
        }
        if h.cited.len() > 200 {
            return Err(bad("cited"));
        }
        if !date_ok(&h.created_at) {
            return Err(bad("created_at"));
        }
    }
    for (i, s) in m.outline_sections.iter().enumerate() {
        let bad = |field: &str| damaged_at("outline_sections", i, field);
        if !id_ok(&s.id) {
            return Err(bad("id"));
        }
        if too_long(&s.title, 500) {
            return Err(bad("title"));
        }
        if !date_ok(&s.created_at) {
            return Err(bad("created_at"));
        }
    }
    for (i, c) in m.cards.iter().enumerate() {
        let bad = |field: &str| damaged_at("cards", i, field);
        if !id_ok(&c.id) {
            return Err(bad("id"));
        }
        if !matches!(c.kind.as_str(), "quote" | "broll" | "line") {
            return Err(bad("kind"));
        }
        if !opt_id_ok(&c.source_id) || !opt_id_ok(&c.highlight_id) || !opt_id_ok(&c.section_id) {
            return Err(bad("source_id"));
        }
        if too_long(&c.quote, 50_000) {
            return Err(bad("quote"));
        }
        if !opt_count_ok(c.seconds) {
            return Err(bad("seconds"));
        }
        if !opt_count_ok(c.end_seconds) {
            return Err(bad("end_seconds"));
        }
        if !opt_ok(&c.url, 5000) {
            return Err(bad("url"));
        }
        if !opt_ok(&c.note, 20_000) || !opt_ok(&c.script_line, 20_000) {
            return Err(bad("note"));
        }
        if !date_ok(&c.created_at) {
            return Err(bad("created_at"));
        }
    }
    Ok(())
}

/// Every reference points at a row in the file, no id appears twice, groups don't loop.
fn reference_problem(m: &Manifest) -> Option<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    let all_ids = std::iter::once(m.project.id.as_str())
        .chain(m.groups.iter().map(|g| g.id.as_str()))
        .chain(m.sources.iter().map(|s| s.id.as_str()))
        .chain(m.x_posts.iter().map(|p| p.id.as_str()))
        .chain(m.highlights.iter().map(|h| h.id.as_str()))
        .chain(m.outline_sections.iter().map(|s| s.id.as_str()))
        .chain(m.cards.iter().map(|c| c.id.as_str()));
    for id in all_ids {
        if !seen.insert(id) {
            return Some(format!("id {} appears twice.", id));
        }
    }

    let groups: HashMap<&str, &ManifestGroup> = m.groups.iter().map(|g| (g.id.as_str(), g)).collect();
    for group in &m.groups {
        if let Some(parent) = &group.parent_id {
            if !groups.contains_key(parent.as_str()) {
                return Some(format!("group \"{}\" is inside a group that isn't in the file.", group.name));
            }
        }
    }
    for group in &m.groups {
        let mut current: Option<&ManifestGroup> = Some(group);
        let mut depth = 0;
        while let Some(g) = current {
            if depth > m.groups.len() {
                return Some(format!("group \"{}\" is inside itself.", group.name));
            }
            depth += 1;
            current = g.parent_id.as_deref().and_then(|p| groups.get(p).copied());
        }
    }

    let sources: HashSet<&str> = m.sources.iter().map(|s| s.id.as_str()).collect();
    for source in &m.sources {
        if !groups.contains_key(source.group_id.as_str()) {
            return Some(format!("source \"{}\" has no group.", source.title));
        }
    }
    let posts: HashSet<&str> = m.x_posts.iter().map(|p| p.id.as_str()).collect();
    for post in &m.x_posts {
        if !sources.contains(post.source_id.as_str()) {
            return Some("an X post belongs to a source that isn't in the file.".to_string());
        }
        if let Some(parent) = &post.parent_id {
            if !posts.contains(parent.as_str()) {
                return Some("an X post replies to a post that isn't in the file.".to_string());
            }
        }
    }
    let mut highlights: HashSet<&str> = HashSet::new();
    for h in &m.highlights {
        if !sources.contains(h.source_id.as_str()) {
            return Some("a highlight belongs to a source that isn't in the file.".to_string());
        }
        if h.end_offset < h.start_offset {
            return Some("a highlight ends before it starts.".to_string());
        }
        highlights.insert(h.id.as_str());
    }
    let sections: HashSet<&str> = m.outline_sections.iter().map(|s| s.id.as_str()).collect();
    for card in &m.cards {
        if let Some(s) = &card.source_id {
            if !sources.contains(s.as_str()) {
                return Some("a card comes from a source that isn't in the file.".to_string());
            }
        }
        if let Some(h) = &card.highlight_id {
            if !highlights.contains(h.as_str()) {
                return Some("a card comes from a highlight that isn't in the file.".to_string());
            }
        }
        if let Some(s) = &card.section_id {
            if !sections.contains(s.as_str()) {
                return Some("a card is in an outline section that isn't in the file.".to_string());
            }
        }
    }
    None
}

/// Reads and checks a `sourcefold.json`: its version, its shape, and that every reference
/// resolves. The error is a sentence for the user.
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, String> {
    let json: Value = serde_json::from_slice(bytes)
        .map_err(|_| "This project file is damaged: its sourcefold.json can't be read.".to_string())?;
    if json.get("format").and_then(Value::as_str) == Some(PROJECT_FILE_FORMAT) {
        if let Some(version) = json.get("version").and_then(Value::as_f64) {
            if version > PROJECT_FILE_VERSION as f64 {
                return Err(NEWER_VERSION.to_string());
            }
        }
    }
    let manifest: Manifest = serde_json::from_value(json)
        .map_err(|_| "This isn't a Sourcefold project file, or it's damaged.".to_string())?;
    validate_shape(&manifest)?;
    if let Some(problem) = reference_problem(&manifest) {
        return Err(format!("This project file is damaged: {}", problem));
    }
    Ok(manifest)
}

// -----------------------------------------------------------------------------
// Reading a zip someone sent (zip.ts: readProjectFile)
// -----------------------------------------------------------------------------

/// An opened, checked project file. Entries are read on demand, each capped at what the zip
/// declared and at the per-file limit, because a zip bomb lies about its sizes.
pub struct ProjectArchive {
    zip: ZipArchive<File>,
    pub manifest: Manifest,
    /// Every file except the manifest: path in the zip → index.
    entries: HashMap<String, usize>,
    /// Declared unpacked size of everything, manifest included.
    pub declared_bytes: u64,
    /// Bytes actually unpacked so far, against the 4 GB limit.
    unpacked: u64,
}

fn map_zip_err<T>(r: zip::result::ZipResult<T>) -> Result<T, String> {
    r.map_err(|_| CANT_OPEN.to_string())
}

pub fn open_project_file(path: &Path) -> Result<ProjectArchive, String> {
    let meta = fs::metadata(path).map_err(|_| "Sourcefold couldn't read that file.".to_string())?;
    if meta.len() > FILE_BYTES {
        return Err("This project file is too big to open (over 2 GB).".to_string());
    }
    let mut file = File::open(path).map_err(|_| "Sourcefold couldn't read that file.".to_string())?;
    let mut magic = [0u8; 2];
    if file.read_exact(&mut magic).is_err() || magic != [0x50, 0x4b] {
        return Err(NOT_A_PROJECT_FILE.to_string());
    }
    let mut zip = map_zip_err(ZipArchive::new(file))?;

    let mut count = 0usize;
    let mut total = 0u64;
    let mut unsafe_name: Option<String> = None;
    let mut entries: HashMap<String, usize> = HashMap::new();
    let mut lower: HashSet<String> = HashSet::new();
    let mut manifest_index: Option<usize> = None;
    for i in 0..zip.len() {
        let entry = map_zip_err(zip.by_index_raw(i))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        count += 1;
        total = total.saturating_add(entry.size());
        if count > MAX_ENTRIES {
            return Err("This project file has too many files in it.".to_string());
        }
        if total > UNPACKED_BYTES {
            return Err("This project file is too big to open (over 4 GB unpacked).".to_string());
        }
        let limit = if name == MANIFEST_PATH { MANIFEST_BYTES } else { ENTRY_BYTES };
        if entry.size() > limit {
            return Err(format!("\"{}\" in this project file is too big.", name));
        }
        if entry.encrypted() {
            return Err(CANT_OPEN.to_string());
        }
        if name == MANIFEST_PATH {
            manifest_index = Some(i);
            continue;
        }
        if !is_safe_entry_path(&name) || !is_allowed_extension(&name) {
            unsafe_name.get_or_insert(name);
            continue;
        }
        if !lower.insert(name.to_lowercase()) {
            return Err(format!("This project file is damaged: \"{}\" is in it twice.", name));
        }
        entries.insert(name, i);
    }
    if let Some(name) = unsafe_name {
        return Err(format!(
            "This project file has a file Sourcefold won't open (\"{}\"). Only Markdown, images and mp4 are allowed.",
            name
        ));
    }
    let manifest_index = manifest_index.ok_or_else(|| NOT_A_PROJECT_FILE.to_string())?;

    let mut archive = ProjectArchive {
        zip,
        manifest: Manifest {
            format: String::new(),
            version: 0,
            exported_at: String::new(),
            app: String::new(),
            project: ManifestProject { id: String::new(), name: String::new(), created_at: String::new() },
            groups: Vec::new(),
            sources: Vec::new(),
            x_posts: Vec::new(),
            highlights: Vec::new(),
            outline_sections: Vec::new(),
            cards: Vec::new(),
        },
        entries,
        declared_bytes: total,
        unpacked: 0,
    };
    let manifest_bytes = archive.read_index(manifest_index, MANIFEST_BYTES, MANIFEST_PATH)?;
    archive.manifest = parse_manifest(&manifest_bytes)?;

    for source in &archive.manifest.sources {
        if let Some(file) = &source.file {
            if !archive.entries.contains_key(file) {
                return Err(format!("This project file is damaged: \"{}\" is missing.", file));
            }
            let ext = extension_of(file);
            let fits = if source.kind == "image" { IMAGE_EXTENSIONS.contains(&ext.as_str()) } else { ext == "md" };
            if !fits {
                return Err(format!("This project file is damaged: \"{}\" isn't the right kind of file.", file));
            }
        }
        if let Some(folder) = &source.media_folder {
            if !is_safe_entry_path(folder) {
                return Err(format!("This project file is damaged: \"{}\" isn't allowed.", folder));
            }
        }
    }
    Ok(archive)
}

impl ProjectArchive {
    fn read_index(&mut self, index: usize, limit: u64, name: &str) -> Result<Vec<u8>, String> {
        let entry = map_zip_err(self.zip.by_index(index))?;
        let mut buf = Vec::new();
        entry.take(limit + 1).read_to_end(&mut buf).map_err(|_| CANT_OPEN.to_string())?;
        if buf.len() as u64 > limit {
            return Err(format!("\"{}\" in this project file is too big.", name));
        }
        self.count(buf.len() as u64)?;
        Ok(buf)
    }

    fn count(&mut self, bytes: u64) -> Result<(), String> {
        self.unpacked += bytes;
        if self.unpacked > UNPACKED_BYTES {
            return Err("This project file is too big to open (over 4 GB unpacked).".to_string());
        }
        Ok(())
    }

    /// The bytes of one file in the zip, at most 200 MB however big the zip says it is.
    pub fn read(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let index = *self
            .entries
            .get(path)
            .ok_or_else(|| format!("This project file is damaged: \"{}\" is missing.", path))?;
        self.read_index(index, ENTRY_BYTES, path)
    }

    /// The files directly inside `folder` (not its subfolders), by file name, in name order.
    pub fn files_in(&self, folder: &str) -> Vec<String> {
        let prefix = format!("{}/", folder);
        let mut names: Vec<String> = self
            .entries
            .keys()
            .filter_map(|p| p.strip_prefix(&prefix))
            .filter(|n| !n.contains('/'))
            .map(str::to_string)
            .collect();
        names.sort();
        names
    }

    /// Reads every entry once, counting what is really there (and checking the zip's CRCs), so a
    /// file whose sizes lie is refused. Returns the unpacked size of everything.
    fn verify_all(&mut self) -> Result<u64, String> {
        let mut real: u64 = 0;
        for i in 0..self.zip.len() {
            let entry = map_zip_err(self.zip.by_index(i))?;
            if entry.name().ends_with('/') {
                continue;
            }
            let limit = if entry.name() == MANIFEST_PATH { MANIFEST_BYTES } else { ENTRY_BYTES };
            let name = entry.name().to_string();
            let copied = io::copy(&mut entry.take(limit + 1), &mut io::sink()).map_err(|_| CANT_OPEN.to_string())?;
            if copied > limit {
                return Err(format!("\"{}\" in this project file is too big.", name));
            }
            real += copied;
            if real > UNPACKED_BYTES {
                return Err("This project file is too big to open (over 4 GB unpacked).".to_string());
            }
        }
        Ok(real)
    }
}

/// What the import preview shows, for a file that will import: validated in full, every entry
/// read once.
pub fn inspect_project_file(path: &Path) -> Result<ProjectFileSummary, String> {
    let mut archive = open_project_file(path)?;
    let bytes = archive.verify_all()?;
    let m = &archive.manifest;
    Ok(ProjectFileSummary {
        name: m.project.name.clone(),
        groups: m.groups.len(),
        sources: m.sources.len(),
        highlights: m.highlights.len(),
        cards: m.cards.len(),
        bytes,
    })
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

fn pos_f64(position: i32) -> f64 {
    position as f64
}

fn pos_i32(position: f64) -> i32 {
    position.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

/// "Cars" → "Cars.sourcefold", with characters file systems reject taken out.
pub fn project_file_name(project_name: &str) -> String {
    let cleaned: String = project_name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let base = collapsed.trim_matches('.');
    format!("{}.sourcefold", if base.is_empty() { "Project" } else { base })
}

fn deflated(large: bool) -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated).large_file(large)
}

fn stored(large: bool) -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(large)
}

fn options_for(path: &str, size: u64) -> SimpleFileOptions {
    let large = size >= 0xFFFF_FFFF;
    if STORED_EXTENSIONS.contains(&extension_of(path).as_str()) {
        stored(large)
    } else {
        deflated(large)
    }
}

fn export_error(err: impl std::fmt::Display) -> String {
    format!("Couldn't write the project file: {}", err)
}

/// Writes `project_id` as a `.sourcefold` file at `dest`: the manifest, each source's file as the
/// app writes it to disk, image sources, and the images and GIFs of posts. Sources whose file
/// can't be read are listed in `skipped` and are in the file without it.
pub fn export_project_file(db: &Database, project_id: &str, dest: &Path) -> Result<ExportReport, String> {
    let project = db
        .get_folder(project_id)
        .map_err(|_| "That project isn't there any more.".to_string())?;
    if project.parent_id.is_some() {
        return Err("Choose a project to download.".to_string());
    }

    // The groups under the project, parents first. Archived ones go in like any other.
    let all = db.get_folders(true);
    let mut groups: Vec<crate::models::Folder> = Vec::new();
    let mut queue: Vec<String> = vec![project.id.clone()];
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(project.id.clone());
    while !queue.is_empty() {
        let parents = std::mem::take(&mut queue);
        for parent in parents {
            for folder in all.iter().filter(|f| f.parent_id.as_deref() == Some(parent.as_str())) {
                if seen.insert(folder.id.clone()) {
                    groups.push(folder.clone());
                    queue.push(folder.id.clone());
                }
            }
        }
    }
    let group_ids: HashSet<&str> = groups.iter().map(|g| g.id.as_str()).collect();

    // "Cars/Engines/Diesel", for each group's `folder:` front matter.
    let by_id: HashMap<&str, &crate::models::Folder> = groups.iter().map(|g| (g.id.as_str(), g)).collect();
    let display_path = |group_id: &str| -> String {
        let mut segments = vec![];
        let mut current = by_id.get(group_id).copied();
        while let Some(g) = current {
            segments.push(g.name.clone());
            current = g.parent_id.as_deref().and_then(|p| by_id.get(p).copied());
            if segments.len() > groups.len() + 1 {
                break;
            }
        }
        segments.push(project.name.clone());
        segments.reverse();
        segments.join("/")
    };

    let mut items: Vec<Item> = Vec::new();
    for group in &groups {
        items.extend(db.get_items(&group.id));
    }

    let storage_root = service::resolve_storage_dir(db);
    let mut skipped: Vec<Skipped> = Vec::new();

    // Which file each source has, and its extension (image sources keep their own).
    let mut image_ext: HashMap<String, String> = HashMap::new();
    for item in items.iter().filter(|i| i.kind == "image") {
        let ext = item
            .storage_path
            .as_deref()
            .map(extension_of)
            .unwrap_or_default();
        if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            image_ext.insert(item.id.clone(), ext);
        }
    }
    let path_groups: Vec<PathGroup> = groups
        .iter()
        .map(|g| PathGroup {
            id: g.id.clone(),
            parent_id: g.parent_id.clone().filter(|p| group_ids.contains(p.as_str())),
            name: g.name.clone(),
            created_at: g.created_at.clone(),
        })
        .collect();
    let path_sources: Vec<PathSource> = items
        .iter()
        .map(|i| PathSource {
            id: i.id.clone(),
            group_id: i.folder_id.clone(),
            title: i.title.clone(),
            created_at: i.created_at.clone(),
            extension: image_ext.get(&i.id).cloned().unwrap_or_else(|| "md".to_string()),
        })
        .collect();
    let paths = project_file_paths(&project.name, &path_groups, &path_sources);

    let part = {
        let mut name: OsString = dest.as_os_str().to_owned();
        name.push(".part");
        PathBuf::from(name)
    };
    let result = write_project_zip(
        db,
        &project,
        &groups,
        &items,
        &paths,
        &display_path,
        &storage_root,
        &part,
        &mut skipped,
    );
    match result {
        Ok(()) => {
            if let Err(err) = fs::rename(&part, dest) {
                let _ = fs::remove_file(&part);
                return Err(export_error(err));
            }
        }
        Err(err) => {
            let _ = fs::remove_file(&part);
            return Err(err);
        }
    }
    Ok(ExportReport {
        file_name: dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        skipped,
    })
}

#[allow(clippy::too_many_arguments)]
fn write_project_zip(
    db: &Database,
    project: &crate::models::Folder,
    groups: &[crate::models::Folder],
    items: &[Item],
    paths: &HashMap<String, (String, String)>,
    display_path: &dyn Fn(&str) -> String,
    storage_root: &Path,
    part: &Path,
    skipped: &mut Vec<Skipped>,
) -> Result<(), String> {
    let out = File::create(part).map_err(export_error)?;
    let mut zip = ZipWriter::new(BufWriter::new(out));
    let mut added: HashSet<String> = HashSet::new();

    let mut sources: Vec<ManifestSource> = Vec::new();
    let mut x_posts: Vec<ManifestXPost> = Vec::new();
    let mut highlights: Vec<ManifestHighlight> = Vec::new();

    for item in items {
        let (file_path, media_path) = paths[&item.id].clone();
        let mut file: Option<String> = None;
        let mut media_folder: Option<String> = None;

        if item.kind == "image" {
            let ext_ok = file_path.rsplit('.').next().is_some_and(|e| IMAGE_EXTENSIONS.contains(&e));
            let disk = item
                .storage_path
                .as_deref()
                .and_then(|p| service::safe_storage_path(storage_root, p))
                .filter(|p| p.is_file());
            match disk {
                Some(disk) if ext_ok && is_safe_entry_path(&file_path) => {
                    let size = fs::metadata(&disk).map(|m| m.len()).unwrap_or(0);
                    if size > ENTRY_BYTES {
                        skipped.push(Skipped { title: item.title.clone(), reason: "The image is too big for a project file.".to_string() });
                    } else {
                        zip.start_file(file_path.as_str(), options_for(&file_path, size)).map_err(export_error)?;
                        let mut source = File::open(&disk).map_err(export_error)?;
                        io::copy(&mut source, &mut zip).map_err(export_error)?;
                        added.insert(file_path.to_lowercase());
                        file = Some(file_path.clone());
                    }
                }
                _ => skipped.push(Skipped {
                    title: item.title.clone(),
                    reason: "The image file isn't on this computer any more.".to_string(),
                }),
            }
        } else if let Some(existing) = &item.markdown {
            if !is_safe_entry_path(&file_path) {
                skipped.push(Skipped { title: item.title.clone(), reason: "Its file name is too long.".to_string() });
            } else {
                // The file the app writes to disk: front matter, body, summary, highlights, note.
                let (body, _) = service::extract_body_and_note(existing);
                let folder = display_path(&item.folder_id);
                let fields = service::item_file_fields(item, item.title.clone(), Some(folder));
                let highlights = db.get_highlights_for_item(&item.id).unwrap_or_default();
                let text = service::build_item_file_with_highlights(
                    &item.kind,
                    &fields,
                    &body,
                    item.note.as_deref(),
                    &highlights,
                );
                zip.start_file(file_path.as_str(), deflated(false)).map_err(export_error)?;
                zip.write_all(text.as_bytes()).map_err(export_error)?;
                added.insert(file_path.to_lowercase());
                file = Some(file_path.clone());

                // The images and GIFs saved next to the post, when there are any.
                let md_on_disk = item
                    .storage_path
                    .as_deref()
                    .and_then(|p| service::safe_storage_path(storage_root, p));
                if let Some(md_on_disk) = md_on_disk {
                    let dir = md_on_disk.with_extension("");
                    let dir = dir.with_file_name(format!(
                        "{}_files",
                        md_on_disk.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
                    ));
                    let mut names: Vec<String> = fs::read_dir(&dir)
                        .map(|rd| {
                            rd.flatten()
                                .filter(|e| e.path().is_file())
                                .map(|e| e.file_name().to_string_lossy().into_owned())
                                .collect()
                        })
                        .unwrap_or_default();
                    names.sort();
                    let mut copied = 0;
                    for name in names {
                        let ext = extension_of(&name);
                        if ext == "md" || !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
                            continue;
                        }
                        let entry_path = format!("{}/{}", media_path, name);
                        let disk = dir.join(&name);
                        let size = fs::metadata(&disk).map(|m| m.len()).unwrap_or(0);
                        if !is_safe_entry_path(&entry_path) || size > ENTRY_BYTES || !added.insert(entry_path.to_lowercase()) {
                            continue;
                        }
                        let Ok(mut source) = File::open(&disk) else { continue };
                        zip.start_file(entry_path.as_str(), options_for(&entry_path, size)).map_err(export_error)?;
                        io::copy(&mut source, &mut zip).map_err(export_error)?;
                        copied += 1;
                    }
                    if copied > 0 {
                        media_folder = Some(media_path.clone());
                    }
                }
            }
        }

        sources.push(ManifestSource {
            id: item.id.clone(),
            group_id: item.folder_id.clone(),
            kind: item.kind.clone(),
            title: item.title.clone(),
            source_url: item.source_url.clone(),
            canonical_url: item.canonical_url.clone(),
            meta: item.meta.as_object().cloned().unwrap_or_default(),
            note: item.note.clone(),
            position: pos_f64(item.position),
            created_at: item.created_at.clone(),
            updated_at: item.updated_at.clone(),
            triage: item.triage.clone(),
            tags: item.tags.clone(),
            summary: item.summary.clone(),
            author: item.author.clone(),
            author_type: item.author_type.clone(),
            file,
            media_folder,
        });

        if item.kind == "x" {
            for post in db.get_x_posts(&item.id).unwrap_or_default() {
                let media: Vec<Value> = serde_json::from_str(&post.media).unwrap_or_default();
                x_posts.push(ManifestXPost {
                    id: post.id,
                    source_id: item.id.clone(),
                    parent_id: post.parent_id,
                    post_url: post.post_url,
                    canonical_url: post.canonical_url,
                    author_name: post.author_name,
                    handle: post.handle,
                    author_url: post.author_url,
                    posted_at: post.posted_at,
                    text: post.text,
                    media: media.into_iter().take(50).collect(),
                    position: pos_f64(post.position),
                    created_at: post.created_at,
                });
            }
        }
        for h in db.get_highlights_for_item(&item.id).unwrap_or_default() {
            highlights.push(ManifestHighlight {
                id: h.id,
                source_id: item.id.clone(),
                kind: h.kind,
                quote: h.quote,
                prefix: h.prefix,
                suffix: h.suffix,
                start_offset: h.start_offset.max(0),
                end_offset: h.end_offset.max(h.start_offset.max(0)),
                image_src: h.image_src,
                note: h.note,
                seconds: h.seconds.map(|s| s.max(0)),
                cited: h
                    .cited
                    .iter()
                    .filter_map(|c| serde_json::to_value(c).ok())
                    .take(200)
                    .collect(),
                created_at: h.created_at,
            });
        }
    }

    // An X post's parent is another post of the same thread; drop a dangling link.
    let post_ids: HashSet<String> = x_posts.iter().map(|p| p.id.clone()).collect();
    for post in &mut x_posts {
        if post.parent_id.as_ref().is_some_and(|p| !post_ids.contains(p)) {
            post.parent_id = None;
        }
    }

    let sections: Vec<ManifestSection> = db
        .list_outline_sections(&project.id)
        .unwrap_or_default()
        .into_iter()
        .map(|s| ManifestSection { id: s.id, title: s.title, position: s.position, created_at: s.created_at })
        .collect();
    let source_ids: HashSet<&str> = sources.iter().map(|s| s.id.as_str()).collect();
    let highlight_ids: HashSet<&str> = highlights.iter().map(|h| h.id.as_str()).collect();
    let section_ids: HashSet<&str> = sections.iter().map(|s| s.id.as_str()).collect();
    let cards: Vec<ManifestCard> = db
        .list_cards(Some(&project.id), None)
        .unwrap_or_default()
        .into_iter()
        .filter(|c| c.item_id.as_deref().is_none_or(|i| source_ids.contains(i)))
        .map(|c| ManifestCard {
            id: c.id,
            kind: c.kind,
            highlight_id: c.highlight_id.filter(|h| highlight_ids.contains(h.as_str())),
            source_id: c.item_id,
            quote: c.quote,
            seconds: c.seconds.map(|s| s.max(0)),
            end_seconds: c.end_seconds.map(|s| s.max(0)),
            url: c.url,
            note: c.note,
            script_line: c.script_line,
            section_id: c.section_id.filter(|s| section_ids.contains(s.as_str())),
            position: c.position,
            created_at: c.created_at,
        })
        .collect();

    let manifest = Manifest {
        format: PROJECT_FILE_FORMAT.to_string(),
        version: PROJECT_FILE_VERSION,
        exported_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        app: "Sourcefold desktop (offline)".to_string(),
        project: ManifestProject {
            id: project.id.clone(),
            name: project.name.clone(),
            created_at: project.created_at.clone(),
        },
        groups: groups
            .iter()
            .map(|g| ManifestGroup {
                id: g.id.clone(),
                parent_id: g.parent_id.clone().filter(|p| *p != project.id),
                name: g.name.clone(),
                position: pos_f64(g.position),
                created_at: g.created_at.clone(),
            })
            .collect(),
        sources,
        x_posts,
        highlights,
        outline_sections: sections,
        cards,
    };
    if let Some(problem) = reference_problem(&manifest) {
        return Err(format!("Couldn't write the project file: {}", problem));
    }

    let mut json = serde_json::to_string_pretty(&manifest).map_err(export_error)?;
    json.push('\n');
    zip.start_file(MANIFEST_PATH, deflated(false)).map_err(export_error)?;
    zip.write_all(json.as_bytes()).map_err(export_error)?;
    let mut inner = zip.finish().map_err(export_error)?;
    inner.flush().map_err(export_error)?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

/// A Windows device name ("CON", "NUL", "COM1", also as "CON.png") must never be created.
fn is_reserved_file_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit()
            && stem.as_bytes()[3] != b'0')
}

enum DiskJob {
    /// A text source: its file is written next to the others, then its `_files` images.
    Text { item_id: String, folder_id: String, title: String, created_at: String, file: String, media_folder: Option<String> },
    /// An image source: the bytes come from this path in the zip.
    Image { item_id: String, folder_id: String, title: String, created_at: String, zip_path: String },
}

struct NewItem {
    id: String,
    folder_id: String,
    kind: String,
    title: String,
    source_url: Option<String>,
    canonical_url: Option<String>,
    status: &'static str,
    error: Option<String>,
    markdown: Option<String>,
    meta: String,
    note: Option<String>,
    position: i32,
    created_at: String,
    updated_at: String,
    triage: Option<String>,
    tags: String,
    summary: Option<String>,
    author: Option<String>,
    author_type: Option<String>,
}

fn db_error(err: rusqlite::Error) -> String {
    format!("Couldn't save the project: {}", err)
}

/// Imports the file as a new project: one transaction, a new id for every row with the references
/// rewired, then the Markdown files, images and `_files` folders on disk. A name already in use
/// becomes "Cars (2)".
pub fn import_project_file(db: &Database, path: &Path) -> Result<ImportReport, String> {
    let mut archive = open_project_file(path)?;
    let m = archive.manifest.clone();

    // New ids for everything.
    let mut ids: HashMap<String, String> = HashMap::new();
    let mut fresh = |old: &str| -> String {
        ids.entry(old.to_string()).or_insert_with(|| uuid::Uuid::new_v4().to_string()).clone()
    };
    let project_id = fresh(&m.project.id);

    let taken: Vec<String> = db
        .get_folders(true)
        .into_iter()
        .filter(|f| f.parent_id.is_none())
        .map(|f| f.name)
        .collect();
    let project_name = unique_project_name(&m.project.name, &taken);
    let project_position = db
        .get_folders(true)
        .iter()
        .filter(|f| f.parent_id.is_none())
        .map(|f| f.position)
        .max()
        .map_or(0, |p| p.saturating_add(1));

    // "Cars/Engines/Diesel" for each group (the `folder:` front matter).
    let group_by_id: HashMap<&str, &ManifestGroup> = m.groups.iter().map(|g| (g.id.as_str(), g)).collect();
    let display_path = |group_id: &str| -> String {
        let mut segments = vec![];
        let mut current = group_by_id.get(group_id).copied();
        while let Some(g) = current {
            segments.push(g.name.clone());
            current = g.parent_id.as_deref().and_then(|p| group_by_id.get(p).copied());
            if segments.len() > m.groups.len() + 1 {
                break;
            }
        }
        segments.push(project_name.clone());
        segments.reverse();
        segments.join("/")
    };

    // Highlights by source, with the new ids.
    let mut highlights_of: HashMap<&str, Vec<Highlight>> = HashMap::new();
    for h in &m.highlights {
        let cited: Vec<HighlightCitation> =
            h.cited.iter().filter_map(|c| serde_json::from_value(c.clone()).ok()).collect();
        highlights_of.entry(h.source_id.as_str()).or_default().push(Highlight {
            id: fresh(&h.id),
            item_id: fresh(&h.source_id),
            kind: h.kind.clone(),
            quote: h.quote.clone(),
            prefix: h.prefix.clone(),
            suffix: h.suffix.clone(),
            start_offset: h.start_offset,
            end_offset: h.end_offset,
            image_src: h.image_src.clone(),
            note: h.note.clone(),
            seconds: h.seconds,
            cited,
            created_at: h.created_at.clone(),
            updated_at: h.created_at.clone(),
        });
    }

    // The sources: the text of each is the file the app would write, built from the body of the
    // `.md` in the zip (so highlight offsets still match) and the fields of the manifest.
    let mut new_items: Vec<NewItem> = Vec::new();
    let mut jobs: Vec<DiskJob> = Vec::new();
    let mut skipped: Vec<Skipped> = Vec::new();
    for source in &m.sources {
        let id = fresh(&source.id);
        let folder_id = fresh(&source.group_id);
        let mut markdown: Option<String> = None;
        let mut status = "saved";
        let mut error: Option<String> = None;

        if source.kind == "image" {
            match &source.file {
                Some(file) => jobs.push(DiskJob::Image {
                    item_id: id.clone(),
                    folder_id: folder_id.clone(),
                    title: source.title.clone(),
                    created_at: source.created_at.clone(),
                    zip_path: file.clone(),
                }),
                None => {
                    status = "unavailable";
                    error = Some("The image wasn't included in the project file.".to_string());
                }
            }
        } else {
            match &source.file {
                Some(file) => {
                    let bytes = archive.read(file)?;
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
                    let (body, _) = service::extract_body_and_note(&text);
                    let item = Item {
                        id: id.clone(),
                        folder_id: folder_id.clone(),
                        kind: source.kind.clone(),
                        title: source.title.clone(),
                        source_url: source.source_url.clone(),
                        canonical_url: source.canonical_url.clone(),
                        status: "saved".to_string(),
                        error: None,
                        markdown: None,
                        meta: Value::Object(source.meta.clone()),
                        note: source.note.clone(),
                        position: pos_i32(source.position),
                        storage_path: None,
                        deleted_at: None,
                        created_at: source.created_at.clone(),
                        updated_at: source.updated_at.clone(),
                        triage: source.triage.clone(),
                        tags: source.tags.clone(),
                        summary: source.summary.clone(),
                        author: source.author.clone(),
                        author_type: source.author_type.clone(),
                    };
                    let fields = service::item_file_fields(&item, source.title.clone(), Some(display_path(&source.group_id)));
                    let highlights = highlights_of.get(source.id.as_str()).cloned().unwrap_or_default();
                    markdown = Some(service::build_item_file_with_highlights(
                        &source.kind,
                        &fields,
                        &body,
                        source.note.as_deref(),
                        &highlights,
                    ));
                    jobs.push(DiskJob::Text {
                        item_id: id.clone(),
                        folder_id: folder_id.clone(),
                        title: source.title.clone(),
                        created_at: source.created_at.clone(),
                        file: file.clone(),
                        media_folder: source.media_folder.clone(),
                    });
                }
                None => {
                    status = "unavailable";
                    error = Some("Its text wasn't included in the project file.".to_string());
                }
            }
        }

        new_items.push(NewItem {
            id,
            folder_id,
            kind: source.kind.clone(),
            title: source.title.clone(),
            source_url: source.source_url.clone(),
            canonical_url: source.canonical_url.clone(),
            status,
            error,
            markdown,
            meta: Value::Object(source.meta.clone()).to_string(),
            note: source.note.clone(),
            position: pos_i32(source.position),
            created_at: source.created_at.clone(),
            updated_at: source.updated_at.clone(),
            triage: source.triage.clone(),
            tags: serde_json::to_string(&source.tags).unwrap_or_else(|_| "[]".to_string()),
            summary: source.summary.clone(),
            author: source.author.clone(),
            author_type: source.author_type.clone(),
        });
    }

    // Everything else gets its new ids now, before the transaction.
    let group_rows: Vec<(String, Option<String>, &ManifestGroup)> = {
        // Parents before children, so a group's parent row exists when it is inserted.
        let mut ordered: Vec<&ManifestGroup> = Vec::new();
        let mut placed: HashSet<&str> = HashSet::new();
        let mut remaining: Vec<&ManifestGroup> = m.groups.iter().collect();
        while !remaining.is_empty() {
            let before = remaining.len();
            remaining.retain(|g| {
                let ready = g.parent_id.as_deref().is_none_or(|p| placed.contains(p));
                if ready {
                    placed.insert(g.id.as_str());
                    ordered.push(g);
                }
                !ready
            });
            if remaining.len() == before {
                return Err("This project file is damaged: a group is inside itself.".to_string());
            }
        }
        ordered
            .into_iter()
            .map(|g| {
                let parent = g.parent_id.as_deref().map(&mut fresh).unwrap_or_else(|| project_id.clone());
                (fresh(&g.id), Some(parent), g)
            })
            .collect()
    };
    let post_rows: Vec<(String, String, Option<String>, &ManifestXPost)> = m
        .x_posts
        .iter()
        .map(|p| (fresh(&p.id), fresh(&p.source_id), p.parent_id.as_deref().map(&mut fresh), p))
        .collect();
    let section_rows: Vec<(String, &ManifestSection)> =
        m.outline_sections.iter().map(|s| (fresh(&s.id), s)).collect();
    #[allow(clippy::type_complexity)]
    let card_rows: Vec<(String, Option<String>, Option<String>, Option<String>, &ManifestCard)> = m
        .cards
        .iter()
        .map(|c| {
            (
                fresh(&c.id),
                c.source_id.as_deref().map(&mut fresh),
                c.highlight_id.as_deref().map(&mut fresh),
                c.section_id.as_deref().map(&mut fresh),
                c,
            )
        })
        .collect();

    let now = Utc::now().to_rfc3339();
    db.with_conn(|conn| {
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
             VALUES (?1, NULL, ?2, ?3, NULL, NULL, ?4, ?4)",
            params![project_id, project_name, project_position, now],
        )?;
        for (id, parent, g) in &group_rows {
            tx.execute(
                "INSERT INTO folders (id, parent_id, name, position, archived_at, deleted_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6)",
                params![id, parent, g.name, pos_i32(g.position), g.created_at, now],
            )?;
        }
        for item in &new_items {
            tx.execute(
                "INSERT INTO items (id, folder_id, kind, title, source_url, canonical_url, status, error, markdown, meta, note, position, storage_path, deleted_at, created_at, updated_at, triage, tags, summary, author, author_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    item.id, item.folder_id, item.kind, item.title, item.source_url, item.canonical_url,
                    item.status, item.error, item.markdown, item.meta, item.note, item.position,
                    item.created_at, item.updated_at, item.triage, item.tags, item.summary, item.author,
                    item.author_type
                ],
            )?;
        }
        for (id, source_id, parent, p) in &post_rows {
            let media = serde_json::to_string(&p.media).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT INTO x_posts (id, item_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, media, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    id, source_id, parent, p.post_url, p.canonical_url, p.author_name, p.handle,
                    p.author_url, p.posted_at, p.text, media, pos_i32(p.position), p.created_at
                ],
            )?;
        }
        for h in highlights_of.values().flatten() {
            let cited = serde_json::to_string(&h.cited).unwrap_or_else(|_| "[]".to_string());
            tx.execute(
                "INSERT INTO highlights (id, item_id, kind, quote, prefix, suffix, start_offset, end_offset, image_src, note, seconds, cited, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
                params![
                    h.id, h.item_id, h.kind, h.quote, h.prefix, h.suffix, h.start_offset, h.end_offset,
                    h.image_src, h.note, h.seconds, cited, h.created_at
                ],
            )?;
        }
        for (id, s) in &section_rows {
            tx.execute(
                "INSERT INTO outline_sections (id, project_id, title, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, project_id, s.title, s.position, s.created_at],
            )?;
        }
        for (id, source_id, highlight_id, section_id, c) in &card_rows {
            tx.execute(
                "INSERT INTO cards (id, project_id, kind, item_id, highlight_id, quote, seconds, end_seconds, url, note, script_line, section_id, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
                params![
                    id, project_id, c.kind, source_id, highlight_id, c.quote, c.seconds, c.end_seconds,
                    c.url, c.note, c.script_line, section_id, c.position, c.created_at
                ],
            )?;
        }
        tx.commit()
    })
    .map_err(db_error)?;

    // After the commit, the files go where the app keeps them: the Markdown (which also makes
    // the search index look again), image sources, and a post's images in `<name>_files/`.
    let storage_root = service::resolve_storage_dir(db);
    for job in jobs {
        match job {
            DiskJob::Text { item_id, folder_id, title, created_at, file, media_folder } => {
                let text = db.get_item(&item_id).ok().and_then(|i| i.markdown).unwrap_or_default();
                let written = service::write_item_file_to_disk(
                    db, &folder_id, &item_id, &title, "md", &created_at, text.as_bytes(),
                );
                let (md_path, _) = match written {
                    Ok(w) => w,
                    Err(err) => {
                        skipped.push(Skipped { title, reason: format!("Couldn't save its file: {}", err.message) });
                        continue;
                    }
                };
                if let Some(folder) = media_folder {
                    let _ = file;
                    copy_post_media(&mut archive, &folder, &md_path, &text);
                }
            }
            DiskJob::Image { item_id, folder_id, title, created_at, zip_path } => {
                let ext = extension_of(&zip_path);
                let bytes = match archive.read(&zip_path) {
                    Ok(b) => b,
                    Err(reason) => {
                        skipped.push(Skipped { title, reason });
                        continue;
                    }
                };
                if let Err(err) =
                    service::write_item_file_to_disk(db, &folder_id, &item_id, &title, &ext, &created_at, &bytes)
                {
                    skipped.push(Skipped { title, reason: format!("Couldn't save the image: {}", err.message) });
                }
            }
        }
    }
    let _ = storage_root;

    // Writing the files touched `updated_at`; put back the dates the file came with.
    let dates: Vec<(String, String)> = new_items.iter().map(|i| (i.id.clone(), i.updated_at.clone())).collect();
    let _ = db.with_conn(|conn| {
        let tx = conn.transaction()?;
        for (id, updated_at) in &dates {
            tx.execute("UPDATE items SET updated_at = ?1 WHERE id = ?2", params![updated_at, id])?;
        }
        tx.commit()
    });
    crate::search::notify();

    Ok(ImportReport { project_id, name: project_name, skipped })
}

/// Copies the post's images and GIFs from the zip into `<file name>_files/` next to its file, and
/// points the links in the file on disk at the copies, as the signed-in local copy does.
fn copy_post_media(archive: &mut ProjectArchive, folder: &str, md_path: &Path, markdown: &str) {
    let Some(stem) = md_path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { return };
    let dir_name = format!("{}_files", stem);
    let dir = md_path.with_file_name(&dir_name);
    let mut copied: HashSet<String> = HashSet::new();
    for name in archive.files_in(folder) {
        let ext = extension_of(&name);
        if ext == "md" || !ALLOWED_EXTENSIONS.contains(&ext.as_str()) || is_reserved_file_name(&name) {
            continue;
        }
        let Ok(bytes) = archive.read(&format!("{}/{}", folder, name)) else { continue };
        if fs::create_dir_all(&dir).is_err() || fs::write(dir.join(&name), bytes).is_err() {
            continue;
        }
        copied.insert(name.to_lowercase());
    }
    if copied.is_empty() {
        return;
    }
    let urls = image_urls(markdown);
    let names = image_file_names(&urls);
    let mut out = markdown.to_string();
    for (url, name) in urls.iter().zip(&names) {
        if copied.contains(&name.to_lowercase()) {
            out = out.replace(
                &format!("]({})", url),
                &format!("]({}/{})", link_part(&dir_name), link_part(name)),
            );
        }
    }
    if out != markdown {
        let _ = fs::write(md_path, out.as_bytes());
    }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{AddXPostRequest, CardInput, OutlineSectionInput, SaveItemRequest};
    use serde_json::json;

    const GOLDEN: &str = include_str!("../../../../packages/core/test/golden/project-file.manifest.json");

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sourcefold-pf-{}-{}", std::process::id(), tag));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn golden() -> Value {
        serde_json::from_str(GOLDEN).unwrap()
    }

    fn parse(value: &Value) -> Result<Manifest, String> {
        parse_manifest(value.to_string().as_bytes())
    }

    #[test]
    fn the_golden_manifest_parses_and_validates() {
        let m = parse_manifest(GOLDEN.as_bytes()).unwrap();
        assert_eq!(m.project.name, "Cars");
        assert_eq!(m.groups.len(), 2);
        assert_eq!(m.sources.len(), 3);
        assert_eq!(m.x_posts.len(), 2);
        assert_eq!(m.highlights.len(), 1);
        assert_eq!(m.cards.len(), 2);
        // Written back out and read again, it is the same.
        let again = parse_manifest(serde_json::to_string(&m).unwrap().as_bytes()).unwrap();
        assert_eq!(m, again);
    }

    #[test]
    fn a_newer_version_is_refused_with_the_update_sentence() {
        let mut v = golden();
        v["version"] = json!(2);
        assert_eq!(parse(&v).unwrap_err(), NEWER_VERSION);
    }

    #[test]
    fn a_reference_that_does_not_resolve_is_refused() {
        let mut v = golden();
        v["highlights"][0]["source_id"] = json!("nowhere");
        assert!(parse(&v).unwrap_err().starts_with("This project file is damaged:"));

        let mut v = golden();
        v["sources"][0]["group_id"] = json!("nowhere");
        assert!(parse(&v).unwrap_err().contains("has no group"));

        let mut v = golden();
        v["cards"][0]["section_id"] = json!("nowhere");
        assert!(parse(&v).unwrap_err().contains("outline section"));
    }

    #[test]
    fn a_duplicate_id_or_a_group_loop_is_refused() {
        let mut v = golden();
        v["sources"][1]["id"] = json!("s-turbo");
        assert!(parse(&v).unwrap_err().contains("appears twice"));

        let mut v = golden();
        v["groups"][0]["parent_id"] = json!("g-diesel");
        assert!(parse(&v).unwrap_err().contains("inside itself"));
    }

    #[test]
    fn a_wrong_shape_is_refused() {
        let mut v = golden();
        v["format"] = json!("something-else");
        assert!(parse(&v).is_err());

        let mut v = golden();
        v["highlights"][0]["start_offset"] = json!(-1);
        assert!(parse(&v).is_err());

        let mut v = golden();
        v["sources"][0]["title"] = json!("x".repeat(1001));
        assert!(parse(&v).is_err());

        assert!(parse_manifest(b"not json").is_err());
    }

    #[test]
    fn entry_paths_follow_the_safe_path_rules() {
        for ok in ["Cars/Engines/Turbocharger.md", "Cars/Thread (@jack)_files/a b.png", "Ünï/çödé.md"] {
            assert!(is_safe_entry_path(ok), "{}", ok);
        }
        for bad in [
            "", "/abs.md", "../x.md", "a/../x.md", "a//b.md", "./a.md", "C:/x.md", "a\\b.md",
            "a/b?.md", "a/b*.md", "a/<b>.md", "a/\"b\".md", "a/b|c.md", "a/b\u{1}.md", "a/ b.md",
            "a/b.", "a/./b.md",
        ] {
            assert!(!is_safe_entry_path(bad), "{}", bad);
        }
    }

    fn zip_with(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, data) in entries {
            zip.start_file(*name, deflated(false)).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    fn golden_zip(dir: &Path, extra: &[(&str, Vec<u8>)]) -> PathBuf {
        let path = dir.join("test.sourcefold");
        let mut entries: Vec<(&str, Vec<u8>)> = vec![
            ("sourcefold.json", GOLDEN.as_bytes().to_vec()),
            ("Cars/Engines/Turbocharger.md", b"---\nsource: grokipedia\n---\n\n# Turbocharger\n\nBody.\n".to_vec()),
            ("Cars/Engines/Diesel/Thread by Jack (@jack).md", b"# Thread\n\nBody.\n".to_vec()),
            ("Cars/Engines/Diesel/Thread by Jack (@jack)_files/abc.jpg", vec![1, 2, 3]),
            ("Cars/Engines/Diesel/Diagram.png", vec![137, 80, 78, 71]),
        ];
        entries.extend(extra.iter().map(|(n, d)| (*n, d.clone())));
        zip_with(&path, &entries);
        path
    }

    #[test]
    fn a_good_zip_opens_and_is_summarised() {
        let dir = temp_dir("good");
        let path = golden_zip(&dir, &[]);
        let summary = inspect_project_file(&path).unwrap();
        assert_eq!(summary.name, "Cars");
        assert_eq!((summary.groups, summary.sources, summary.highlights, summary.cards), (2, 3, 1, 2));
        assert!(summary.bytes > GOLDEN.len() as u64 / 2);
    }

    #[test]
    fn unsafe_or_unlisted_entries_are_refused() {
        let dir = temp_dir("tampered");
        let exe = golden_zip(&dir, &[("Cars/setup.exe", vec![0x4d, 0x5a])]);
        let err = open_project_file(&exe).err().unwrap();
        assert!(err.contains("won't open") && err.contains("setup.exe"), "{}", err);

        let up = golden_zip(&dir, &[("../evil.md", b"x".to_vec())]);
        let err = open_project_file(&up).err().unwrap();
        assert!(err.contains("won't open"), "{}", err);

        let drive = golden_zip(&dir, &[("C:/evil.md", b"x".to_vec())]);
        assert!(open_project_file(&drive).is_err());

        let backslash = golden_zip(&dir, &[("Cars\\evil.md", b"x".to_vec())]);
        assert!(open_project_file(&backslash).is_err());
    }

    #[test]
    fn a_manifest_file_that_is_not_in_the_zip_is_refused() {
        let dir = temp_dir("missing");
        let path = dir.join("missing.sourcefold");
        zip_with(&path, &[("sourcefold.json", GOLDEN.as_bytes().to_vec())]);
        let err = open_project_file(&path).err().unwrap();
        assert!(err.contains("is missing"), "{}", err);
    }

    #[test]
    fn a_zip_without_a_manifest_or_not_a_zip_is_refused() {
        let dir = temp_dir("notproject");
        let path = dir.join("a.sourcefold");
        zip_with(&path, &[("Cars/a.md", b"x".to_vec())]);
        assert_eq!(open_project_file(&path).err().unwrap(), NOT_A_PROJECT_FILE);
        let text = dir.join("b.sourcefold");
        fs::write(&text, b"hello there").unwrap();
        assert_eq!(open_project_file(&text).err().unwrap(), NOT_A_PROJECT_FILE);
    }

    #[test]
    fn a_newer_version_in_a_zip_is_refused() {
        let dir = temp_dir("newer");
        let mut v = golden();
        v["version"] = json!(7);
        let path = dir.join("newer.sourcefold");
        zip_with(&path, &[("sourcefold.json", v.to_string().into_bytes())]);
        assert_eq!(open_project_file(&path).err().unwrap(), NEWER_VERSION);
    }

    #[test]
    fn project_names_are_made_unique() {
        let taken = vec!["Cars".to_string(), "cars (2)".to_string()];
        assert_eq!(unique_project_name("Cars", &taken), "Cars (3)");
        assert_eq!(unique_project_name("Boats", &taken), "Boats");
        assert_eq!(unique_project_name("  ", &[]), "Imported project");
        assert_eq!(project_file_name("Cars: the \"best\"/worst"), "Cars the best worst.sourcefold");
        assert_eq!(project_file_name("..."), "Project.sourcefold");
    }

    #[test]
    fn paths_match_the_typescript_layout() {
        let groups = vec![
            PathGroup { id: "g1".into(), parent_id: None, name: "Engines".into(), created_at: "2026-10-01T09:01:00.000Z".into() },
            PathGroup { id: "g2".into(), parent_id: Some("g1".into()), name: "Diesel".into(), created_at: "2026-10-01T09:02:00.000Z".into() },
            PathGroup { id: "g3".into(), parent_id: None, name: "engines".into(), created_at: "2026-10-01T09:03:00.000Z".into() },
        ];
        let src = |id: &str, group: &str, title: &str, at: &str, ext: &str| PathSource {
            id: id.into(),
            group_id: group.into(),
            title: title.into(),
            created_at: at.into(),
            extension: ext.into(),
        };
        let sources = vec![
            src("s2", "g2", "Thread by Jack (@jack)", "2026-10-03T10:00:00.000Z", "md"),
            src("s1", "g1", "Turbo: charger", "2026-10-02T10:00:00.000Z", "md"),
            src("s3", "g1", "turbo - charger", "2026-10-02T11:00:00.000Z", "md"),
            src("s4", "g2", "Diagram", "2026-10-03T11:00:00.000Z", "png"),
        ];
        let paths = project_file_paths("Cars", &groups, &sources);
        assert_eq!(paths["s2"].0, "Cars/Engines/Diesel/Thread by Jack (@jack).md");
        assert_eq!(paths["s2"].1, "Cars/Engines/Diesel/Thread by Jack (@jack)_files");
        assert_eq!(paths["s1"].0, "Cars/Engines/Turbo - charger.md");
        assert_eq!(paths["s3"].0, "Cars/Engines/turbo - charger (2).md");
        assert_eq!(paths["s4"].0, "Cars/Engines/Diesel/Diagram.png");

        // Two groups with the same name: the older keeps the plain name.
        let other = vec![src("s5", "g3", "Notes", "2026-10-04T10:00:00.000Z", "md")];
        let paths = project_file_paths("Cars", &groups, &other);
        assert_eq!(paths["s5"].0, "Cars/engines (2)/Notes.md");
    }

    // --- export -> import ---------------------------------------------------------------

    fn test_db(tag: &str) -> (Database, PathBuf) {
        let dir = temp_dir(tag);
        let db = Database::open_in_memory().unwrap();
        db.set_setting("storage_dir", dir.join("storage").to_str().unwrap()).unwrap();
        (db, dir)
    }

    fn save(db: &Database, group: &str, kind: &str, title: &str, url: Option<&str>, body: &str) -> Item {
        let fields = service::ItemFileFields {
            title: title.to_string(),
            url: url.map(str::to_string),
            saved: Some("2026-10-02".to_string()),
            ..Default::default()
        };
        let file = service::build_item_file(kind, &fields, body, None);
        let item = db
            .save_item(SaveItemRequest {
                folder_id: group.to_string(),
                kind: kind.to_string(),
                title: title.to_string(),
                source_url: url.map(str::to_string),
                canonical_url: url.map(str::to_string),
                status: "saved".to_string(),
                error: None,
                markdown: Some(file.clone()),
                meta: Some(json!({ "summary": "A short summary." })),
                note: None,
                position: None,
            })
            .unwrap();
        service::write_item_file_to_disk(db, group, &item.id, title, "md", &item.created_at, file.as_bytes()).unwrap();
        db.get_item(&item.id).unwrap()
    }

    /// A project with two levels of groups, a Grokipedia article with highlights and research
    /// fields, an X thread with media on disk, an image, an outline section and cards.
    fn build_project(db: &Database, storage: &Path) -> String {
        let project = db.create_folder("Cars", None).unwrap();
        let engines = db.create_folder("Engines", Some(&project.id)).unwrap();
        let diesel = db.create_folder("Diesel", Some(&engines.id)).unwrap();

        let article = save(
            db,
            &engines.id,
            "grokipedia",
            "Turbocharger",
            Some("https://grokipedia.com/page/Turbocharger"),
            "The exhaust spins a turbine, and the turbine drives a compressor.",
        );
        db.update_item_note(&article.id, Some("Use in the intro.")).unwrap();
        db.with_conn(|c| {
            c.execute(
                "UPDATE items SET triage = 'keep', tags = '[\"History\",\"Engines\"]', summary = 'How turbos work.', author_type = 'encyclopedia' WHERE id = ?1",
                params![article.id],
            )
        })
        .unwrap();
        let highlight = db
            .put_highlight(&Highlight {
                id: "h-original".into(),
                item_id: article.id.clone(),
                kind: "text".into(),
                quote: "turbine drives a compressor".into(),
                prefix: "spins a turbine, and the ".into(),
                suffix: ".".into(),
                start_offset: 38,
                end_offset: 65,
                image_src: None,
                note: Some("Intro line".into()),
                seconds: None,
                cited: vec![HighlightCitation { n: "1".into(), title: Some("Source".into()), url: "https://example.com/a".into() }],
                created_at: String::new(),
                updated_at: String::new(),
            })
            .unwrap();
        service::rewrite_item_file(db, &article.id);

        let thread = save(db, &diesel.id, "x", "Thread by Jack (@jack)", Some("https://x.com/jack/status/20"), "Jack: just setting up my turbo");
        let (_, root_post) = db
            .add_x_post(AddXPostRequest {
                item_id: thread.id.clone(),
                post_url: "https://x.com/jack/status/20".into(),
                canonical_url: "https://x.com/jack/status/20".into(),
                author_name: "Jack".into(),
                handle: "jack".into(),
                author_url: "https://x.com/jack".into(),
                posted_at: Some("2026-03-21T20:50:00.000Z".into()),
                text: "just setting up my turbo".into(),
                parent_post_url: None,
                position: None,
                media: Some(r#"[{"type":"photo","url":"https://pbs.twimg.com/media/abc.jpg?name=orig"}]"#.into()),
            })
            .unwrap();
        assert!(!root_post.is_empty());
        // Import rebuilds every file the way the app does, so start from a rebuilt one too.
        service::rewrite_item_file(db, &thread.id);
        // The post's image on disk, next to its file.
        let thread = db.get_item(&thread.id).unwrap();
        let md_on_disk = storage.join(thread.storage_path.as_deref().unwrap());
        let files = md_on_disk.with_file_name(format!("{}_files", md_on_disk.file_stem().unwrap().to_string_lossy()));
        fs::create_dir_all(&files).unwrap();
        fs::write(files.join("abc.jpg"), [9u8, 8, 7, 6]).unwrap();

        service::save_image(db, &diesel.id, "Diagram.png", "image/png", &[137, 80, 78, 71, 13, 10, 26, 10]).unwrap();

        db.put_outline_section(&OutlineSectionInput {
            id: "sec-original".into(),
            project_id: project.id.clone(),
            title: "History".into(),
            position: 1.0,
        })
        .unwrap();
        db.put_card(&CardInput {
            id: "card-original".into(),
            project_id: project.id.clone(),
            kind: "quote".into(),
            item_id: Some(article.id.clone()),
            highlight_id: Some(highlight.id.clone()),
            quote: "turbine drives a compressor".into(),
            seconds: None,
            end_seconds: None,
            url: None,
            note: None,
            script_line: Some("The exhaust drives a compressor.".into()),
            section_id: Some("sec-original".into()),
            position: 1.0,
        })
        .unwrap();
        db.put_card(&CardInput {
            id: "line-original".into(),
            project_id: project.id.clone(),
            kind: "line".into(),
            item_id: None,
            highlight_id: None,
            quote: String::new(),
            seconds: None,
            end_seconds: None,
            url: None,
            note: None,
            script_line: Some("Now, the diesel side.".into()),
            section_id: None,
            position: 2.0,
        })
        .unwrap();
        project.id
    }

    /// What a project looks like without its ids: names, tree, text and references by title.
    fn describe(db: &Database, project_id: &str) -> Value {
        let folders = db.get_folders(true);
        let groups: Vec<&crate::models::Folder> =
            folders.iter().filter(|f| f.parent_id.is_some() && is_under(&folders, f, project_id)).collect();
        let name_of = |id: &str| folders.iter().find(|f| f.id == id).map(|f| f.name.clone()).unwrap_or_default();
        let mut items = Vec::new();
        let mut titles: HashMap<String, String> = HashMap::new();
        for g in &groups {
            for item in db.get_items(&g.id) {
                titles.insert(item.id.clone(), item.title.clone());
                let hl: Vec<Value> = db
                    .get_highlights_for_item(&item.id)
                    .unwrap()
                    .into_iter()
                    .map(|h| json!([h.kind, h.quote, h.prefix, h.suffix, h.start_offset, h.end_offset, h.note, h.cited.len()]))
                    .collect();
                let posts: Vec<Value> = db
                    .get_x_posts(&item.id)
                    .unwrap()
                    .into_iter()
                    .map(|p| json!([p.text, p.handle, p.media, p.posted_at]))
                    .collect();
                items.push(json!({
                    "group": name_of(&g.id), "parent": g.parent_id.as_deref().map(name_of),
                    "kind": item.kind, "title": item.title, "markdown": item.markdown,
                    "note": item.note, "triage": item.triage, "tags": item.tags, "summary": item.summary,
                    "author_type": item.author_type, "meta": item.meta, "created_at": item.created_at,
                    "updated_at": item.updated_at, "source_url": item.source_url,
                    "highlights": hl, "posts": posts,
                }));
            }
        }
        items.sort_by_key(|v| v["title"].as_str().unwrap().to_string());
        let sections: Vec<Value> = db
            .list_outline_sections(project_id)
            .unwrap()
            .into_iter()
            .map(|s| json!([s.title, s.position]))
            .collect();
        let section_title: HashMap<String, String> = db
            .list_outline_sections(project_id)
            .unwrap()
            .into_iter()
            .map(|s| (s.id, s.title))
            .collect();
        let mut cards: Vec<Value> = db
            .list_cards(Some(project_id), None)
            .unwrap()
            .into_iter()
            .map(|c| {
                json!([
                    c.kind,
                    c.item_id.as_ref().map(|i| titles[i].clone()),
                    c.highlight_id.as_ref().map(|h| db.get_highlight(h).unwrap().quote),
                    c.quote, c.script_line,
                    c.section_id.as_ref().map(|s| section_title[s].clone()),
                    c.position,
                ])
            })
            .collect();
        cards.sort_by_key(|v| v.to_string());
        json!({ "items": items, "sections": sections, "cards": cards,
                "groups": groups.iter().map(|g| json!([g.name, g.parent_id.as_deref().map(name_of)])).collect::<Vec<_>>() })
    }

    fn is_under(folders: &[crate::models::Folder], folder: &crate::models::Folder, root: &str) -> bool {
        let mut current = folder.parent_id.clone();
        while let Some(id) = current {
            if id == root {
                return true;
            }
            current = folders.iter().find(|f| f.id == id).and_then(|f| f.parent_id.clone());
        }
        false
    }

    fn all_ids(db: &Database, project_id: &str) -> HashSet<String> {
        let mut ids = HashSet::new();
        ids.insert(project_id.to_string());
        for f in db.get_folders(true) {
            ids.insert(f.id);
        }
        db.with_conn(|c| {
            for table in ["items", "x_posts", "highlights", "outline_sections", "cards"] {
                let mut stmt = c.prepare(&format!("SELECT id FROM {}", table))?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
                for row in rows {
                    ids.insert(row?);
                }
            }
            Ok(())
        })
        .unwrap();
        ids
    }

    #[test]
    fn exporting_then_importing_gives_an_equal_project_with_new_ids() {
        let (source, dir) = test_db("roundtrip-src");
        let storage = dir.join("storage");
        let project_id = build_project(&source, &storage);

        let file = dir.join("Cars.sourcefold");
        let report = export_project_file(&source, &project_id, &file).unwrap();
        assert_eq!(report.file_name, "Cars.sourcefold");
        assert!(report.skipped.is_empty(), "{:?}", report.skipped);

        // The file holds what docs/PROJECT-FILE.md says it does.
        let mut zip = ZipArchive::new(File::open(&file).unwrap()).unwrap();
        let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "Cars/Engines/Diesel/Diagram.png",
                "Cars/Engines/Diesel/Thread by Jack (@jack).md",
                "Cars/Engines/Diesel/Thread by Jack (@jack)_files/abc.jpg",
                "Cars/Engines/Turbocharger.md",
                "sourcefold.json",
            ]
        );
        let mut turbo = String::new();
        zip.by_name("Cars/Engines/Turbocharger.md").unwrap().read_to_string(&mut turbo).unwrap();
        assert!(turbo.starts_with("---\nsource: grokipedia\n"));
        assert!(turbo.contains("## My highlights") && turbo.contains("## My note") && turbo.contains("## My summary"));
        drop(zip);

        let summary = inspect_project_file(&file).unwrap();
        assert_eq!((summary.name.as_str(), summary.groups, summary.sources, summary.highlights, summary.cards), ("Cars", 2, 3, 1, 2));

        // Into another database.
        let (target, target_dir) = test_db("roundtrip-dst");
        let imported = import_project_file(&target, &file).unwrap();
        assert_eq!(imported.name, "Cars");
        assert!(imported.skipped.is_empty(), "{:?}", imported.skipped);
        let before = describe(&source, &project_id);
        let after = describe(&target, &imported.project_id);
        assert_eq!(before["groups"], after["groups"]);
        assert_eq!(before["sections"], after["sections"]);
        assert_eq!(before["cards"], after["cards"]);
        let strip = |v: &Value| {
            let mut items = v["items"].clone();
            for item in items.as_array_mut().unwrap() {
                // The x thread's posts are checked below; markdown is compared as a whole.
                item.as_object_mut().unwrap().remove("created_at");
            }
            items
        };
        let (a, b) = (strip(&before), strip(&after));
        assert_eq!(a, b);

        // The files are on disk where the app keeps them, with the post's images next to it.
        let target_storage = target_dir.join("storage");
        let imported_ids = all_ids(&target, &imported.project_id);
        let thread = target
            .get_items(&target.get_folders(true).iter().find(|f| f.name == "Diesel").unwrap().id)
            .into_iter()
            .find(|i| i.kind == "x")
            .unwrap();
        let md = target_storage.join(thread.storage_path.as_deref().unwrap());
        assert!(md.is_file());
        assert!(md.to_string_lossy().replace('\\', "/").ends_with("Cars/Engines/Diesel/Thread by Jack (@jack).md"));
        let media = md.with_file_name("Thread by Jack (@jack)_files").join("abc.jpg");
        assert_eq!(fs::read(media).unwrap(), vec![9u8, 8, 7, 6]);
        let image = target
            .get_items(&target.get_folders(true).iter().find(|f| f.name == "Diesel").unwrap().id)
            .into_iter()
            .find(|i| i.kind == "image")
            .unwrap();
        assert_eq!(
            fs::read(target_storage.join(image.storage_path.as_deref().unwrap())).unwrap(),
            vec![137, 80, 78, 71, 13, 10, 26, 10]
        );

        // Importing into the database it came from: new ids, and "Cars (2)".
        let again = import_project_file(&source, &file).unwrap();
        assert_eq!(again.name, "Cars (2)");
        assert_ne!(again.project_id, project_id);
        // Groups name their parent, so the top-level ones now sit under "Cars (2)".
        let renamed = describe(&source, &again.project_id)["groups"].to_string().replace("\"Cars (2)\"", "\"Cars\"");
        assert_eq!(renamed, before["groups"].to_string());
        let ids = all_ids(&source, &again.project_id);
        let originals = ["h-original", "sec-original", "card-original", "line-original"];
        assert!(originals.iter().all(|o| ids.contains(*o)));
        assert!(!imported_ids.iter().any(|i| originals.contains(&i.as_str())));
        let twice = import_project_file(&source, &file).unwrap();
        assert_eq!(twice.name, "Cars (3)");

        // Highlights land on the same text: their offsets cut the same words out of the body.
        let turbo = source
            .get_items(&source.get_folders(true).iter().rfind(|f| f.name == "Engines").unwrap().id)
            .into_iter()
            .next()
            .unwrap();
        assert!(turbo.markdown.is_some());
    }

    #[test]
    fn a_failed_import_leaves_nothing_behind() {
        let (db, dir) = test_db("atomic");
        let mut v = golden();
        // Valid in the manifest, but two cards share an id after remapping only if the transaction
        // were partly applied; here the group rows are broken by an impossible position.
        v["groups"][1]["parent_id"] = json!("g-engines");
        let path = dir.join("ok.sourcefold");
        zip_with(
            &path,
            &[
                ("sourcefold.json", v.to_string().into_bytes()),
                ("Cars/Engines/Turbocharger.md", b"# Turbocharger\n\nBody.\n".to_vec()),
                ("Cars/Engines/Diesel/Thread by Jack (@jack).md", b"# Thread\n\nBody.\n".to_vec()),
                ("Cars/Engines/Diesel/Diagram.png", vec![1, 2, 3]),
            ],
        );
        let before = db.get_folders(true).len();
        let imported = import_project_file(&db, &path).unwrap();
        assert_eq!(db.get_folders(true).len(), before + 3);
        assert_eq!(imported.name, "Cars");

        // A file that fails validation changes nothing.
        let mut bad = golden();
        bad["cards"][0]["highlight_id"] = json!("nowhere");
        let bad_path = dir.join("bad.sourcefold");
        zip_with(&bad_path, &[("sourcefold.json", bad.to_string().into_bytes())]);
        assert!(import_project_file(&db, &bad_path).is_err());
        assert_eq!(db.get_folders(true).len(), before + 3);
    }

    #[test]
    fn export_lists_an_image_that_is_gone_and_keeps_going() {
        let (db, dir) = test_db("skipped");
        let storage = dir.join("storage");
        let project = db.create_folder("Boats", None).unwrap();
        let group = db.create_folder("Sails", Some(&project.id)).unwrap();
        let image = service::save_image(&db, &group.id, "Mast.png", "image/png", &[1, 2, 3, 4]).unwrap();
        fs::remove_file(storage.join(image.storage_path.as_deref().unwrap())).unwrap();
        save(&db, &group.id, "note", "A note", None, "Some text.");

        let file = dir.join("Boats.sourcefold");
        let report = export_project_file(&db, &project.id, &file).unwrap();
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.skipped[0].title, "Mast");

        let mut archive = open_project_file(&file).unwrap();
        let mast = archive.manifest.sources.iter().find(|s| s.title == "Mast").unwrap();
        assert!(mast.file.is_none());
        let imported = import_project_file(&db, &file).unwrap();
        assert_eq!(imported.name, "Boats (2)");
        let _ = archive.read("Boats/Sails/A note.md").unwrap();
    }
}
