use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub position: i32,
    pub archived_at: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub item_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Item {
    pub id: String,
    pub folder_id: String,
    pub kind: String, // grokipedia | substack | x | note | image
    pub title: String,
    pub source_url: Option<String>,
    pub canonical_url: Option<String>,
    pub status: String, // pending | saved | failed | unavailable
    pub error: Option<String>,
    pub markdown: Option<String>,
    pub meta: serde_json::Value,
    pub note: Option<String>,
    pub position: i32,
    pub storage_path: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triage: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_type: Option<String>,
}

fn default_media() -> String {
    "[]".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct XPost {
    pub id: String,
    pub item_id: String,
    pub parent_id: Option<String>,
    pub post_url: String,
    pub canonical_url: String,
    pub author_name: String,
    pub handle: String,
    pub author_url: String,
    pub posted_at: Option<String>,
    pub text: String,
    pub position: i32,
    #[serde(default = "default_media")]
    pub media: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CheckUrlResult {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elsewhere: Option<Elsewhere>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveItemRequest {
    pub folder_id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub canonical_url: Option<String>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub markdown: Option<String>,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub position: Option<i32>,
}

fn default_status() -> String {
    "saved".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddXPostRequest {
    pub item_id: String,
    pub post_url: String,
    #[serde(default)]
    pub canonical_url: String,
    pub author_name: String,
    pub handle: String,
    pub author_url: String,
    #[serde(default)]
    pub posted_at: Option<String>,
    pub text: String,
    #[serde(default)]
    pub parent_post_url: Option<String>,
    #[serde(default)]
    pub position: Option<i32>,
    #[serde(default)]
    pub media: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RecentXItem {
    pub id: String,
    pub title: String,
    pub folder_id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SavedItem {
    pub id: String,
    pub folder_id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    pub status: String,
    pub created_at: String,
}

impl From<Item> for SavedItem {
    fn from(item: Item) -> Self {
        Self {
            id: item.id,
            folder_id: item.folder_id,
            kind: item.kind,
            title: item.title,
            source_url: item.source_url,
            status: item.status,
            created_at: item.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FolderTreeItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub position: i32,
    pub item_count: i64,
    pub archived: bool,
    pub children: Vec<FolderTreeItem>,
}

impl FolderTreeItem {
    pub fn from_folder(folder: &Folder) -> Self {
        Self {
            id: folder.id.clone(),
            parent_id: folder.parent_id.clone(),
            name: folder.name.clone(),
            position: folder.position,
            item_count: folder.item_count.unwrap_or(0),
            archived: folder.archived_at.is_some(),
            children: Vec::new(),
        }
    }

    pub fn build_tree(folders: &[Folder], root_parent_id: Option<&str>) -> Vec<FolderTreeItem> {
        let mut roots: Vec<FolderTreeItem> = folders
            .iter()
            .filter(|f| f.parent_id.as_deref() == root_parent_id)
            .map(FolderTreeItem::from_folder)
            .collect();

        roots.sort_by_key(|f| f.position);

        for root in &mut roots {
            root.children = Self::build_tree(folders, Some(&root.id));
        }

        roots
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub storage_dir: String,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub native_host_installed: Option<bool>,
    #[serde(default)]
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeHostStatus {
    pub installed: bool,
    pub manifest_path: Option<String>,
    pub host_path: Option<String>,
    pub message: Option<String>,
}

// -----------------------------------------------------------------------------
// Highlights (contract: docs/dev/handoff-highlights.md)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HighlightCitation {
    pub n: String,
    #[serde(default)]
    pub title: Option<String>,
    pub url: String,
}

/// Mirrors `Highlight` in packages/core/src/highlights.ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Highlight {
    pub id: String,
    pub item_id: String,
    pub kind: String, // text | image
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub start_offset: i64,
    pub end_offset: i64,
    #[serde(default)]
    pub image_src: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub seconds: Option<i64>,
    #[serde(default)]
    pub cited: Vec<HighlightCitation>,
    pub created_at: String,
    pub updated_at: String,
}

/// What the client sends to create or replace a highlight (`HighlightInput`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HighlightInput {
    pub id: String,
    pub item_id: String,
    pub kind: String,
    pub quote: String,
    pub prefix: String,
    pub suffix: String,
    pub start_offset: i64,
    pub end_offset: i64,
    #[serde(default)]
    pub image_src: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub seconds: Option<i64>,
    #[serde(default)]
    pub cited: Vec<HighlightCitation>,
}

// -----------------------------------------------------------------------------
// Research tools (docs/dev/handoff-research.md)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Elsewhere {
    pub item_id: String,
    pub folder_id: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ItemResearchPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triage: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<Option<String>>,
    #[serde(default, alias = "authorType", skip_serializing_if = "Option::is_none")]
    pub author_type: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MergeResult {
    pub item: Item,
    pub moved_highlights: i64,
    pub moved_cards: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutlineSection {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutlineSectionInput {
    pub id: String,
    #[serde(alias = "projectId")]
    pub project_id: String,
    pub title: String,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Card {
    pub id: String,
    pub project_id: String,
    pub kind: String, // quote | broll | line
    #[serde(default)]
    pub item_id: Option<String>,
    #[serde(default)]
    pub highlight_id: Option<String>,
    pub quote: String,
    #[serde(default)]
    pub seconds: Option<i64>,
    #[serde(default)]
    pub end_seconds: Option<i64>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub script_line: Option<String>,
    #[serde(default)]
    pub section_id: Option<String>,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardInput {
    pub id: String,
    #[serde(alias = "projectId")]
    pub project_id: String,
    pub kind: String,
    #[serde(default, alias = "itemId")]
    pub item_id: Option<String>,
    #[serde(default, alias = "highlightId")]
    pub highlight_id: Option<String>,
    #[serde(default)]
    pub quote: String,
    #[serde(default)]
    pub seconds: Option<i64>,
    #[serde(default, alias = "endSeconds")]
    pub end_seconds: Option<i64>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default, alias = "scriptLine")]
    pub script_line: Option<String>,
    #[serde(default, alias = "sectionId")]
    pub section_id: Option<String>,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CardPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seconds: Option<Option<i64>>,
    #[serde(default, alias = "endSeconds", skip_serializing_if = "Option::is_none")]
    pub end_seconds: Option<Option<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Option<String>>,
    #[serde(default, alias = "scriptLine", skip_serializing_if = "Option::is_none")]
    pub script_line: Option<Option<String>>,
    #[serde(default, alias = "sectionId", skip_serializing_if = "Option::is_none")]
    pub section_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
}
