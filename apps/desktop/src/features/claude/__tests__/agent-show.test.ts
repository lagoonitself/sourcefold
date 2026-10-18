import { describe, expect, it } from "vitest";
import type { Folder, Item } from "@/lib/types";
import { claudeStatusLine } from "../claude-status";
import { parseShowPayload, planShow, rootProjectId } from "../agent-show";

function folder(id: string, parent_id: string | null): Folder {
  return { id, parent_id, name: id, position: 0 };
}

function item(id: string, folder_id: string, kind: Item["kind"] = "web"): Item {
  return {
    id,
    folder_id,
    kind,
    title: id,
    source_url: null,
    status: "saved",
    meta: {},
    created_at: "2026-10-18T00:00:00Z",
  };
}

const folders = [
  folder("cars", null),
  folder("turbo", "cars"),
  folder("lag", "turbo"),
  folder("empty", null),
];

describe("parseShowPayload", () => {
  it("reads the three shapes the app sends", () => {
    expect(parseShowPayload({ group_id: "g" })).toEqual({ group_id: "g" });
    expect(parseShowPayload({ source_id: "s" })).toEqual({ source_id: "s" });
    expect(parseShowPayload({ source_id: "s", highlight_id: "h" })).toEqual({
      source_id: "s",
      highlight_id: "h",
    });
  });

  it("refuses anything else", () => {
    for (const bad of [
      null,
      "x",
      7,
      {},
      { group_id: "g", source_id: "s" },
      { highlight_id: "h" },
    ]) {
      expect(parseShowPayload(bad)).toBeNull();
    }
  });
});

describe("rootProjectId", () => {
  it("walks up to the project", () => {
    expect(rootProjectId(folders, "lag")).toBe("cars");
    expect(rootProjectId(folders, "cars")).toBe("cars");
    expect(rootProjectId(folders, "missing")).toBeNull();
  });
});

describe("planShow", () => {
  it("opens a group, switching project", () => {
    expect(planShow({ group_id: "lag" }, folders, null)).toEqual({
      ok: true,
      navigation: { projectId: "cars", groupId: "lag", focusItemId: null, reader: null },
    });
  });

  it("opens a project on its first group, or on none", () => {
    expect(planShow({ group_id: "cars" }, folders, null)).toMatchObject({
      ok: true,
      navigation: { projectId: "cars", groupId: "turbo" },
    });
    expect(planShow({ group_id: "empty" }, folders, null)).toMatchObject({
      ok: true,
      navigation: { projectId: "empty", groupId: null },
    });
  });

  it("reports an unknown group", () => {
    const plan = planShow({ group_id: "nope" }, folders, null);
    expect(plan).toEqual({ ok: false, message: expect.stringContaining("isn't there") });
  });

  it("opens a source in the reader, with a highlight when given", () => {
    const source = item("s1", "lag");
    expect(planShow({ source_id: "s1" }, folders, source)).toEqual({
      ok: true,
      navigation: {
        projectId: "cars",
        groupId: "lag",
        focusItemId: "s1",
        reader: { item: source, highlightId: null },
      },
    });
    const plan = planShow({ source_id: "s1", highlight_id: "h1" }, folders, source);
    expect(plan).toMatchObject({
      ok: true,
      navigation: { reader: { highlightId: "h1" } },
    });
  });

  it("only focuses a source the reader can't show", () => {
    const image = item("i1", "turbo", "image");
    expect(planShow({ source_id: "i1" }, folders, image)).toMatchObject({
      ok: true,
      navigation: { groupId: "turbo", focusItemId: "i1", reader: null },
    });
  });

  it("reports a missing source or a source outside the known folders", () => {
    expect(planShow({ source_id: "s1" }, folders, null).ok).toBe(false);
    expect(planShow({ source_id: "s1" }, folders, item("other", "lag")).ok).toBe(false);
    expect(planShow({ source_id: "s1" }, folders, item("s1", "gone")).ok).toBe(false);
    // Sources never live directly in a project.
    expect(planShow({ source_id: "s1" }, folders, item("s1", "cars")).ok).toBe(false);
  });
});

describe("claudeStatusLine", () => {
  it("says whose sign-in Claude uses", () => {
    expect(claudeStatusLine({ signedIn: true, offline: false, email: "me@example.com" })).toEqual({
      ok: true,
      text: "Claude uses this app's sign-in (me@example.com).",
    });
  });

  it("says offline mode isn't supported yet", () => {
    const line = claudeStatusLine({ signedIn: false, offline: true, email: null });
    expect(line.ok).toBe(false);
    expect(line.text).toContain("Claude works with a signed-in library for now.");
  });
});
