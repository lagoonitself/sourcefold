import { describe, expect, it } from "vitest";
import { driveFileName, folderPathOf, buildItemFile, type FolderRef } from "./build-file";

describe("folderPathOf", () => {
  it("formats folder path with safeName applied to folder names", () => {
    const foldersById = new Map<string, FolderRef>([
      ["1", { id: "1", parent_id: null, name: "Articles: General" }],
      ["2", { id: "2", parent_id: "1", name: "AI/ML & Robotics" }],
    ]);

    expect(folderPathOf("2", foldersById)).toBe("Articles - General/AI-ML & Robotics");
    expect(folderPathOf(null, foldersById)).toBe("");
  });
});

describe("driveFileName", () => {
  it("formats standard file names without collision", () => {
    expect(driveFileName("Quantum Computing", "item-1", [])).toBe("Quantum Computing.md");
    expect(driveFileName("Photo of Cat", "item-2", [], "png")).toBe("Photo of Cat.png");
  });

  it("sanitizes forbidden characters and replaces colons and slashes", () => {
    expect(driveFileName("Deep Learning: Part 1/2", "item-1", [])).toBe(
      "Deep Learning - Part 1-2.md",
    );
  });

  it("resolves collisions by createdAt order with plain name then (2), (3)", () => {
    const siblings = [
      { id: "1", title: "Impact of AI", created_at: "2026-10-13T10:00:00Z" },
      { id: "2", title: "Impact of AI", created_at: "2026-10-13T11:00:00Z" },
    ];

    expect(driveFileName("Impact of AI", "1", siblings, "md", "2026-10-13T10:00:00Z")).toBe(
      "Impact of AI.md",
    );

    expect(driveFileName("Impact of AI", "2", siblings, "md", "2026-10-13T11:00:00Z")).toBe(
      "Impact of AI (2).md",
    );

    // A third item created later
    expect(driveFileName("Impact of AI", "3", siblings, "md", "2026-10-13T12:00:00Z")).toBe(
      "Impact of AI (3).md",
    );
  });

  it("handles case-insensitive collisions", () => {
    const siblings = [{ id: "1", title: "report", created_at: "2026-10-13T10:00:00Z" }];

    expect(driveFileName("Report", "2", siblings, "md", "2026-10-13T11:00:00Z")).toBe(
      "Report (2).md",
    );
  });
});

describe("buildItemFile", () => {
  it("builds canonical Markdown with front matter, title, source line, and note", () => {
    const item = {
      id: "item-123",
      kind: "grokipedia",
      title: "Quantum Teleportation",
      source_url: "https://grokipedia.com/page/Quantum_Teleportation",
      created_at: "2026-10-13T12:00:00Z",
      markdown: "Body text.",
      note: "Important note",
    };

    const result = buildItemFile(item, "Physics/Quantum");
    expect(result).toContain("source: grokipedia\n");
    expect(result).toContain("title: Quantum Teleportation\n");
    expect(result).toContain("saved: 2026-10-13\n");
    expect(result).toContain("folder: Physics/Quantum\n");
    expect(result).toContain("# Quantum Teleportation\n\n> Saved from [Grokipedia]");
    expect(result).toContain("Body text.\n\n## My note\n\nImportant note\n");
  });
});
