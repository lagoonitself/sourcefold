import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "./index";
import type { Env, R2BucketLike, R2PutOptions } from "./env";

const ID = "3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f";
const HELLO_SHA = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const BASE = "https://content.test";

interface Stored {
  bytes: Uint8Array;
  options: R2PutOptions;
}

function fakeBucket(): R2BucketLike & { objects: Map<string, Stored> } {
  const objects = new Map<string, Stored>();
  return {
    objects,
    async get(key) {
      const found = objects.get(key);
      if (!found) return null;
      return {
        body: new Blob([found.bytes as Uint8Array<ArrayBuffer>]).stream(),
        httpMetadata: found.options.httpMetadata,
        customMetadata: found.options.customMetadata,
        size: found.bytes.byteLength,
      };
    },
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes: new Uint8Array(bytes), options });
    },
  };
}

let bucket: ReturnType<typeof fakeBucket>;
let env: Env;
let supabase: ReturnType<typeof vi.fn>;

function access(over: Record<string, unknown> = {}) {
  return { can_read: true, can_edit: true, kind: "text", used_bytes: 0, ...over };
}

function supabaseReturns(status: number, body: unknown) {
  supabase.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, init), env);
}

const bearer = { Authorization: "Bearer user-token" };

beforeEach(() => {
  bucket = fakeBucket();
  env = {
    CONTENT: bucket,
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "pub-key",
    SERVICE_SECRET: "s3cret",
  };
  supabase = vi.fn();
  supabaseReturns(200, access());
  vi.stubGlobal("fetch", supabase);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("health, CORS, routing", () => {
  it("answers /health with CORS", async () => {
    const res = await call("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ok" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe("ETag");
  });

  it("answers preflight", async () => {
    const res = await call(`/v1/items/${ID}/text`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, PUT, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Authorization, Content-Type");
    expect(supabase).not.toHaveBeenCalled();
  });

  it("puts CORS on errors", async () => {
    const res = await call(`/v1/items/${ID}/text`);
    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({
      error: { message: expect.any(String), code: "unauthorized" },
    });
  });

  it("rejects a bad id", async () => {
    const res = await call("/v1/items/not-a-uuid/text", { headers: bearer });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("bad_request");
    expect(supabase).not.toHaveBeenCalled();
  });

  it("404s unknown paths", async () => {
    const res = await call("/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });

  it("405s other methods", async () => {
    const res = await call(`/v1/items/${ID}/text`, { method: "DELETE", headers: bearer });
    expect(res.status).toBe(405);
    expect(((await res.json()) as any).error.code).toBe("method_not_allowed");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const post = await call("/health", { method: "POST" });
    expect(post.status).toBe(405);
  });
});

describe("auth", () => {
  it("requires an Authorization header", async () => {
    const res = await call(`/v1/items/${ID}/text`);
    expect(res.status).toBe(401);
  });

  it("rejects unknown schemes", async () => {
    const res = await call(`/v1/items/${ID}/text`, { headers: { Authorization: "Basic abc" } });
    expect(res.status).toBe(401);
  });

  it("asks Supabase with the caller's token", async () => {
    bucket.objects.set(`items/${ID}/text.md`, {
      bytes: new TextEncoder().encode("hi"),
      options: { httpMetadata: { contentType: "text/markdown; charset=utf-8" } },
    });
    await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(supabase).toHaveBeenCalledTimes(1);
    const [url, init] = supabase.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/rest/v1/rpc/content_access");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      apikey: "pub-key",
      Authorization: "Bearer user-token",
      "Content-Type": "application/json",
    });
    expect(init.body).toBe(JSON.stringify({ p_item_id: ID }));
  });

  it("maps a Supabase 401 to 401", async () => {
    supabaseReturns(401, { message: "JWT expired" });
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe("unauthorized");
  });

  it("maps a Supabase 403 to 401", async () => {
    supabaseReturns(403, {});
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(401);
  });

  it("maps other Supabase failures to 502 upstream", async () => {
    supabaseReturns(500, {});
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error.code).toBe("upstream");
  });

  it("maps a network failure to 502", async () => {
    supabase.mockRejectedValue(new Error("down"));
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(502);
  });

  it("404s when content_access returns null", async () => {
    supabaseReturns(200, null);
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });
});

describe("text", () => {
  it("reads stored text with ETag and no-store", async () => {
    await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("ETag")).toBe(`"${HELLO_SHA}"`);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("404s a missing object", async () => {
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe("not_found");
  });

  it("stores text from an editor", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { sha256: HELLO_SHA, bytes: 5 } });
    const stored = bucket.objects.get(`items/${ID}/text.md`)!;
    expect(new TextDecoder().decode(stored.bytes)).toBe("hello");
    expect(stored.options.httpMetadata?.contentType).toBe("text/markdown; charset=utf-8");
    expect(stored.options.customMetadata).toEqual({ sha256: HELLO_SHA });
  });

  it("counts bytes, not characters", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "héllo",
    });
    expect(((await res.json()) as any).data.bytes).toBe(6);
  });

  it("refuses a viewer", async () => {
    supabaseReturns(200, access({ can_edit: false }));
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe("forbidden");
    expect(bucket.objects.size).toBe(0);
  });

  it("lets a viewer read", async () => {
    bucket.objects.set(`items/${ID}/text.md`, {
      bytes: new TextEncoder().encode("hi"),
      options: { customMetadata: { sha256: "abc" } },
    });
    supabaseReturns(200, access({ can_edit: false }));
    const res = await call(`/v1/items/${ID}/text`, { headers: bearer });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("returns 507 when storage is full", async () => {
    supabaseReturns(200, access({ used_bytes: 9_499_999_998 }));
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    expect(res.status).toBe(507);
    expect(((await res.json()) as any).error.code).toBe("storage_full");
    expect(bucket.objects.size).toBe(0);
  });

  it("honours STORAGE_LIMIT_BYTES", async () => {
    env.STORAGE_LIMIT_BYTES = "10";
    supabaseReturns(200, access({ used_bytes: 6 }));
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    expect(res.status).toBe(507);
  });

  it("accepts a write that exactly fills storage", async () => {
    supabaseReturns(200, access({ used_bytes: 9_499_999_995 }));
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: "hello",
    });
    expect(res.status).toBe(200);
  });

  it("rejects too large by Content-Length", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: { ...bearer, "Content-Length": String(10 * 1024 * 1024 + 1) },
      body: "small",
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.code).toBe("too_large");
  });

  it("rejects too large by actual body", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: new Uint8Array(10 * 1024 * 1024 + 1).fill(97),
    });
    expect(res.status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });

  it("accepts exactly 10 MiB", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: new Uint8Array(10 * 1024 * 1024).fill(97),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid UTF-8", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: bearer,
      body: new Uint8Array([0x68, 0xff, 0xfe, 0x69]),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("bad_request");
    expect(bucket.objects.size).toBe(0);
  });
});

describe("file", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

  it("requires an image content type", async () => {
    for (const type of ["text/plain", "application/octet-stream", ""]) {
      const res = await call(`/v1/items/${ID}/file`, {
        method: "PUT",
        headers: type ? { ...bearer, "Content-Type": type } : bearer,
        body: png,
      });
      expect(res.status).toBe(400);
    }
    expect(bucket.objects.size).toBe(0);
  });

  it("stores an image and serves it with its content type", async () => {
    const put = await call(`/v1/items/${ID}/file`, {
      method: "PUT",
      headers: { ...bearer, "Content-Type": "image/png" },
      body: png,
    });
    expect(put.status).toBe(200);
    const data = ((await put.json()) as any).data;
    expect(data.bytes).toBe(7);
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket.objects.has(`items/${ID}/file`)).toBe(true);

    const got = await call(`/v1/items/${ID}/file`, { headers: bearer });
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("image/png");
    expect(got.headers.get("ETag")).toBe(`"${data.sha256}"`);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(png);
  });

  it("404s a missing file", async () => {
    const res = await call(`/v1/items/${ID}/file`, { headers: bearer });
    expect(res.status).toBe(404);
  });

  it("rejects a file over 25 MiB", async () => {
    const res = await call(`/v1/items/${ID}/file`, {
      method: "PUT",
      headers: { ...bearer, "Content-Type": "image/png" },
      body: new Uint8Array(25 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(413);
  });

  it("allows a file bigger than the text limit", async () => {
    const res = await call(`/v1/items/${ID}/file`, {
      method: "PUT",
      headers: { ...bearer, "Content-Type": "image/jpeg" },
      body: new Uint8Array(11 * 1024 * 1024),
    });
    expect(res.status).toBe(200);
  });
});

describe("service secret", () => {
  it("gets full access without calling Supabase or checking storage", async () => {
    env.STORAGE_LIMIT_BYTES = "1";
    const res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: { Authorization: "Service s3cret" },
      body: "hello",
    });
    expect(res.status).toBe(200);
    expect(supabase).not.toHaveBeenCalled();
    const got = await call(`/v1/items/${ID}/text`, {
      headers: { Authorization: "Service s3cret" },
    });
    expect(await got.text()).toBe("hello");
  });

  it("rejects a wrong secret", async () => {
    const res = await call(`/v1/items/${ID}/text`, {
      headers: { Authorization: "Service nope" },
    });
    expect(res.status).toBe(401);
    expect(supabase).not.toHaveBeenCalled();
  });

  it("never matches when SERVICE_SECRET is empty or missing", async () => {
    env.SERVICE_SECRET = "";
    let res = await call(`/v1/items/${ID}/text`, { headers: { Authorization: "Service " } });
    expect(res.status).toBe(401);
    res = await call(`/v1/items/${ID}/text`, { headers: { Authorization: "Service x" } });
    expect(res.status).toBe(401);
    delete env.SERVICE_SECRET;
    res = await call(`/v1/items/${ID}/text`, { headers: { Authorization: "Service x" } });
    expect(res.status).toBe(401);
  });

  it("accepts the secret when the Worker holds only its SHA-256", async () => {
    delete env.SERVICE_SECRET;
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("hashed-secret")),
    );
    env.SERVICE_SECRET_SHA256 = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    let res = await call(`/v1/items/${ID}/text`, {
      method: "PUT",
      headers: { Authorization: "Service hashed-secret" },
      body: "hello",
    });
    expect(res.status).toBe(200);
    res = await call(`/v1/items/${ID}/text`, { headers: { Authorization: "Service other" } });
    expect(res.status).toBe(401);
    env.SERVICE_SECRET_SHA256 = "not-hex";
    res = await call(`/v1/items/${ID}/text`, {
      headers: { Authorization: "Service hashed-secret" },
    });
    expect(res.status).toBe(401);
  });
});
