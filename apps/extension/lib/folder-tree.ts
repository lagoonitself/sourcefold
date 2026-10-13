import type { Folder } from "./api";

export interface FolderTreeItem {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  position: number;
  itemCount?: number;
}

export function buildFolderTree(folders: Folder[]): FolderTreeItem[] {
  const byParent = new Map<string | null, Folder[]>();
  const idSet = new Set<string>();

  for (const folder of folders) {
    idSet.add(folder.id);
  }

  for (const folder of folders) {
    const parentKey = folder.parent_id && idSet.has(folder.parent_id) ? folder.parent_id : null;
    const existing = byParent.get(parentKey) ?? [];
    existing.push(folder);
    byParent.set(parentKey, existing);
  }

  const sortFolders = (list: Folder[]) => {
    list.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.name.localeCompare(b.name);
    });
  };

  for (const list of byParent.values()) {
    sortFolders(list);
  }

  const result: FolderTreeItem[] = [];
  const visited = new Set<string>();

  function traverse(parentId: string | null, depth: number) {
    const children = byParent.get(parentId);
    if (!children) return;

    for (const child of children) {
      if (visited.has(child.id)) {
        continue;
      }
      visited.add(child.id);

      result.push({
        id: child.id,
        name: child.name,
        depth,
        parentId: child.parent_id,
        position: child.position,
        itemCount: child.item_count,
      });

      traverse(child.id, depth + 1);
    }
  }

  traverse(null, 0);

  for (const folder of folders) {
    if (!visited.has(folder.id)) {
      result.push({
        id: folder.id,
        name: folder.name,
        depth: 0,
        parentId: folder.parent_id,
        position: folder.position,
        itemCount: folder.item_count,
      });
      visited.add(folder.id);
    }
  }

  return result;
}

export function formatFolderLabel(name: string, depth: number): string {
  return "\u00A0\u00A0".repeat(depth) + name;
}
