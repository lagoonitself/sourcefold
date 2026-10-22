import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  MANIFEST_PATH,
  ProjectFileError,
  ProjectFileWriter,
  batchBySize,
  formatProjectFileSummary,
  groupsParentsFirst,
  isSafeEntryPath,
  mediaInFolder,
  parseProjectManifest,
  projectFileName,
  projectFilePaths,
  readProjectFile,
  remapProjectIds,
  summarizeProjectFile,
  uniqueProjectName,
  type ProjectFileManifest,
} from "./index";

const golden = JSON.parse(
  readFileSync(new URL("../../test/golden/project-file.manifest.json", import.meta.url), "utf8"),
) as ProjectFileManifest;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

async function goldenFile(): Promise<Uint8Array> {
  const writer = new ProjectFileWriter();
  writer.add("Cars/Engines/Turbocharger.md", "---\nsource: grokipedia\n---\n\n# Turbocharger\n\nBody\n");
  writer.add("Cars/Engines/Diesel/Thread by Jack (@jack).md", "# Thread\n");
  writer.add("Cars/Engines/Diesel/Thread by Jack (@jack)_files/abc.jpg", PNG);
  writer.add("Cars/Engines/Diesel/Diagram.png", PNG);
  const chunks = await writer.finish(golden);
  return new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}

describe("project file manifest", () => {
  it("accepts the golden manifest", () => {
    expect(parseProjectManifest(golden)).toEqual(golden);
  });

  it("refuses a newer version with an update message", () => {
    expect(() => parseProjectManifest({ ...golden, version: 2 })).toThrow(/newer version/);
  });

  it("refuses something that isn't a manifest", () => {
    expect(() => parseProjectManifest({ hello: 1 })).toThrow(ProjectFileError);
  });

  it("refuses broken references", () => {
    const orphan = structuredClone(golden);
    orphan.highlights[0]!.source_id = "nope";
    expect(() => parseProjectManifest(orphan)).toThrow(/highlight/);

    const loop = structuredClone(golden);
    loop.groups[0]!.parent_id = "g-diesel";
    expect(() => parseProjectManifest(loop)).toThrow(/inside itself/);

    const twice = structuredClone(golden);
    twice.cards[1]!.id = "c-1";
    expect(() => parseProjectManifest(twice)).toThrow(/twice/);
  });

  it("summarizes for the import preview", () => {
    const summary = summarizeProjectFile(golden, 38 * 1024 * 1024);
    expect(formatProjectFileSummary(summary)).toBe(
      "Cars: 2 groups, 3 sources, 1 highlight, 2 cards, 38 MB",
    );
  });

  it("picks a free project name", () => {
    expect(uniqueProjectName("Cars", ["Bikes"])).toBe("Cars");
    expect(uniqueProjectName("Cars", ["cars", "Cars (2)"])).toBe("Cars (3)");
  });

  it("names the file after the project", () => {
    expect(projectFileName("Cars")).toBe("Cars.sourcefold");
    expect(projectFileName("A/B: C?")).toBe("A B C.sourcefold");
    expect(projectFileName("...")).toBe("Project.sourcefold");
  });
});

describe("project file paths", () => {
  it("lays files out like Drive", () => {
    const paths = projectFilePaths(
      "Cars",
      golden.groups,
      golden.sources.map((s) => ({ ...s, extension: s.kind === "image" ? "png" : "md" })),
    );
    expect(paths.get("s-turbo")).toEqual({
      file: "Cars/Engines/Turbocharger.md",
      media_folder: "Cars/Engines/Turbocharger_files",
    });
    expect(paths.get("s-thread")?.file).toBe("Cars/Engines/Diesel/Thread by Jack (@jack).md");
    expect(paths.get("s-diagram")?.file).toBe("Cars/Engines/Diesel/Diagram.png");
  });

  it("numbers clashes by age", () => {
    const paths = projectFilePaths(
      "P",
      [{ id: "g", parent_id: null, name: "G", created_at: "2026-01-01" }],
      [
        { id: "b", group_id: "g", title: "Same", created_at: "2026-01-03", extension: "md" },
        { id: "a", group_id: "g", title: "same", created_at: "2026-01-02", extension: "md" },
      ],
    );
    expect(paths.get("a")?.file).toBe("P/G/same.md");
    expect(paths.get("b")?.file).toBe("P/G/Same (2).md");
  });

  it("refuses unsafe paths", () => {
    expect(isSafeEntryPath("Cars/Engines/Turbo.md")).toBe(true);
    for (const bad of ["../x.md", "/etc/passwd", "a/../../b.md", "C:/x.md", "a\\b.md", "a//b.md", "a/./b"]) {
      expect(isSafeEntryPath(bad), bad).toBe(false);
    }
  });
});

describe("project file zip", () => {
  it("round-trips", async () => {
    const file = await goldenFile();
    const contents = readProjectFile(file);
    expect(contents.manifest).toEqual(golden);
    expect(contents.entries.size).toBe(4);
    expect(new TextDecoder().decode(contents.entries.get("Cars/Engines/Diesel/Thread by Jack (@jack).md"))).toBe(
      "# Thread\n",
    );
    expect(mediaInFolder(contents.entries, golden.sources[1]!.media_folder)).toEqual([
      { name: "abc.jpg", data: PNG },
    ]);
  });

  it("refuses paths that climb out", () => {
    const zip = zipSync({
      [MANIFEST_PATH]: strToU8(JSON.stringify(golden)),
      "../evil.md": strToU8("x"),
    });
    expect(() => readProjectFile(zip)).toThrow(/won't open/);
  });

  it("refuses file types other than Markdown, images and mp4", () => {
    const zip = zipSync({
      [MANIFEST_PATH]: strToU8(JSON.stringify(golden)),
      "Cars/run.exe": strToU8("x"),
    });
    expect(() => readProjectFile(zip)).toThrow(/won't open/);
  });

  it("refuses a manifest that names a missing file", () => {
    const zip = zipSync({ [MANIFEST_PATH]: strToU8(JSON.stringify(golden)) });
    expect(() => readProjectFile(zip)).toThrow(/is missing/);
  });

  it("refuses something that isn't a zip", () => {
    expect(() => readProjectFile(strToU8("hello there"))).toThrow(/isn't a Sourcefold project file/);
  });

  it("won't add the same path twice or an unsafe one", () => {
    const writer = new ProjectFileWriter();
    writer.add("a/b.md", "x");
    expect(() => writer.add("A/B.md", "y")).toThrow(/already/);
    expect(() => writer.add("../b.md", "y")).toThrow(ProjectFileError);
  });
});

describe("remapping ids", () => {
  it("gives everything a new id and keeps references", () => {
    let n = 0;
    const { manifest, ids } = remapProjectIds(golden, () => `new-${++n}`);
    expect(() => parseProjectManifest(manifest)).not.toThrow();
    const allOld = [
      golden.project.id,
      ...golden.groups.map((g) => g.id),
      ...golden.sources.map((s) => s.id),
      ...golden.highlights.map((h) => h.id),
      ...golden.cards.map((c) => c.id),
    ];
    for (const old of allOld) expect(ids.has(old)).toBe(true);
    expect(manifest.highlights[0]!.source_id).toBe(ids.get("s-turbo"));
    expect(manifest.cards[0]!.highlight_id).toBe(ids.get("h-1"));
    expect(manifest.cards[0]!.section_id).toBe(ids.get("o-1"));
    expect(manifest.x_posts[1]!.parent_id).toBe(ids.get("x-1"));
    expect(manifest.groups[1]!.parent_id).toBe(ids.get("g-engines"));
  });

  it("orders groups parents first", () => {
    const ordered = groupsParentsFirst([
      { id: "c", parent_id: "b" },
      { id: "b", parent_id: "a" },
      { id: "a", parent_id: null },
    ]);
    expect(ordered.map((g) => g.id)).toEqual(["a", "b", "c"]);
  });
});

describe("import batches", () => {
  it("keeps each batch under the size limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i, text: "x".repeat(100) }));
    const batches = batchBySize(rows, 350);
    expect(batches.flat()).toEqual(rows);
    for (const batch of batches) expect(JSON.stringify(batch).length).toBeLessThan(400);
  });
});
