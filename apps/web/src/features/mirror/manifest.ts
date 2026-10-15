import {
  driveFileName,
  folderPathOf,
  itemExtension,
  type FolderRef,
  type SiblingItem,
} from "@/features/drive/build-file";

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
}

export interface MirrorEntry {
  id: string;
  kind: string;
  /** Relative to the Sourcefold folder, `/`-separated, e.g. `Cars/Engines/Title.md`. */
  path: string;
  version: string;
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
    // The front matter holds the folder path, so a rename up the tree changes the file too.
    entries.push({ id: item.id, kind: item.kind, path, version: `${item.updated_at}|${path}` });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}
