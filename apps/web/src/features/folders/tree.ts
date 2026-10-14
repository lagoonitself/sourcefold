export type FolderNode = {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  itemCount: number;
  /** True only for an archived project. */
  archived?: boolean;
  children: FolderNode[];
};

export type FolderInputRow = {
  id: string;
  parent_id?: string | null;
  parentId?: string | null;
  name: string;
  position: number;
  item_count?: number;
  itemCount?: number;
  archived?: boolean;
};

export function buildFolderTree(rows: FolderInputRow[]): FolderNode[] {
  const nodeMap = new Map<string, FolderNode>();

  for (const row of rows) {
    const parentId = row.parentId !== undefined ? row.parentId : (row.parent_id ?? null);
    const itemCount = row.itemCount !== undefined ? row.itemCount : (row.item_count ?? 0);
    nodeMap.set(row.id, {
      id: row.id,
      parentId,
      name: row.name,
      position: row.position,
      itemCount,
      archived: row.archived ?? false,
      children: [],
    });
  }

  const rootNodes: FolderNode[] = [];

  for (const node of nodeMap.values()) {
    if (node.parentId && nodeMap.has(node.parentId)) {
      nodeMap.get(node.parentId)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }

  function sortNodes(nodes: FolderNode[]) {
    nodes.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      sortNodes(node.children);
    }
  }

  sortNodes(rootNodes);
  return rootNodes;
}

export function findNode(tree: FolderNode[], id: string): FolderNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function descendantIds(tree: FolderNode[], id: string): string[] {
  const target = findNode(tree, id);
  if (!target) return [];

  const ids: string[] = [];
  function collect(node: FolderNode) {
    for (const child of node.children) {
      ids.push(child.id);
      collect(child);
    }
  }
  collect(target);
  return ids;
}

export function getAncestorIds(tree: FolderNode[], targetId: string): string[] {
  const path: string[] = [];
  function search(nodes: FolderNode[]): boolean {
    for (const node of nodes) {
      if (node.id === targetId) {
        return true;
      }
      if (search(node.children)) {
        path.push(node.id);
        return true;
      }
    }
    return false;
  }
  search(tree);
  return path;
}
