import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, registerImagesTools, sniffImageType } from "../tools/images";
import type { Folder } from "../types";
import { connect, fakeWeb } from "./harness";

const folders: Folder[] = [
  { id: "p1", parent_id: null, name: "Cars", position: 0 },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0 },
];

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const dir = mkdtempSync(join(tmpdir(), "sourcefold-img-"));

function web(overrides: Record<string, Parameters<typeof fakeWeb>[0][string]> = {}) {
  return fakeWeb({
    "GET /folders": () => ({ json: { data: folders } }),
    "POST /uploads/sign": () => ({
      json: {
        data: {
          item_id: "img1",
          storage_path: "u/img1/pic.png",
          signed_url: "https://storage.test/upload",
          apikey: "pub",
        },
      },
    }),
    "POST /uploads": ({ body }) => ({
      status: 201,
      json: {
        data: {
          id: "img1",
          folder_id: "g1",
          kind: "image",
          title: (body as { title?: string }).title ?? "pic",
          status: "saved",
          source_url: null,
          meta: null,
          created_at: "2026-10-01T00:00:00Z",
        },
      },
    }),
    ...overrides,
  });
}

let storage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://img.test/photo.png") {
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    }
    if (url === "https://img.test/page") return new Response("<html>", { status: 200 });
    if (url === "https://img.test/missing.png") return new Response("no", { status: 404 });
    if (url === "https://storage.test/upload") return new Response("{}", { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", storage);
});

afterEach(() => vi.unstubAllGlobals());

describe("sniffImageType", () => {
  it("knows the four formats and nothing else", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39]))).toBe("image/gif");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("hello world"))).toBeNull();
  });
});

describe("add_image", () => {
  it("uploads a file from this computer in the desktop app's three steps", async () => {
    const path = join(dir, "turbo diagram.png");
    writeFileSync(path, PNG);
    const fake = web();
    const h = await connect(registerImagesTools, { web: fake });
    const { text, isError } = await h.call("add_image", { group_id: "g1", path });
    expect(isError).toBe(false);
    expect(text).toBe('Added image "pic" [img1] to Cars › Engines.');

    const signIndex = fake.calls.indexOf("POST /uploads/sign");
    expect(fake.bodies[signIndex]).toEqual({
      folder_id: "g1",
      file_name: "turbo diagram.png",
      mime_type: "image/png",
      size: PNG.length,
    });
    const put = storage.mock.calls.find((c) => String(c[0]) === "https://storage.test/upload")!;
    expect(put[1]).toMatchObject({
      method: "PUT",
      headers: { apikey: "pub", "x-upsert": "false" },
    });
    expect(put[1].body).toBeInstanceOf(FormData);
    const createBody = fake.bodies[fake.calls.indexOf("POST /uploads")] as Record<string, unknown>;
    expect(createBody).toMatchObject({
      item_id: "img1",
      folder_id: "g1",
      storage_path: "u/img1/pic.png",
      file_name: "turbo diagram.png",
      mime_type: "image/png",
    });
    expect(createBody).not.toHaveProperty("title");
  });

  it("downloads from a url and passes on a title", async () => {
    const fake = web();
    const h = await connect(registerImagesTools, { web: fake });
    const { text, isError } = await h.call("add_image", {
      group_id: "g1",
      url: "https://img.test/photo.png",
      title: "  Turbo  ",
    });
    expect(isError).toBe(false);
    expect(text).toContain('Added image "Turbo" [img1]');
    expect(fake.bodies[fake.calls.indexOf("POST /uploads/sign")]).toMatchObject({
      file_name: "photo.png",
    });
  });

  it("wants exactly one of path and url", async () => {
    const h = await connect(registerImagesTools, { web: web() });
    for (const args of [{}, { path: "a.png", url: "https://img.test/photo.png" }]) {
      const { text, isError } = await h.call("add_image", { group_id: "g1", ...args });
      expect(isError).toBe(true);
      expect(text).toContain("exactly one of path");
    }
  });

  it("rejects the wrong extension, a missing file, a fake image and a too-big file", async () => {
    const h = await connect(registerImagesTools, { web: web() });
    const call = (path: string) => h.call("add_image", { group_id: "g1", path });

    const pdf = join(dir, "doc.pdf");
    writeFileSync(pdf, PNG);
    expect((await call(pdf)).text).toContain("Upload a PNG, JPEG, GIF or WebP image.");

    expect((await call(join(dir, "nope.png"))).text).toContain("There is no file at");

    const fake = join(dir, "fake.png");
    writeFileSync(fake, "not really an image");
    expect((await call(fake)).text).toBe("Upload a PNG, JPEG, GIF or WebP image.");

    const big = join(dir, "big.png");
    writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    expect((await call(big)).text).toBe("Images can be up to 10 MB.");
    // Nothing was uploaded for any of them.
    expect(storage).not.toHaveBeenCalled();
  });

  it("rejects bad urls, failed downloads and pages that are not images", async () => {
    const h = await connect(registerImagesTools, { web: web() });
    const call = (url: string) => h.call("add_image", { group_id: "g1", url });
    expect((await call("ftp://img.test/a.png")).text).toContain("Only http and https");
    expect((await call("not a url")).text).toContain("isn't a web address");
    expect((await call("https://img.test/missing.png")).text).toContain("answered 404");
    expect((await call("https://img.test/page")).text).toBe(
      "Upload a PNG, JPEG, GIF or WebP image.",
    );
  });

  it("refuses a project as the target before reading anything", async () => {
    const h = await connect(registerImagesTools, { web: web() });
    const { text, isError } = await h.call("add_image", {
      group_id: "p1",
      url: "https://img.test/photo.png",
    });
    expect(isError).toBe(true);
    expect(text).toContain("can't live directly in a project");
    expect(storage).not.toHaveBeenCalled();
  });

  it("reports a storage failure", async () => {
    storage.mockImplementation(async (input: string | URL | Request) =>
      String(input) === "https://storage.test/upload"
        ? new Response(JSON.stringify({ message: "Bucket is full" }), { status: 413 })
        : new Response(PNG, { status: 200 }),
    );
    const h = await connect(registerImagesTools, { web: web() });
    const { text, isError } = await h.call("add_image", {
      group_id: "g1",
      url: "https://img.test/photo.png",
    });
    expect(isError).toBe(true);
    expect(text).toBe("Bucket is full");
  });
});
