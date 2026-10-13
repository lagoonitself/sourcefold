import { type FolderNode, findNode, descendantIds } from "./tree";

export type FolderPatchUpdate = {
  id: string;
  body: {
    position?: number;
    parent_id?: string | null;
  };
};

export type ReorderResult = {
  newTree: FolderNode[];
  updates: FolderPatchUpdate[];
  targetParentId: string | null;
};

/**
 * Returns direct siblings under parentId (or root nodes if parentId is null).
 */
export function getSiblings(tree: FolderNode[], parentId: string | null): FolderNode[] {
  if (parentId === null) {
    return tree;
  }
  const parent = findNode(tree, parentId);
  return parent ? parent.children : [];
}

/**
 * Immutably removes a node from anywhere in the tree.
 */
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

/**
 * Immutably replaces the children of targetParentId (or the root tree if null)
 * with the new sibling array.
 */
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

/**
 * Immutably moves a folder inside targetParentId as its last child (or to root).
 */
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
  const updatedActive: FolderNode = {
    ...activeNode,
    parentId: targetParentId,
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

/**
 * Reorders a tree by inserting activeId before or after targetId.
 * Computes the new tree and the sequential updates required for the server.
 */
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

  // Cannot move into own descendant or itself
  const descendants = descendantIds(tree, activeId);
  if (descendants.includes(targetId)) return null;

  const targetParentId = targetNode.parentId;
  if (
    targetParentId !== null &&
    (targetParentId === activeId || descendants.includes(targetParentId))
  ) {
    return null;
  }

  // 1. Remove active node from tree
  const treeWithoutActive = removeNodeFromTree(tree, activeId);

  // 2. Get target siblings from the tree without active node
  const targetSiblings = getSiblings(treeWithoutActive, targetParentId);
  const targetIndex = targetSiblings.findIndex((s) => s.id === targetId);
  if (targetIndex === -1) return null;

  const insertIndex = zone === "before" ? targetIndex : targetIndex + 1;

  // 3. Create moved node with updated parentId
  const movedNode: FolderNode = {
    ...activeNode,
    parentId: targetParentId,
  };

  // 4. Insert into siblings at insertIndex
  const reorderedSiblings: FolderNode[] = [
    ...targetSiblings.slice(0, insertIndex),
    movedNode,
    ...targetSiblings.slice(insertIndex),
  ];

  // 5. Renumber positions: 0, 1, 2, ...
  const reorderedWithPositions: FolderNode[] = reorderedSiblings.map((node, index) => ({
    ...node,
    position: index,
  }));

  // 6. Compute updates for server
  const parentChanged = activeNode.parentId !== targetParentId;
  const updates: FolderPatchUpdate[] = [];

  for (let i = 0; i < reorderedWithPositions.length; i++) {
    const sibling = reorderedWithPositions[i];
    if (sibling.id === activeId) {
      const positionChanged = activeNode.position !== i;
      if (parentChanged || positionChanged) {
        const body: FolderPatchUpdate["body"] = {
          position: i,
        };
        if (parentChanged) {
          body.parent_id = targetParentId;
        }
        updates.push({ id: activeId, body });
      }
    } else {
      const originalNode = findNode(tree, sibling.id);
      const positionChanged = originalNode ? originalNode.position !== i : true;
      if (positionChanged) {
        updates.push({
          id: sibling.id,
          body: { position: i },
        });
      }
    }
  }

  // Ensure moved folder is patched first if its parent changed
  if (parentChanged) {
    updates.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0));
  }

  // 7. Insert reordered siblings into the tree
  const newTree = replaceSiblingsInTree(treeWithoutActive, targetParentId, reorderedWithPositions);

  return {
    newTree,
    updates,
    targetParentId,
  };
}
