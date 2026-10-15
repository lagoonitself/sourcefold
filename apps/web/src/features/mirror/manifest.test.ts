import { describe, expect, it } from "vitest";
import { buildMirrorManifest, type MirrorFolder, type MirrorItem } from "./manifest";

const folders: MirrorFolder[] = [
  { id: "p", parent_id: null, name: "Cars", updated_at: "2026-10-01T00:00:00Z" },
  { id: "g", parent_id: "p", name: "Engines: V8", updated_at: "2026-10-01T00:00:00Z" },
];

function item(over: Partial<MirrorItem>): MirrorItem {
  return {
    id: "i1",
    folder_id: "g",
    kind: "grokipedia",
    title: "Turbo",
    status: "saved",
    meta: {},
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
    ...over,
  };
}

describe("buildMirrorManifest", () => {
  it("uses the Drive layout: real folder names, title as file name", () => {
    expect(buildMirrorManifest(folders, [item({})])).toEqual([
      {
        key: "i1",
        format: "file",
        id: "i1",
        kind: "grokipedia",
        path: "Cars/Engines - V8/Turbo.md",
        version: "2026-10-03T00:00:00Z|Cars/Engines - V8/Turbo.md",
      },
    ]);
  });

  it("numbers clashing names in creation order and keeps image extensions", () => {
    const files = buildMirrorManifest(folders, [
      item({ id: "b", created_at: "2026-10-05T00:00:00Z" }),
      item({ id: "a", created_at: "2026-10-04T00:00:00Z" }),
      item({ id: "img", kind: "image", meta: { file_name: "x.PNG", mime_type: "image/png" } }),
    ]);
    expect(Object.fromEntries(files.map((f) => [f.id, f.path]))).toEqual({
      a: "Cars/Engines - V8/Turbo.md",
      b: "Cars/Engines - V8/Turbo (2).md",
      img: "Cars/Engines - V8/Turbo.png",
    });
  });

  it("leaves out unsaved items and items whose folder is gone", () => {
    const files = buildMirrorManifest(folders, [
      item({ id: "paid", status: "unavailable" }),
      item({ id: "orphan", folder_id: "deleted" }),
    ]);
    expect(files).toEqual([]);
  });
});

describe("buildMirrorManifest, Word copies", () => {
  const pushed = { drive_file_id: "d1", drive_synced_at: "2026-10-04T00:00:00Z" };

  it("adds a .docx entry for each text file that reached Drive", () => {
    const files = buildMirrorManifest(folders, [
      item({ ...pushed }),
      item({ id: "note", kind: "note", title: "Idea", ...pushed }),
    ]);
    // Sorted by path, so a post's .docx comes before its .md; compare by key.
    expect([...files].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      {
        key: "i1",
        format: "file",
        id: "i1",
        kind: "grokipedia",
        path: "Cars/Engines - V8/Turbo.md",
        version: "2026-10-03T00:00:00Z|Cars/Engines - V8/Turbo.md",
      },
      {
        key: "i1:docx",
        format: "docx",
        id: "i1",
        kind: "grokipedia",
        path: "Cars/Engines - V8/Turbo.docx",
        // Follows the Drive save, since the Doc only changes then.
        version: "2026-10-04T00:00:00Z|Cars/Engines - V8/Turbo.docx",
      },
      {
        key: "note",
        format: "file",
        id: "note",
        kind: "note",
        path: "Cars/Engines - V8/Idea.md",
        version: "2026-10-03T00:00:00Z|Cars/Engines - V8/Idea.md",
      },
      {
        key: "note:docx",
        format: "docx",
        id: "note",
        kind: "note",
        path: "Cars/Engines - V8/Idea.docx",
        version: "2026-10-04T00:00:00Z|Cars/Engines - V8/Idea.docx",
      },
    ]);
    expect(new Set(files.map((f) => f.key)).size).toBe(files.length);
  });

  it("has no .docx before the file is in Drive, and none for images", () => {
    const files = buildMirrorManifest(folders, [
      item({ id: "new" }),
      item({ id: "gone", drive_file_id: null }),
      item({
        id: "img",
        kind: "image",
        title: "Pic",
        meta: { mime_type: "image/png" },
        ...pushed,
      }),
    ]);
    expect(files.map((f) => f.key).sort()).toEqual(["gone", "img", "new"]);
    expect(files.every((f) => f.format === "file")).toBe(true);
  });

  it("treats any non-image kind as text and numbers clashing names in step", () => {
    const files = buildMirrorManifest(folders, [
      item({ id: "a", kind: "wikipedia", created_at: "2026-10-04T00:00:00Z", ...pushed }),
      item({ id: "b", kind: "wikipedia", created_at: "2026-10-05T00:00:00Z", ...pushed }),
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "Cars/Engines - V8/Turbo (2).docx",
      "Cars/Engines - V8/Turbo (2).md",
      "Cars/Engines - V8/Turbo.docx",
      "Cars/Engines - V8/Turbo.md",
    ]);
  });

  it("uses the edit time while the Drive save time is unknown", () => {
    const files = buildMirrorManifest(folders, [
      item({ drive_file_id: "d1", drive_synced_at: null }),
    ]);
    expect(files.find((f) => f.format === "docx")!.version).toBe(
      "2026-10-03T00:00:00Z|Cars/Engines - V8/Turbo.docx",
    );
  });
});
