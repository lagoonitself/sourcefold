import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// `fetch` for addresses that people paste in. Anyone can sign up, so a pasted link (or a
// redirect, or an image inside a post) must never make the server request something private:
// loopback, the local network, cloud metadata or the function runtime's own endpoints.
// Each redirect is followed by hand so every hop gets the same check.

const MAX_REDIRECTS = 5;

export class BlockedAddressError extends Error {
  constructor() {
    super("That address isn't a public web page.");
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

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BlockedAddressError();
  if (url.port && url.port !== "80" && url.port !== "443") throw new BlockedAddressError();
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
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new TypeError(`Couldn't look up ${host}`);
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new BlockedAddressError();
  }
}

export const publicFetch: typeof fetch = async (input, init) => {
  let url = new URL(input instanceof Request ? input.url : input.toString());
  let currentInit: RequestInit = { ...init, redirect: "manual" };

  for (let hop = 0; ; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url.href, currentInit);
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= MAX_REDIRECTS) throw new TypeError("Too many redirects");

    await res.body?.cancel();
    url = new URL(location, url);
    // Same rules as the browser: 303 (and 301/302 after a POST) become a GET without a body.
    const method = (currentInit.method ?? "GET").toUpperCase();
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
      currentInit = { ...currentInit, method: "GET", body: undefined };
    }
  }
};
