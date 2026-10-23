import { findNode, type FolderNode } from "../folders/tree";

/**
 * A project is a top-level folder; groups are the folders inside it.
 * The last opened project is remembered in this cookie so "/" can reopen it.
 */
export const PROJECT_COOKIE = "sourcefold_project";

type FlatFolder = { id: string; parent_id: string | null };

export function findProjectNode(tree: FolderNode[], folderId: string | null): FolderNode | null {
  if (!folderId) return null;
  for (const project of tree) {
    if (project.id === folderId || findNode(project.children, folderId)) {
      return project;
    }
  }
  return null;
}

export function findProjectId(folders: FlatFolder[], folderId: string): string | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId);
  for (let depth = 0; current && depth < 1000; depth++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return null;
}

/** The project itself plus every group nested inside it. */
export function projectFolderIds(folders: FlatFolder[], projectId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parent_id) continue;
    const list = childrenOf.get(folder.parent_id) ?? [];
    list.push(folder.id);
    childrenOf.set(folder.parent_id, list);
  }

  const ids: string[] = [];
  const queue = [projectId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return ids;
}

export function rememberProject(projectId: string) {
  document.cookie = `${PROJECT_COOKIE}=${projectId}; path=/; max-age=31536000; samesite=lax`;
}
