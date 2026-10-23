import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny in-memory Drive: id → { name, parent, mimeType, trashed }.
type Node = { name: string; parent: string; mimeType: string; trashed: boolean };
const FOLDER = "application/vnd.google-apps.folder";
let drive: Map<string, Node>;
let nextId: number;

vi.mock("../../google/drive", () => ({
  listChildren: async (
    _token: string,
    parentId: string,
    options: { name?: string; foldersOnly?: boolean } = {},
  ) =>
    [...drive]
      .filter(
        ([, n]) =>
          n.parent === parentId &&
          !n.trashed &&
          (options.name === undefined || n.name === options.name) &&
          (!options.foldersOnly || n.mimeType === FOLDER),
      )
      .map(([id, n]) => ({ id, name: n.name, mimeType: n.mimeType })),
  createFolder: async (_token: string, name: string, parent: string) => {
    const id = `f${nextId++}`;
    drive.set(id, { name, parent, mimeType: FOLDER, trashed: false });
    return { id };
  },
  uploadFile: async (_token: string, o: { name: string; parentId: string; mimeType: string }) => {
    const id = `u${nextId++}`;
    drive.set(id, { name: o.name, parent: o.parentId, mimeType: o.mimeType, trashed: false });
    return { id };
  },
  updateFile: async (
    _token: string,
    id: string,
    u: { name?: string; addParents?: string; trashed?: boolean },
  ) => {
    const node = drive.get(id)!;
    if (u.name !== undefined) node.name = u.name;
    if (u.addParents) node.parent = u.addParents;
    if (u.trashed !== undefined) node.trashed = u.trashed;
    return { id };
  },
}));

import { syncPostImages, trashPostImages } from "./post-images";

const A = "https://substack-post-media.s3.amazonaws.com/public/images/a.png";
const B = "https://substack-post-media.s3.amazonaws.com/public/images/b.jpeg";
const md = (...urls: string[]) => urls.map((u) => `![](${u})`).join("\n\n");
const live = () =>
  [...drive.values()]
    .filter((n) => !n.trashed)
    .map((n) => `${n.parent}/${n.name}`)
    .sort();

describe("syncPostImages", () => {
  const fetchMock = vi.fn();
  // Stands in for the website's publicFetch (which has its own tests): private addresses never
  // reach the network.
  const fetchUrl = (url: string, init?: RequestInit): Promise<Response> =>
    /^https:\/\/(169\.254\.|127\.|10\.|localhost)/.test(url)
      ? Promise.reject(new Error("blocked"))
      : fetchMock(url, init);

  beforeEach(() => {
    drive = new Map();
    nextId = 1;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("missing")
        ? new Response("no", { status: 404 })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates the folder next to the post and uploads each image", async () => {
    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md(A, B),
      new Set(),
      fetchUrl,
    );
    expect(live()).toEqual(["f1/a.png", "f1/b.jpeg", "g/Post_files"]);
  });

  it("follows a rename, uploads only what's missing and drops what the post no longer uses", async () => {
    drive.set("old", { name: "Old_files", parent: "g", mimeType: FOLDER, trashed: false });
    drive.set("ia", { name: "a.png", parent: "old", mimeType: "image/png", trashed: false });
    drive.set("ix", { name: "x.png", parent: "old", mimeType: "image/png", trashed: false });

    await syncPostImages(
      "t",
      { parentId: "g2", fileName: "New.md" },
      { parentId: "g", fileName: "Old.md" },
      md(A, B),
      new Set(),
      fetchUrl,
    );

    expect(live()).toEqual(["g2/New_files", "old/a.png", "old/b.jpeg"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the copies from a project file first, then deletes them", async () => {
    const staged = {
      read: vi.fn(async (name: string) =>
        name === "a.png" ? { body: new Uint8Array([9]), mimeType: "image/png" } : null,
      ),
      clear: vi.fn(async () => {}),
    };
    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md(A, B),
      new Set(),
      fetchUrl,
      staged,
    );
    expect(live()).toEqual(["f1/a.png", "f1/b.jpeg", "g/Post_files"]);
    // Only b.jpeg came from the web.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("b.jpeg");
    expect(staged.clear).toHaveBeenCalledTimes(1);
  });

  it("leaves the staged copies alone when it used none of them", async () => {
    const staged = { read: vi.fn(async () => null), clear: vi.fn(async () => {}) };
    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md(A),
      new Set(),
      fetchUrl,
      staged,
    );
    expect(staged.clear).not.toHaveBeenCalled();
  });

  it("trashes the folder when the post has no images left", async () => {
    drive.set("old", { name: "Post_files", parent: "g", mimeType: FOLDER, trashed: false });
    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      "Text.",
      new Set(),
      fetchUrl,
    );
    expect(live()).toEqual([]);
  });

  it("never treats a subgroup called <title>_files as the image folder", async () => {
    drive.set("sub", { name: "Post_files", parent: "g", mimeType: FOLDER, trashed: false });
    drive.set("subfile", {
      name: "Kept.md",
      parent: "sub",
      mimeType: "text/markdown",
      trashed: false,
    });

    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md(A),
      new Set(["sub"]),
      fetchUrl,
    );
    // Its own folder was made beside the subgroup, and that's the one a delete trashes.
    expect(drive.get("f1")).toMatchObject({ name: "Post_files", parent: "g" });
    await trashPostImages("t", { parentId: "g", fileName: "Post.md" }, new Set(["sub"]));

    expect(drive.get("f1")!.trashed).toBe(true);
    expect(drive.get("sub")!.trashed).toBe(false);
    expect(drive.get("subfile")!.trashed).toBe(false);
  });

  it("skips images that can't be downloaded and doesn't fetch private addresses", async () => {
    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md("https://cdn.example/missing.png", "https://169.254.169.254/latest.png", A),
      new Set(),
      fetchUrl,
    );
    expect(live()).toEqual(["f1/a.png", "g/Post_files"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts video/mp4 only when the URL ends in .mp4, and rejects text/html", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("test_gif.mp4")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "video/mp4" },
        });
      }
      if (url.includes("not-mp4.png")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "video/mp4" },
        });
      }
      if (url.includes("html-fake.mp4")) {
        return new Response("<html>Not an MP4</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const GIF_MP4 = "https://video.twimg.com/tweet_video/test_gif.mp4";
    const WRONG_EXT_VIDEO = "https://video.twimg.com/tweet_video/not-mp4.png";
    const HTML_MP4 = "https://video.twimg.com/tweet_video/html-fake.mp4";

    await syncPostImages(
      "t",
      { parentId: "g", fileName: "Post.md" },
      null,
      md(GIF_MP4, WRONG_EXT_VIDEO, HTML_MP4),
      new Set(),
      fetchUrl,
    );

    // Only GIF_MP4 should be downloaded and uploaded
    expect(live()).toEqual(["f1/test_gif.mp4", "g/Post_files"]);
    const uploaded = [...drive.values()].find((n) => n.name === "test_gif.mp4");
    expect(uploaded?.mimeType).toBe("video/mp4");
  });
});
