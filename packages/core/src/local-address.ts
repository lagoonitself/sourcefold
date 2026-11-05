// Links Sourcefold must never open for someone else: this computer and the local network. The
// check reads only the address itself (no DNS), so it runs anywhere: the web's link queue, the
// desktop app and the extension before they open a queued link (QA 2026-11-05: links to a router
// and 169.254.169.254 were queued for the user's computer and Chrome). Servers that can resolve
// names also check what a name resolves to.

const LOCAL_SUFFIX = /\.(?:local|internal|localhost|lan|home|corp|intranet|arpa)$/;

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function privateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224
  );
}

function privateIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (mapped) {
    const parts = ipv4(mapped);
    return !parts || privateIpv4(parts);
  }
  // The URL parser writes mapped addresses in hex (::ffff:7f00:1).
  if (lower.startsWith("::ffff:") || lower.startsWith("64:ff9b:")) return true;
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

/** True for a URL (or host name) on this computer or the local network, or one that isn't a URL. */
export function isLocalNetworkUrl(input: string): boolean {
  let host: string;
  try {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      ? new URL(input)
      : new URL(`http://${input}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return true;
    host = url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return true;
  }
  if (!host) return true;
  if (host.startsWith("[")) return privateIpv6(host.slice(1, -1));
  const v4 = ipv4(host);
  if (v4) return privateIpv4(v4);
  if (host.includes(":")) return privateIpv6(host);
  return host === "localhost" || !host.includes(".") || LOCAL_SUFFIX.test(host);
}
