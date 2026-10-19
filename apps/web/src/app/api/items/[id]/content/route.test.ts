import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-db";

vi.mock("server-only", () => ({}));

const requireApiUser = vi.fn();
const downloadFileText = vi.fn();
const getFile = vi.fn();
const listChildren = vi.fn();
const exportFile = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));
vi.mock("@/lib/google/oauth", () => ({
  getGoogleAccessToken: async () => "google-token",
  DriveAuthError: class extends Error {},
  DriveClientMismatchError: class extends Error {},
}));
vi.mock("@/lib/google/drive", () => ({
  downloadFileText: (...args: unknown[]) => downloadFileText(...args),
  downloadFileBytes: async () => null,
  getFile: (...args: unknown[]) => getFile(...args),
  listChildren: (...args: unknown[]) => listChildren(...args),
  exportFile: (...args: unknown[]) => exportFile(...args),
}));

import { GET } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-0000000000aa";
const params = { params: Promise.resolve({ id: ITEM_ID }) };
const folders = [
  { id: "p", parent_id: null, name: "Cars" },
  { id: "g", parent_id: "p", name: "Engines" },
];

function setup(item: Record<string, unknown>) {
  const fake = createFakeDb({
    items: {
      id: ITEM_ID,
      folder_id: "g",
      status: "saved",
      source_url: "https://grokipedia.com/page/Turbo",
      canonical_url: "https://grokipedia.com/page/Turbo",
      created_at: "2026-10-02T10:00:00Z",
      meta: {},
      note: null,
      storage_path: null,
      drive_file_id: null,
      ...item,
    },
    folders,
  });
  requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
}

describe("GET /api/items/[id]/content", () => {
  beforeEach(() => {
    downloadFileText.mockReset();
    getFile.mockReset();
    listChildren.mockReset();
    exportFile.mockReset();
  });

  it("builds the file from text still in Supabase, with the current folder path", async () => {
    setup({ kind: "grokipedia", title: "Turbo", markdown: "Body text.\n" });
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toMatch(/^---\nsource: grokipedia\n/);
    expect(text).toContain("folder: Cars/Engines\n");
    expect(text).toContain("# Turbo\n");
    expect(text).toContain("Body text.\n");
    expect(downloadFileText).not.toHaveBeenCalled();
  });

  it("reads the body back from Drive once the text moved there", async () => {
    setup({ kind: "grokipedia", title: "Turbo", markdown: null, drive_file_id: "d1" });
    downloadFileText.mockResolvedValue(
      "---\nsource: grokipedia\nfolder: Old/Path\n---\n\n# Turbo\n\n> Saved from x\n\nFrom Drive.\n",
    );
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(downloadFileText).toHaveBeenCalledWith("google-token", "d1");
    expect(text).toContain("folder: Cars/Engines\n");
    expect(text).toContain("From Drive.\n");
    expect(text).not.toContain("Old/Path");
  });

  it("answers 409 when Drive held the only copy and it's gone", async () => {
    setup({ kind: "substack", title: "Post", markdown: null, drive_file_id: "d1" });
    downloadFileText.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(409);
  });

  it("builds an empty body for a source that never had text (no Drive file either)", async () => {
    setup({ kind: "web", title: "YouTube", markdown: null, drive_file_id: null });
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("# YouTube\n");
    expect(downloadFileText).not.toHaveBeenCalled();
  });

  it("has no file for a paid post that wasn't saved", async () => {
    setup({ kind: "substack", title: "Paid", status: "unavailable", markdown: null });
    const res = await GET(new Request("http://localhost/x"), params);
    expect(res.status).toBe(404);
  });

  describe("?format=docx", () => {
    const docx = () => GET(new Request("http://localhost/x?format=docx"), params);

    it("exports the item's Google Doc, found next to its Markdown file", async () => {
      setup({ kind: "substack", title: "Post", markdown: null, drive_file_id: "d1" });
      getFile.mockResolvedValue({ id: "d1", name: "Post (2).md", parents: ["g1"], trashed: false });
      listChildren.mockResolvedValue([{ id: "doc1", name: "Post (2)", mimeType: "x" }]);
      exportFile.mockResolvedValue(new Uint8Array([80, 75, 3, 4]));

      const res = await docx();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([80, 75, 3, 4]);
      expect(listChildren).toHaveBeenCalledWith("google-token", "g1", {
        name: "Post (2)",
        mimeType: "application/vnd.google-apps.document",
      });
      expect(exportFile).toHaveBeenCalledWith(
        "google-token",
        "doc1",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(downloadFileText).not.toHaveBeenCalled();
    });

    it("answers not_ready before the item is in Drive", async () => {
      setup({ kind: "grokipedia", title: "Turbo", markdown: "x", drive_file_id: null });
      const res = await docx();
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_ready");
      expect(getFile).not.toHaveBeenCalled();
    });

    it("answers not_ready when the Google Doc isn't there yet", async () => {
      setup({ kind: "grokipedia", title: "Turbo", markdown: null, drive_file_id: "d1" });
      getFile.mockResolvedValue({ id: "d1", name: "Turbo.md", parents: ["g1"], trashed: false });
      listChildren.mockResolvedValue([]);
      const res = await docx();
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_ready");
      expect(exportFile).not.toHaveBeenCalled();
    });

    it("answers not_ready when the Markdown file was trashed in Drive", async () => {
      setup({ kind: "grokipedia", title: "Turbo", markdown: null, drive_file_id: "d1" });
      getFile.mockResolvedValue({ id: "d1", name: "Turbo.md", parents: ["g1"], trashed: true });
      const res = await docx();
      expect((await res.json()).error.code).toBe("not_ready");
    });

    it("has no Word copy for an unsaved item or an image", async () => {
      setup({ kind: "substack", title: "Paid", status: "unavailable", markdown: null });
      expect((await docx()).status).toBe(404);
      setup({ kind: "image", title: "Pic", drive_file_id: "d1" });
      const res = await docx();
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBeUndefined();
    });
  });
});
