import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { SourceError, type SourceFetch } from "@sourcefold/core";
import { nodeFetch } from "./node-transport";

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

export const CHROME_HEADERS: Record<string, string> = {
  "user-agent": BROWSER_USER_AGENT,
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "accept-encoding": "gzip, deflate, br",
  "sec-ch-ua": '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

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

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
}

function parseSetCookie(header: string, defaultDomain: string): StoredCookie | null {
  const parts = header.split(";");
  const nv = parts[0]?.trim();
  if (!nv) return null;
  const eq = nv.indexOf("=");
  const name = eq >= 0 ? nv.slice(0, eq).trim() : nv;
  const value = eq >= 0 ? nv.slice(eq + 1).trim() : "";
  let domain = defaultDomain.toLowerCase();
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!.trim();
    const pEq = part.indexOf("=");
    const attrName = (pEq >= 0 ? part.slice(0, pEq) : part).trim().toLowerCase();
    const attrVal = (pEq >= 0 ? part.slice(pEq + 1) : "").trim();
    if (attrName === "domain" && attrVal) {
      domain = attrVal.toLowerCase().replace(/^\./, "");
    }
  }
  return { name, value, domain };
}

/** `fetch` that refuses private addresses on every hop. */
export function createPublicFetch(deps: PublicFetchDeps = {}): typeof fetch {
  const fetchImpl = deps.fetch ?? nodeFetch;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    let url = new URL(input instanceof Request ? input.url : input.toString());
    let currentInit: RequestInit = { ...init, redirect: "manual" };
    const jar: StoredCookie[] = [];

    for (let hop = 0; ; hop++) {
      await assertPublicUrl(url, deps.lookup);

      if (jar.length > 0) {
        const nextHost = url.hostname.toLowerCase();
        const matching = jar.filter(
          (c) => nextHost === c.domain || nextHost.endsWith("." + c.domain),
        );
        if (matching.length > 0) {
          const cookieVal = matching.map((c) => `${c.name}=${c.value}`).join("; ");
          const headers = new Headers(currentInit.headers);
          const existing = headers.get("cookie");
          headers.set("cookie", existing ? `${existing}; ${cookieVal}` : cookieVal);
          currentInit = { ...currentInit, headers };
        }
      }

      const res = await fetchImpl(url.href, currentInit);

      const setCookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : res.headers.get("set-cookie")
            ? [res.headers.get("set-cookie")!]
            : [];
      for (const cookieStr of setCookies) {
        const parsed = parseSetCookie(cookieStr, url.hostname);
        if (parsed) {
          const existingIdx = jar.findIndex(
            (c) => c.name === parsed.name && c.domain === parsed.domain,
          );
          if (existingIdx >= 0) {
            jar[existingIdx] = parsed;
          } else {
            jar.push(parsed);
          }
        }
      }

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

function isTlsErrorCode(code?: string): boolean {
  if (!code) return false;
  return (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("CERT_") ||
    code.startsWith("ERR_SSL_") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "EPROTO"
  );
}

/** The `SourceFetch` the core extractors get: this computer's own connection, like the desktop. */
export function createNodeSourceFetch(deps: PublicFetchDeps = {}): SourceFetch {
  const guarded = createPublicFetch(deps);
  return async (request) => {
    const headers: Record<string, string> = { ...CHROME_HEADERS };
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }

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
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw err;
      }

      const code = (err as { code?: string })?.code;
      const message = (err as Error)?.message ?? "";

      if (
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN" ||
        (err instanceof TypeError && message.startsWith("Couldn't look up"))
      ) {
        throw new SourceError(
          "fetch_failed",
          "Couldn't find the site's address (DNS lookup failed). Check the link.",
        );
      }
      if (code === "ECONNREFUSED") {
        throw new SourceError("fetch_failed", "The site refused the connection.");
      }
      if (code === "ECONNRESET" || code === "EPIPE") {
        throw new SourceError("fetch_failed", "The site closed the connection before answering.");
      }
      if (code === "ETIMEDOUT") {
        throw new SourceError("fetch_failed", "The site didn't answer in time.");
      }
      if (isTlsErrorCode(code)) {
        throw new SourceError(
          "fetch_failed",
          "Couldn't make a secure connection to the site (its certificate or encryption was refused).",
        );
      }
      if (err instanceof TypeError && message === "Too many redirects") {
        throw new SourceError(
          "fetch_failed",
          "The site kept redirecting, so the page never loaded.",
        );
      }
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
