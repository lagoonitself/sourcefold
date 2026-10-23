import {
  driveFileName,
  folderPathOf,
  itemExtension,
  type FolderRef,
  type SiblingItem,
} from "../drive/build-file";

// The desktop app keeps a copy of the library on disk (docs/FILE-FORMAT.md). This lists every
// file with the same path it has in Drive, and a version that changes whenever the file would.

export interface MirrorFolder extends FolderRef {
  updated_at: string;
}

export interface MirrorItem {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  status: string;
  meta: unknown;
  created_at: string;
  updated_at: string;
  /** Set once the file is in Drive; its Google Doc is made at the same time. */
  drive_file_id?: string | null;
  drive_synced_at?: string | null;
}

export interface MirrorEntry {
  /** Unique per file: the item id, or `<id>:docx` for its Word copy. */
  key: string;
  /** `file` is the item's own file; `docx` is the Word copy of a text file. */
  format: "file" | "docx";
  /** The item the file belongs to. */
  id: string;
  kind: string;
  /** The item's group, its project (the top-level folder) and its title, for the desktop's search
   * index, which keeps one index per project. */
  folder_id: string;
  project_id: string;
  title: string;
  /** Relative to the Sourcefold folder, `/`-separated, e.g. `Cars/Engines/Title.md`. */
  path: string;
  version: string;
}

function projectIdOf(folderId: string, foldersById: Map<string, FolderRef>): string {
  let current = foldersById.get(folderId);
  const visited = new Set<string>();
  while (current?.parent_id && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = foldersById.get(current.parent_id);
    if (!parent) break;
    current = parent;
  }
  return current?.id ?? folderId;
}

export function buildMirrorManifest(folders: MirrorFolder[], items: MirrorItem[]): MirrorEntry[] {
  const foldersById = new Map<string, FolderRef>(folders.map((f) => [f.id, f]));

  const siblingsByFolder = new Map<string, SiblingItem[]>();
  for (const item of items) {
    const list = siblingsByFolder.get(item.folder_id) ?? [];
    list.push(item);
    siblingsByFolder.set(item.folder_id, list);
  }

  const entries: MirrorEntry[] = [];
  for (const item of items) {
    // Only saved items have a file (the same rule as Drive). Paid posts that weren't saved don't.
    if (item.status !== "saved" || !foldersById.has(item.folder_id)) continue;
    const folderPath = folderPathOf(item.folder_id, foldersById);
    if (!folderPath) continue;
    const name = driveFileName(
      item.title,
      item.id,
      siblingsByFolder.get(item.folder_id) ?? [],
      itemExtension(item.kind, item.meta),
      item.created_at,
    );
    const path = `${folderPath}/${name}`;
    const owner = {
      folder_id: item.folder_id,
      project_id: projectIdOf(item.folder_id, foldersById),
      title: item.title,
    };
    // The front matter holds the folder path, so a rename up the tree changes the file too.
    entries.push({
      key: item.id,
      format: "file",
      id: item.id,
      kind: item.kind,
      ...owner,
      path,
      version: `${item.updated_at}|${path}`,
    });

    // Every text file that reached Drive also has a Google Doc there, exported as .docx. Its
    // version follows the Drive save, not the edit: the Doc only changes once it is pushed.
    if (item.kind !== "image" && item.drive_file_id) {
      const docxPath = path.replace(/\.md$/i, ".docx");
      entries.push({
        key: `${item.id}:docx`,
        format: "docx",
        id: item.id,
        kind: item.kind,
        ...owner,
        path: docxPath,
        version: `${item.drive_synced_at ?? item.updated_at}|${docxPath}`,
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
