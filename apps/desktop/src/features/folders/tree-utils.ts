import type { Folder, FolderNode } from "@/lib/types";

export type FolderInputRow = {
  id: string;
  parent_id?: string | null;
  parentId?: string | null;
  name: string;
  position: number;
  item_count?: number | null;
  itemCount?: number;
  archived?: boolean;
  archived_at?: string | null;
};

export function buildFolderTree(rows: (Folder | FolderInputRow)[]): FolderNode[] {
  const nodeMap = new Map<string, FolderNode>();

  for (const row of rows) {
    const parentId =
      "parentId" in row && row.parentId !== undefined ? row.parentId : (row.parent_id ?? null);
    const itemCount =
      "itemCount" in row && row.itemCount !== undefined
        ? row.itemCount
        : (row.item_count ?? 0) || 0;
    const archived =
      "archived" in row && row.archived !== undefined ? row.archived : Boolean(row.archived_at);

    nodeMap.set(row.id, {
      id: row.id,
      parentId,
      name: row.name,
      position: row.position ?? 0,
      itemCount,
      archived,
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

export function getSiblings(tree: FolderNode[], parentId: string | null): FolderNode[] {
  if (parentId === null) {
    return tree;
  }
  const parent = findNode(tree, parentId);
  return parent ? parent.children : [];
}

export function removeNodeFromTree(nodes: FolderNode[], idToRemove: string): FolderNode[] {
  const result: FolderNode[] = [];
  for (const node of nodes) {
    if (node.id === idToRemove) {
      continue;
    }
    if (node.children.length > 0) {
      result.push({
        ...node,
        children: removeNodeFromTree(node.children, idToRemove),
      });
    } else {
      result.push(node);
    }
  }
  return result;
}

export function replaceSiblingsInTree(
  tree: FolderNode[],
  targetParentId: string | null,
  newSiblings: FolderNode[],
): FolderNode[] {
  if (targetParentId === null) {
    return newSiblings;
  }

  function updateNodes(nodes: FolderNode[]): FolderNode[] {
    return nodes.map((node) => {
      if (node.id === targetParentId) {
        return {
          ...node,
          children: newSiblings,
        };
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: updateNodes(node.children),
        };
      }
      return node;
    });
  }

  return updateNodes(tree);
}

export function moveFolderInside(
  tree: FolderNode[],
  activeId: string,
  targetParentId: string | null,
): FolderNode[] {
  const activeNode = findNode(tree, activeId);
  if (!activeNode) return tree;

  const descendants = descendantIds(tree, activeId);
  if (
    targetParentId !== null &&
    (targetParentId === activeId || descendants.includes(targetParentId))
  ) {
    return tree;
  }

  const treeWithoutActive = removeNodeFromTree(tree, activeId);
  const targetSiblings = getSiblings(treeWithoutActive, targetParentId);
  const nextPosition = targetSiblings.length;

  const updatedActive: FolderNode = {
    ...activeNode,
    parentId: targetParentId,
    position: nextPosition,
  };

  if (targetParentId === null) {
    return [...treeWithoutActive, updatedActive];
  }

  function attachToParent(nodes: FolderNode[]): FolderNode[] {
    return nodes.map((node) => {
      if (node.id === targetParentId) {
        return {
          ...node,
          children: [...node.children, updatedActive],
        };
      }
      if (node.children.length > 0) {
        return {
          ...node,
          children: attachToParent(node.children),
        };
      }
      return node;
    });
  }

  return attachToParent(treeWithoutActive);
}

export type FolderPatchUpdate = {
  id: string;
  position?: number;
  parent_id?: string | null;
};

export type ReorderResult = {
  newTree: FolderNode[];
  updates: FolderPatchUpdate[];
  targetParentId: string | null;
};

export function reorderTreeNodes(
  tree: FolderNode[],
  activeId: string,
  targetId: string,
  zone: "before" | "after",
): ReorderResult | null {
  if (activeId === targetId) return null;

  const activeNode = findNode(tree, activeId);
  const targetNode = findNode(tree, targetId);
  if (!activeNode || !targetNode) return null;

  const descendants = descendantIds(tree, activeId);
  if (descendants.includes(targetId)) return null;

  const targetParentId = targetNode.parentId;
  if (
    targetParentId !== null &&
    (targetParentId === activeId || descendants.includes(targetParentId))
  ) {
    return null;
  }

  const treeWithoutActive = removeNodeFromTree(tree, activeId);
  const targetSiblings = getSiblings(treeWithoutActive, targetParentId);
  const targetIndex = targetSiblings.findIndex((s) => s.id === targetId);
  if (targetIndex === -1) return null;

  const insertIndex = zone === "before" ? targetIndex : targetIndex + 1;

  const movedNode: FolderNode = {
    ...activeNode,
    parentId: targetParentId,
  };

  const reorderedSiblings: FolderNode[] = [
    ...targetSiblings.slice(0, insertIndex),
    movedNode,
    ...targetSiblings.slice(insertIndex),
  ];

  const reorderedWithPositions: FolderNode[] = reorderedSiblings.map((node, index) => ({
    ...node,
    position: index,
  }));

  const parentChanged = activeNode.parentId !== targetParentId;
  const updates: FolderPatchUpdate[] = [];

  for (let i = 0; i < reorderedWithPositions.length; i++) {
    const sibling = reorderedWithPositions[i];
    if (sibling.id === activeId) {
      const positionChanged = activeNode.position !== i;
      if (parentChanged || positionChanged) {
        updates.push({
          id: activeId,
          position: i,
          parent_id: parentChanged ? targetParentId : undefined,
        });
      }
    } else {
      const originalNode = findNode(tree, sibling.id);
      const positionChanged = originalNode ? originalNode.position !== i : true;
      if (positionChanged) {
        updates.push({
          id: sibling.id,
          position: i,
        });
      }
    }
  }

  if (parentChanged) {
    updates.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  }

  const newTree = replaceSiblingsInTree(treeWithoutActive, targetParentId, reorderedWithPositions);

  return {
    newTree,
    updates,
    targetParentId,
  };
}

export function flattenVisibleTree(nodes: FolderNode[], expandedIds: Set<string>): FolderNode[] {
  const result: FolderNode[] = [];
  function traverse(list: FolderNode[]) {
    for (const node of list) {
      result.push(node);
      if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
        traverse(node.children);
      }
    }
  }
  traverse(nodes);
  return result;
}

export function getParentNode(tree: FolderNode[], nodeId: string): FolderNode | null {
  const target = findNode(tree, nodeId);
  if (!target || !target.parentId) return null;
  return findNode(tree, target.parentId);
}

export function getPreviousSibling(tree: FolderNode[], nodeId: string): FolderNode | null {
  const target = findNode(tree, nodeId);
  if (!target) return null;
  const siblings = getSiblings(tree, target.parentId);
  const index = siblings.findIndex((s) => s.id === nodeId);
  if (index > 0) return siblings[index - 1];
  return null;
}

export function getNextSibling(tree: FolderNode[], nodeId: string): FolderNode | null {
  const target = findNode(tree, nodeId);
  if (!target) return null;
  const siblings = getSiblings(tree, target.parentId);
  const index = siblings.findIndex((s) => s.id === nodeId);
  if (index >= 0 && index < siblings.length - 1) return siblings[index + 1];
  return null;
}

export function canNestUnderPreviousSibling(
  tree: FolderNode[],
  nodeId: string,
): { canNest: boolean; prevSibling: FolderNode | null } {
  const prevSibling = getPreviousSibling(tree, nodeId);
  if (!prevSibling) return { canNest: false, prevSibling: null };
  return { canNest: true, prevSibling };
}

export function canMoveOutToParent(
  tree: FolderNode[],
  projectId: string,
  nodeId: string,
): { canMoveOut: boolean; targetParentId: string | null; error?: string } {
  const node = findNode(tree, nodeId);
  if (!node) return { canMoveOut: false, targetParentId: null, error: "Node not found" };

  if (node.parentId === projectId || node.parentId === null) {
    return {
      canMoveOut: false,
      targetParentId: null,
      error: "Group is already at the top level of this project",
    };
  }

  const parent = findNode(tree, node.parentId);
  if (!parent) {
    return { canMoveOut: false, targetParentId: null, error: "Parent not found" };
  }

  const targetParentId = parent.parentId ?? projectId;
  return { canMoveOut: true, targetParentId };
}

export function reorderSibling(
  tree: FolderNode[],
  nodeId: string,
  direction: "up" | "down",
): { updates: FolderPatchUpdate[] } | null {
  const node = findNode(tree, nodeId);
  if (!node) return null;

  const siblings = getSiblings(tree, node.parentId);
  const currentIndex = siblings.findIndex((s) => s.id === nodeId);
  if (currentIndex === -1) return null;

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return null;

  const targetSibling = siblings[targetIndex];

  return {
    updates: [
      { id: node.id, position: targetIndex },
      { id: targetSibling.id, position: currentIndex },
    ],
  };
}

/**
 * Decides what an inline rename should save. `activeRenameId` is the row currently being renamed
 * (a ref, so blur after Enter/Escape sees it already cleared). Returns null when there is nothing
 * to save: a different row, an emptied input, or an unchanged name.
 */
export function resolveInlineRename(
  activeRenameId: string | null,
  nodeId: string,
  draftName: string,
  currentName: string,
): { id: string; name: string } | null {
  if (activeRenameId !== nodeId) return null;
  const name = draftName.trim();
  if (!name || name === currentName) return null;
  return { id: nodeId, name };
}
