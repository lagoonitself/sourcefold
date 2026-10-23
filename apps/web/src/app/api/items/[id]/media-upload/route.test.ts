import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "@/features/project-file/memory-db";

vi.mock("server-only", () => ({}));

const requireApiUser = vi.fn();
const createSignedUploadUrl = vi.fn();
const fromBucket = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { POST } from "./route";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const POST_ITEM = "00000000-0000-4000-8000-0000000000aa";
const IMAGE_ITEM = "00000000-0000-4000-8000-0000000000bb";
const DELETED = "00000000-0000-4000-8000-0000000000cc";
const THEIRS = "00000000-0000-4000-8000-0000000000dd";

const params = (id = POST_ITEM) => ({ params: Promise.resolve({ id }) });
const request = (body: unknown) =>
  new Request("http://localhost/api/items/x/media-upload", {
    method: "POST",
    body: JSON.stringify(body),
  });
const good = { file_name: "abc.jpg", mime_type: "image/jpeg", size: 1200 };

describe("POST /api/items/[id]/media-upload", () => {
  beforeEach(() => {
    const item = (id: string, extra = {}) => ({
      id,
      user_id: USER,
      kind: "x",
      deleted_at: null,
      ...extra,
    });
    const memory = createMemoryDb({
      items: [
        item(POST_ITEM),
        item(IMAGE_ITEM, { kind: "image" }),
        item(DELETED, { deleted_at: "2026-10-03T00:00:00Z" }),
        item(THEIRS, { user_id: OTHER }),
      ],
    });
    createSignedUploadUrl.mockReset().mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed", token: "t" },
      error: null,
    });
    fromBucket.mockReset().mockReturnValue({ createSignedUploadUrl });
    const db = { ...memory.db, storage: { from: fromBucket } };
    requireApiUser.mockReset().mockResolvedValue({ db, userId: USER, via: "token" });
  });

  it("signs an upload in the staging bucket under the user's and the post's ids", async () => {
    const res = await POST(request(good), params());
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      item_id: POST_ITEM,
      storage_path: `${USER}/${POST_ITEM}/abc.jpg`,
      signed_url: "https://storage.test/signed",
    });
    expect(fromBucket).toHaveBeenCalledWith("post-media");
    expect(createSignedUploadUrl).toHaveBeenCalledWith(`${USER}/${POST_ITEM}/abc.jpg`);
  });

  it("takes a GIF saved as mp4", async () => {
    const res = await POST(
      request({ ...good, file_name: "gif.mp4", mime_type: "video/mp4" }),
      params(),
    );
    expect(res.status).toBe(200);
  });

  it("refuses unsafe names, a type that doesn't match the name, SVG and other types", async () => {
    for (const body of [
      { ...good, file_name: "../x.jpg" },
      { ...good, file_name: "a/b.jpg" },
      { ...good, mime_type: "image/png" },
      { ...good, file_name: "a.svg", mime_type: "image/svg+xml" },
      { ...good, file_name: "a.md", mime_type: "text/markdown" },
      { ...good, size: 0 },
    ]) {
      expect((await POST(request(body), params())).status, JSON.stringify(body)).toBe(400);
    }
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses files over 25 MB", async () => {
    const res = await POST(request({ ...good, size: 25 * 1024 * 1024 + 1 }), params());
    expect(res.status).toBe(413);
  });

  it("answers 404 for another user's, a deleted or an image source, and 400 for a bad id", async () => {
    expect((await POST(request(good), params(THEIRS))).status).toBe(404);
    expect((await POST(request(good), params(DELETED))).status).toBe(404);
    expect((await POST(request(good), params(IMAGE_ITEM))).status).toBe(404);
    expect((await POST(request(good), params("nope"))).status).toBe(400);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});
