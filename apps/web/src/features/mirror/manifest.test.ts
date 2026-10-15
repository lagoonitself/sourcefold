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
