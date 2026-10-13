export interface FolderPathNode {
  id: string;
  parent_id: string | null;
  name: string;
}

/**
 * Builds a map from folder id to the path of folder names from the top level down to it.
 * Guards against cycles with a depth limit of 100.
 */
export function buildFolderPaths(folders: FolderPathNode[]): Map<string, string[]> {
  const folderMap = new Map<string, FolderPathNode>();
  for (const folder of folders) {
    folderMap.set(folder.id, folder);
  }

  const result = new Map<string, string[]>();

  for (const folder of folders) {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: FolderPathNode | undefined = folder;
    let depth = 0;

    while (current && depth < 100) {
      if (visited.has(current.id)) {
        break;
      }
      visited.add(current.id);
      names.push(current.name);
      depth++;

      if (!current.parent_id) {
        break;
      }
      current = folderMap.get(current.parent_id);
    }

    names.reverse();
    result.set(folder.id, names);
  }

  return result;
}
