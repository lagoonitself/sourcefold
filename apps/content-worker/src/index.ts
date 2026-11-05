import type { Env } from "./env";

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_STORAGE_LIMIT = 9_500_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE = /^\/v1\/items\/([^/]+)\/(text|file)$/;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "ETag",
  "Access-Control-Max-Age": "86400",
};

type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "too_large"
  | "storage_full"
  | "method_not_allowed"
  | "upstream";

interface Access {
  canRead: boolean;
  canEdit: boolean;
  usedBytes: number;
  service: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function withCors(headers: Record<string, string> = {}): Headers {
  return new Headers({ ...CORS, ...headers });
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "Content-Type": "application/json; charset=utf-8", ...extra }),
  });
}

function errorResponse(err: HttpError, extra: Record<string, string> = {}): Response {
  return json(err.status, { error: { message: err.message, code: err.code } }, extra);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256Bytes(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await sha256Bytes(data));
}

// The website's server proves itself with a shared secret. The Worker can hold just the secret's
// SHA-256 (`SERVICE_SECRET_SHA256`), so the secret itself never has to be stored in Cloudflare.
async function secretMatches(given: string, env: Env): Promise<boolean> {
  const enc = new TextEncoder();
  let expected: Uint8Array | null = null;
  const hex = (env.SERVICE_SECRET_SHA256 ?? "").trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) {
    expected = new Uint8Array(32);
    for (let i = 0; i < 32; i++) expected[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  } else if (env.SERVICE_SECRET) {
    expected = await sha256Bytes(enc.encode(env.SERVICE_SECRET));
  }
  if (!expected || !given) return false;
  const actual = await sha256Bytes(enc.encode(given));
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

function storageLimit(env: Env): number {
  const raw = env.STORAGE_LIMIT_BYTES;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_STORAGE_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STORAGE_LIMIT;
}

async function authorize(request: Request, env: Env, itemId: string): Promise<Access> {
  const header = request.headers.get("Authorization") ?? "";
  const space = header.indexOf(" ");
  const scheme = (space === -1 ? header : header.slice(0, space)).toLowerCase();
  const credential = space === -1 ? "" : header.slice(space + 1).trim();
  if (!credential) throw new HttpError(401, "unauthorized", "Sign in to use this.");

  if (scheme === "service") {
    if (await secretMatches(credential, env)) {
      return { canRead: true, canEdit: true, usedBytes: 0, service: true };
    }
    throw new HttpError(401, "unauthorized", "Sign in to use this.");
  }
  if (scheme !== "bearer") throw new HttpError(401, "unauthorized", "Sign in to use this.");

  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/content_access`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_item_id: itemId }),
    });
  } catch {
    throw new HttpError(502, "upstream", "Could not reach the sign-in service.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(401, "unauthorized", "Sign in to use this.");
  }
  if (!res.ok) throw new HttpError(502, "upstream", "The sign-in service failed.");

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new HttpError(502, "upstream", "The sign-in service sent something unexpected.");
  }
  if (data === null || typeof data !== "object") {
    throw new HttpError(404, "not_found", "Not found.");
  }
  const row = data as { can_read?: unknown; can_edit?: unknown; used_bytes?: unknown };
  return {
    canRead: row.can_read === true,
    canEdit: row.can_edit === true,
    usedBytes: Number(row.used_bytes) || 0,
    service: false,
  };
}

async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > limit) {
    throw new HttpError(413, "too_large", "That is too large.");
  }
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw new HttpError(413, "too_large", "That is too large.");
  return bytes;
}

async function handleGet(env: Env, key: string, fallbackType: string): Promise<Response> {
  const object = await env.CONTENT.get(key);
  if (!object) throw new HttpError(404, "not_found", "Not found.");
  const headers = withCors({
    "Content-Type": object.httpMetadata?.contentType ?? fallbackType,
    "Cache-Control": "no-store",
  });
  const sha = object.customMetadata?.sha256;
  if (sha) headers.set("ETag", `"${sha}"`);
  return new Response(object.body, { status: 200, headers });
}

async function handlePut(
  request: Request,
  env: Env,
  access: Access,
  kind: "text" | "file",
  key: string,
): Promise<Response> {
  if (!access.canEdit) {
    throw new HttpError(403, "forbidden", "You can view this project but not change it.");
  }
  const limit = kind === "text" ? MAX_TEXT_BYTES : MAX_FILE_BYTES;
  let contentType = "text/markdown; charset=utf-8";
  if (kind === "file") {
    contentType = (request.headers.get("Content-Type") ?? "").trim();
    if (!/^image\/[^\s;]+/i.test(contentType)) {
      throw new HttpError(400, "bad_request", "Send an image with an image/* Content-Type.");
    }
  }
  const bytes = await readBody(request, limit);
  if (kind === "text") {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new HttpError(400, "bad_request", "The text must be valid UTF-8.");
    }
  }
  if (!access.service && access.usedBytes + bytes.byteLength > storageLimit(env)) {
    throw new HttpError(507, "storage_full", "Storage is full.");
  }
  const sha256 = await sha256Hex(bytes);
  await env.CONTENT.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { sha256 },
  });
  return json(200, { data: { sha256, bytes: bytes.byteLength } });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health") {
    if (request.method !== "GET") {
      throw new HttpError(405, "method_not_allowed", "Use GET.");
    }
    return json(200, { data: { status: "ok" } });
  }

  const match = ROUTE.exec(path);
  if (!match) throw new HttpError(404, "not_found", "Not found.");
  const id = match[1] ?? "";
  const kind = match[2] === "text" ? "text" : "file";

  if (request.method !== "GET" && request.method !== "PUT") {
    throw new HttpError(405, "method_not_allowed", "Use GET or PUT.");
  }
  if (!UUID.test(id)) throw new HttpError(400, "bad_request", "The item id must be a UUID.");

  const access = await authorize(request, env, id);
  if (!access.canRead && !access.canEdit) throw new HttpError(404, "not_found", "Not found.");

  const key = kind === "text" ? `items/${id}/text.md` : `items/${id}/file`;
  if (request.method === "GET") {
    return handleGet(
      env,
      key,
      kind === "text" ? "text/markdown; charset=utf-8" : "application/octet-stream",
    );
  }
  return handlePut(request, env, access, kind, key);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResponse(err, err.status === 405 ? { Allow: "GET, PUT, OPTIONS" } : {});
      }
      return errorResponse(new HttpError(500, "upstream", "Something went wrong."));
    }
  },
};
