import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "@/features/project-file/memory-db";

vi.mock("server-only", () => ({}));

const requireApiUser = vi.fn();
const getFile = vi.fn();
const downloadFileBytes = vi.fn();
const findPostImagesFolder = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));
vi.mock("@/lib/google/oauth", () => ({
  getGoogleAccessToken: async () => "google-token",
  DriveAuthError: class extends Error {},
  DriveClientMismatchError: class extends Error {},
}));
vi.mock("@sourcefold/client/google/drive", () => ({
  getFile: (...args: unknown[]) => getFile(...args),
  downloadFileBytes: (...args: unknown[]) => downloadFileBytes(...args),
}));
vi.mock("@sourcefold/client/features/drive/post-images", () => ({
  findPostImagesFolder: (...args: unknown[]) => findPostImagesFolder(...args),
}));

import { GET } from "./route";
import { GET as GET_FILE } from "./[name]/route";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ITEM = "00000000-0000-4000-8000-0000000000aa";
const DELETED = "00000000-0000-4000-8000-0000000000bb";
const params = (id = ITEM) => ({ params: Promise.resolve({ id }) });
const fileParams = (name: string, id = ITEM) => ({ params: Promise.resolve({ id, name }) });
const request = () => new Request("http://localhost/api/items/x/media");

function setup(items: Record<string, unknown>[]) {
  const memory = createMemoryDb({
    items,
    folders: [{ id: "g1", user_id: USER, drive_folder_id: "drive-group", deleted_at: null }],
  });
  requireApiUser.mockResolvedValue({ db: memory.db, userId: USER, via: "token" });
}

const item = (extra = {}) => ({
  id: ITEM,
  user_id: USER,
  drive_file_id: "drive-file",
  deleted_at: null,
  ...extra,
});

function driveListing(files: { id: string; name: string; mimeType: string; size?: string }[]) {
  // A fresh Response per call: a body can only be read once.
  fetchMock.mockImplementation(async () => Response.json({ files }));
}

describe("media routes", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
    getFile.mockReset().mockResolvedValue({
      id: "drive-file",
      name: "Post.md",
      parents: ["drive-group"],
      trashed: false,
    });
    downloadFileBytes.mockReset();
    findPostImagesFolder.mockReset().mockResolvedValue("drive-images");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("lists the files of the _files folder and flags the big ones", async () => {
    setup([item()]);
    driveListing([
      { id: "f2", name: "b.gif", mimeType: "image/gif", size: String(4 * 1024 * 1024 + 1) },
      { id: "f1", name: "a.png", mimeType: "image/png", size: "1200" },
      { id: "sub", name: "folder", mimeType: "application/vnd.google-apps.folder" },
      { id: "bad", name: "../x.png", mimeType: "image/png", size: "1" },
    ]);
    const res = await GET(request(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).data.files).toEqual([
      { name: "a.png", size: 1200, too_large: false },
      { name: "b.gif", size: 4 * 1024 * 1024 + 1, too_large: true },
    ]);
    expect(findPostImagesFolder).toHaveBeenCalledWith(
      "google-token",
      { parentId: "drive-group", fileName: "Post.md" },
      new Set(["drive-group"]),
    );
  });

  it("lists nothing for a source that is not in Drive yet or has no folder", async () => {
    setup([item({ drive_file_id: null })]);
    let res = await GET(request(), params());
    expect((await res.json()).data.files).toEqual([]);
    expect(getFile).not.toHaveBeenCalled();

    setup([item()]);
    findPostImagesFolder.mockResolvedValue(null);
    res = await GET(request(), params());
    expect((await res.json()).data.files).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's, a deleted or a missing source, and 400 for a bad id", async () => {
    setup([item({ user_id: OTHER }), item({ id: DELETED, deleted_at: "2026-10-03T00:00:00Z" })]);
    expect((await GET(request(), params())).status).toBe(404);
    expect((await GET(request(), params(DELETED))).status).toBe(404);
    expect((await GET(request(), params("nope"))).status).toBe(400);
  });

  it("returns a file's bytes with its content type", async () => {
    setup([item()]);
    driveListing([{ id: "f1", name: "a.png", mimeType: "application/octet-stream", size: "3" }]);
    downloadFileBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const res = await GET_FILE(request(), fileParams("a.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(downloadFileBytes).toHaveBeenCalledWith("google-token", "f1");
  });

  it("refuses unsafe names without touching Drive", async () => {
    setup([item()]);
    for (const name of ["a/b.png", "..\\a.png", "..", "a..png", "a\u0000.png", ""]) {
      const res = await GET_FILE(request(), fileParams(name));
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloadFileBytes).not.toHaveBeenCalled();
  });

  it("answers 404 for a name that is not in the folder, and 413 over 4 MB", async () => {
    setup([item()]);
    driveListing([
      { id: "f1", name: "big.gif", mimeType: "image/gif", size: String(5 * 1024 * 1024) },
    ]);
    expect((await GET_FILE(request(), fileParams("nope.png"))).status).toBe(404);
    expect((await GET_FILE(request(), fileParams("big.gif"))).status).toBe(413);
    expect(downloadFileBytes).not.toHaveBeenCalled();
  });

  it("answers 404 for another user's source", async () => {
    setup([item({ user_id: OTHER })]);
    expect((await GET_FILE(request(), fileParams("a.png"))).status).toBe(404);
  });
});
