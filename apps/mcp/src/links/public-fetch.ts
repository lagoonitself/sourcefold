import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SourceError, type SourceFetch } from "@sourcefold/core";

// Network access for links Claude adds. Like the web app's `publicFetch` (apps/web/src/lib/
// public-fetch.ts, copied here because the MCP server can't import the web app) and the desktop's
// Rust `web_fetch`: a link, or a redirect it leads to, must never reach this computer or the local
// network (the desktop app's own server listens on 127.0.0.1). Each redirect is followed by hand so
// every hop gets the same check.

const MAX_REDIRECTS = 10;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

/** The desktop's `web_fetch` sends the same, so sites see an ordinary browser. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export class BlockedAddressError extends Error {
  constructor() {
    super("Sourcefold doesn't open links to this computer or your local network.");
    this.name = "BlockedAddressError";
  }
}

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(address: string): boolean {
  const p = ipv4Parts(address);
  if (!p) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped (::ffff:1.2.3.4) and NAT64 (64:ff9b::1.2.3.4) addresses carry an IPv4 inside.
  const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isPrivateIpv4(embedded[1]!);
  if (lower.startsWith("::ffff:") || lower.startsWith("64:ff9b:")) return true;
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address.replace(/^\[|\]$/g, ""));
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export type Lookup = (host: string) => Promise<{ address: string }[]>;

const systemLookup: Lookup = (host) => lookup(host, { all: true, verbatim: true });

export async function assertPublicUrl(url: URL, resolve: Lookup = systemLookup): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedAddressError();
  if (url.username || url.password) throw new BlockedAddressError();

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new BlockedAddressError();
    return;
  }
  const name = host.toLowerCase();
  if (!name.includes(".") || /\.(local|internal|localhost|lan|home|corp)$/.test(name)) {
    throw new BlockedAddressError();
  }

  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new TypeError(`Couldn't look up ${host}`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new BlockedAddressError();
  }
}

export interface PublicFetchDeps {
  fetch?: typeof fetch;
  lookup?: Lookup;
}

/** `fetch` that refuses private addresses on every hop. */
export function createPublicFetch(deps: PublicFetchDeps = {}): typeof fetch {
  const fetchImpl = deps.fetch ?? fetch;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : input.toString());
    let currentInit: RequestInit = { ...init, redirect: "manual" };

    for (let hop = 0; ; hop++) {
      await assertPublicUrl(url, deps.lookup);
      const res = await fetchImpl(url.href, currentInit);
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || !location) {
        // Node's Response.url is empty for a hand-built request chain; record where we ended.
        Object.defineProperty(res, "url", { value: url.href });
        return res;
      }
      if (hop >= MAX_REDIRECTS) throw new TypeError("Too many redirects");

      await res.body?.cancel();
      url = new URL(location, url);
      const method = (currentInit.method ?? "GET").toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        currentInit = { ...currentInit, method: "GET", body: undefined };
      }
    }
  }) as typeof fetch;
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await res.body?.cancel();
    throw new SourceError("too_large", "This file is too large to save.");
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new SourceError("too_large", "This file is too large to save.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** The `SourceFetch` the core extractors get: this computer's own connection, like the desktop. */
export function createNodeSourceFetch(deps: PublicFetchDeps = {}): SourceFetch {
  const guarded = createPublicFetch(deps);
  return async (request) => {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }
    headers["user-agent"] ??= BROWSER_USER_AGENT;
    headers["accept-language"] ??= "en-US,en;q=0.9";

    let res: Response;
    try {
      res = await guarded(request.url, {
        method: request.method ?? "GET",
        headers,
        body: request.body,
        signal: request.signal,
      });
    } catch (err) {
      if (err instanceof BlockedAddressError) throw new SourceError("blocked", err.message);
      if (err instanceof Error && err.name === "AbortError") throw err;
      throw new SourceError(
        "fetch_failed",
        "Couldn't reach the site. Check your connection and try again.",
      );
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      responseHeaders[name.toLowerCase()] = value;
    });
    const bytes = await readCapped(res);
    if (request.responseType === "bytes") {
      return {
        status: res.status,
        url: res.url || request.url,
        headers: responseHeaders,
        text: "",
        bytes,
      };
    }
    return {
      status: res.status,
      url: res.url || request.url,
      headers: responseHeaders,
      text: new TextDecoder().decode(bytes),
    };
  };
}
