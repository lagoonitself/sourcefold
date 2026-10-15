import { describe, expect, it } from "vitest";
import type { FolderNode } from "@/lib/types";
import {
  canMoveOutToParent,
  canNestUnderPreviousSibling,
  flattenVisibleTree,
  getNextSibling,
  getParentNode,
  getPreviousSibling,
  reorderSibling,
  resolveInlineRename,
} from "../tree-utils";

describe("tree-navigation helpers", () => {
  const sampleTree: FolderNode[] = [
    {
      id: "proj-1",
      parentId: null,
      name: "Project 1",
      position: 0,
      itemCount: 0,
      archived: false,
      children: [
        {
          id: "group-1",
          parentId: "proj-1",
          name: "Group 1",
          position: 0,
          itemCount: 2,
          archived: false,
          children: [
            {
              id: "subgroup-1",
              parentId: "group-1",
              name: "Subgroup 1",
              position: 0,
              itemCount: 0,
              archived: false,
              children: [],
            },
          ],
        },
        {
          id: "group-2",
          parentId: "proj-1",
          name: "Group 2",
          position: 1,
          itemCount: 1,
          archived: false,
          children: [],
        },
        {
          id: "group-3",
          parentId: "proj-1",
          name: "Group 3",
          position: 2,
          itemCount: 0,
          archived: false,
          children: [],
        },
      ],
    },
  ];

  it("flattens visible tree respecting expanded nodes", () => {
    // Only group-1 expanded
    const expanded = new Set(["proj-1", "group-1"]);
    const visible = flattenVisibleTree(sampleTree, expanded);
    expect(visible.map((n) => n.id)).toEqual([
      "proj-1",
      "group-1",
      "subgroup-1",
      "group-2",
      "group-3",
    ]);

    // group-1 collapsed
    const collapsed = new Set(["proj-1"]);
    const visibleCollapsed = flattenVisibleTree(sampleTree, collapsed);
    expect(visibleCollapsed.map((n) => n.id)).toEqual(["proj-1", "group-1", "group-2", "group-3"]);
  });

  it("finds previous and next siblings", () => {
    expect(getPreviousSibling(sampleTree, "group-1")).toBeNull();
    expect(getPreviousSibling(sampleTree, "group-2")?.id).toBe("group-1");
    expect(getNextSibling(sampleTree, "group-2")?.id).toBe("group-3");
    expect(getNextSibling(sampleTree, "group-3")).toBeNull();
  });

  it("gets parent node", () => {
    expect(getParentNode(sampleTree, "subgroup-1")?.id).toBe("group-1");
    expect(getParentNode(sampleTree, "group-1")?.id).toBe("proj-1");
    expect(getParentNode(sampleTree, "proj-1")).toBeNull();
  });

  it("evaluates canNestUnderPreviousSibling", () => {
    const nest1 = canNestUnderPreviousSibling(sampleTree, "group-1");
    expect(nest1.canNest).toBe(false);

    const nest2 = canNestUnderPreviousSibling(sampleTree, "group-2");
    expect(nest2.canNest).toBe(true);
    expect(nest2.prevSibling?.id).toBe("group-1");
  });

  it("evaluates canMoveOutToParent", () => {
    // Top-level group under project cannot move out to become a root project
    const topGroup = canMoveOutToParent(sampleTree, "proj-1", "group-1");
    expect(topGroup.canMoveOut).toBe(false);

    // Subgroup can move out to grandparent (which is proj-1)
    const subgroup = canMoveOutToParent(sampleTree, "proj-1", "subgroup-1");
    expect(subgroup.canMoveOut).toBe(true);
    expect(subgroup.targetParentId).toBe("proj-1");
  });

  it("reorders siblings up and down", () => {
    // group-2 up -> swaps with group-1
    const reorderUp = reorderSibling(sampleTree, "group-2", "up");
    expect(reorderUp).not.toBeNull();
    expect(reorderUp?.updates).toEqual([
      { id: "group-2", position: 0 },
      { id: "group-1", position: 1 },
    ]);

    // group-1 up -> null (already first)
    expect(reorderSibling(sampleTree, "group-1", "up")).toBeNull();

    // group-2 down -> swaps with group-3
    const reorderDown = reorderSibling(sampleTree, "group-2", "down");
    expect(reorderDown).not.toBeNull();
    expect(reorderDown?.updates).toEqual([
      { id: "group-2", position: 2 },
      { id: "group-3", position: 1 },
    ]);

    // group-3 down -> null (already last)
    expect(reorderSibling(sampleTree, "group-3", "down")).toBeNull();
  });
});

describe("resolveInlineRename", () => {
  it("saves the row that is being renamed, not its top-level ancestor", () => {
    // Renaming subgroup "sub-1" while "proj-1" is the top-level node of the tree.
    expect(resolveInlineRename("sub-1", "sub-1", "  Renamed  ", "Old")).toEqual({
      id: "sub-1",
      name: "Renamed",
    });
  });

  it("ignores a save for any other row", () => {
    expect(resolveInlineRename("sub-1", "proj-1", "Renamed", "Old")).toBeNull();
  });

  it("does nothing after the rename was already saved or cancelled", () => {
    expect(resolveInlineRename(null, "sub-1", "Renamed", "Old")).toBeNull();
  });

  it("skips empty and unchanged names", () => {
    expect(resolveInlineRename("sub-1", "sub-1", "   ", "Old")).toBeNull();
    expect(resolveInlineRename("sub-1", "sub-1", "Old", "Old")).toBeNull();
  });
});
