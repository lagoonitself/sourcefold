import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A tiny in-memory Drive: id → { name, parent, mimeType, trashed, body }.
type Node = { name: string; parent: string; mimeType: string; trashed: boolean; body?: string };
const DOC = "application/vnd.google-apps.document";
let drive: Map<string, Node>;
let nextId: number;

vi.mock("@/lib/google/drive", () => ({
  listChildren: async (
    _token: string,
    parentId: string,
    options: { name?: string; mimeType?: string } = {},
  ) =>
    [...drive]
      .filter(
        ([, n]) =>
          n.parent === parentId &&
          !n.trashed &&
          (options.name === undefined || n.name === options.name) &&
          (options.mimeType === undefined || n.mimeType === options.mimeType),
      )
      .map(([id, n]) => ({ id, name: n.name, mimeType: n.mimeType })),
  uploadFile: async (
    _token: string,
    o: {
      id?: string;
      name: string;
      parentId?: string;
      mimeType: string;
      convertTo?: string;
      body: string;
      addParents?: string;
    },
  ) => {
    // Uploading HTML with a target type makes a Google Doc.
    const mimeType = o.convertTo ?? o.mimeType;
    if (o.id) {
      const node = drive.get(o.id)!;
      node.name = o.name;
      node.mimeType = mimeType;
      node.body = o.body;
      if (o.addParents) node.parent = o.addParents;
      return { id: o.id };
    }
    const id = `d${nextId++}`;
    drive.set(id, { name: o.name, parent: o.parentId!, mimeType, trashed: false, body: o.body });
    return { id };
  },
  updateFile: async (_token: string, id: string, u: { trashed?: boolean }) => {
    const node = drive.get(id)!;
    if (u.trashed !== undefined) node.trashed = u.trashed;
    return { id };
  },
}));

import { googleDocName, syncGoogleDoc, trashGoogleDoc } from "./google-doc-sync";

const md = (text: string) => `---\nsource: note\n---\n\n# Title\n\n${text}\n`;
const live = () =>
  [...drive.values()]
    .filter((n) => !n.trashed)
    .map((n) => `${n.parent}/${n.name}:${n.mimeType === DOC ? "doc" : n.mimeType}`)
    .sort();

describe("googleDocName", () => {
  it("is the Markdown file name without .md", () => {
    expect(googleDocName("Why AI Matters.md")).toBe("Why AI Matters");
    expect(googleDocName("Why AI Matters (2).md")).toBe("Why AI Matters (2)");
    expect(googleDocName("a.md.md")).toBe("a.md");
  });
});

describe("syncGoogleDoc", () => {
  beforeEach(() => {
    drive = new Map();
    nextId = 1;
  });

  it("creates a Google Doc with the file's name in the same folder, from the HTML", async () => {
    const id = await syncGoogleDoc("t", { parentId: "g", fileName: "Post.md" }, null, md("Hello"));
    expect(live()).toEqual(["g/Post:doc"]);
    expect(drive.get(id)!.body).toContain("<html>");
    expect(drive.get(id)!.body).toContain("Hello");
  });

  it("replaces the content of the existing Doc instead of making another", async () => {
    const first = await syncGoogleDoc("t", { parentId: "g", fileName: "Post.md" }, null, md("One"));
    const second = await syncGoogleDoc(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md("Two"),
    );
    expect(second).toBe(first);
    expect(live()).toEqual(["g/Post:doc"]);
    expect(drive.get(first)!.body).toContain("Two");
    expect(drive.get(first)!.body).not.toContain("One");
  });

  it("follows a rename and a move of the file", async () => {
    const id = await syncGoogleDoc("t", { parentId: "g", fileName: "Old.md" }, null, md("Body"));
    const renamed = await syncGoogleDoc(
      "t",
      { parentId: "g", fileName: "New.md" },
      { parentId: "g", fileName: "Old.md" },
      md("Body"),
    );
    expect(renamed).toBe(id);
    expect(live()).toEqual(["g/New:doc"]);

    const moved = await syncGoogleDoc(
      "t",
      { parentId: "h", fileName: "New.md" },
      { parentId: "g", fileName: "New.md" },
      md("Body"),
    );
    expect(moved).toBe(id);
    expect(live()).toEqual(["h/New:doc"]);
  });

  it("keeps two files with the same title apart", async () => {
    const a = await syncGoogleDoc("t", { parentId: "g", fileName: "X.md" }, null, md("A"));
    const b = await syncGoogleDoc("t", { parentId: "g", fileName: "X (2).md" }, null, md("B"));
    expect(a).not.toBe(b);
    expect(live()).toEqual(["g/X (2):doc", "g/X:doc"]);
  });

  it("never touches other files, even ones with the same name", async () => {
    drive.set("md", { name: "Post.md", parent: "g", mimeType: "text/markdown", trashed: false });
    drive.set("same", { name: "Post", parent: "g", mimeType: "image/png", trashed: false });
    drive.set("folder", {
      name: "Post",
      parent: "g",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
      body: "keep",
    });
    const id = await syncGoogleDoc("t", { parentId: "g", fileName: "Post.md" }, null, md("Hi"));
    expect(drive.get(id)!.mimeType).toBe(DOC);
    expect(drive.get("md")!.body).toBeUndefined();
    expect(drive.get("same")!.body).toBeUndefined();
    expect(drive.get("folder")!.body).toBe("keep");
    expect(live()).toHaveLength(4);
  });

  it("makes a new Doc when the previous one is not there", async () => {
    await syncGoogleDoc(
      "t",
      { parentId: "g", fileName: "New.md" },
      { parentId: "g", fileName: "Old.md" },
      md("Body"),
    );
    expect(live()).toEqual(["g/New:doc"]);
  });
});

describe("trashGoogleDoc", () => {
  beforeEach(() => {
    drive = new Map();
    nextId = 1;
  });

  it("trashes only the Doc next to the deleted file", async () => {
    await syncGoogleDoc("t", { parentId: "g", fileName: "Post.md" }, null, md("Hi"));
    await syncGoogleDoc("t", { parentId: "g", fileName: "Other.md" }, null, md("Hi"));
    drive.set("md", { name: "Post.md", parent: "g", mimeType: "text/markdown", trashed: false });

    await trashGoogleDoc("t", { parentId: "g", fileName: "Post.md" });
    expect(live()).toEqual(["g/Other:doc", "g/Post.md:text/markdown"]);
  });

  it("does nothing when there is no Doc", async () => {
    await expect(
      trashGoogleDoc("t", { parentId: "g", fileName: "Post.md" }),
    ).resolves.toBeUndefined();
  });
});
