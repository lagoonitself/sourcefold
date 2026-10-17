import { describe, expect, it } from "vitest";
import {
  buildFolderTree,
  buildProjectSections,
  pickGroupInProject,
  pickStartingPlace,
} from "./folder-tree";
import type { Folder } from "./api";

const folders: Folder[] = [
  { id: "p1", name: "Elon interview", parent_id: null, position: 0 },
  { id: "g1", name: "Background", parent_id: "p1", position: 0 },
  { id: "g2", name: "Clips", parent_id: "p1", position: 1 },
  { id: "g2a", name: "Shorts", parent_id: "g2", position: 0 },
  { id: "p2", name: "Robots", parent_id: null, position: 1 },
  { id: "g3", name: "Papers", parent_id: "p2", position: 0 },
  { id: "p3", name: "New video", parent_id: null, position: 2 },
];
const tree = buildFolderTree(folders);
const none = { groupId: null, projectId: null, groupByProject: {} };

describe("pickStartingPlace", () => {
  it("opens the first project with groups when nothing is remembered", () => {
    expect(pickStartingPlace(tree, none)).toEqual({ projectId: "p1", groupId: "g1" });
  });

  it("keeps the last open project, even one with no groups yet", () => {
    expect(pickStartingPlace(tree, { ...none, projectId: "p3", groupId: "g1" })).toEqual({
      projectId: "p3",
      groupId: "",
    });
  });

  it("opens the last used group inside the last project", () => {
    expect(pickStartingPlace(tree, { ...none, projectId: "p1", groupId: "g2a" })).toEqual({
      projectId: "p1",
      groupId: "g2a",
    });
  });

  it("uses the group remembered for the project when the last group is elsewhere", () => {
    expect(
      pickStartingPlace(tree, { projectId: "p2", groupId: "g1", groupByProject: { p2: "g3" } }),
    ).toEqual({ projectId: "p2", groupId: "g3" });
  });

  it("falls back to the last group's project when the last project is gone", () => {
    expect(pickStartingPlace(tree, { ...none, projectId: "deleted", groupId: "g3" })).toEqual({
      projectId: "p2",
      groupId: "g3",
    });
  });

  it("returns nothing for an empty library", () => {
    expect(pickStartingPlace([], none)).toEqual({ projectId: "", groupId: "" });
  });
});

describe("pickGroupInProject", () => {
  const [first] = buildProjectSections(tree);

  it("ignores a remembered group that no longer exists", () => {
    expect(pickGroupInProject(first!, { p1: "gone" })).toBe("g1");
  });

  it("returns the remembered group", () => {
    expect(pickGroupInProject(first!, { p1: "g2" })).toBe("g2");
  });
});
