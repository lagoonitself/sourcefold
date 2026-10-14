export type SourceKind = "grokipedia" | "substack" | "x";

export class InvalidUrlError extends Error {
  constructor(message?: string) {
    super(message ?? "Invalid URL");
    this.name = "InvalidUrlError";
  }
}

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"]);

const ALWAYS_STRIP_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "'", '"', ">"]);

function stripTrailingPunctuation(url: string): string {
  let current = url;
  while (current.length > 0) {
    const lastChar = current[current.length - 1];
    if (!lastChar) {
      break;
    }
    if (ALWAYS_STRIP_PUNCTUATION.has(lastChar)) {
      current = current.slice(0, -1);
    } else if (lastChar === ")") {
      const openCount = (current.match(/\(/g) || []).length;
      const closeCount = (current.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        current = current.slice(0, -1);
      } else {
        break;
      }
    } else if (lastChar === "]") {
      const openCount = (current.match(/\[/g) || []).length;
      const closeCount = (current.match(/\]/g) || []).length;
      if (closeCount > openCount) {
        current = current.slice(0, -1);
      } else {
        break;
      }
    } else if (lastChar === "}") {
      const openCount = (current.match(/\{/g) || []).length;
      const closeCount = (current.match(/\}/g) || []).length;
      if (closeCount > openCount) {
        current = current.slice(0, -1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return current;
}

function normalizeHost(host: string): string {
  let normalized = host.toLowerCase();
  if (normalized.startsWith("www.")) {
    normalized = normalized.slice(4);
  }
  return normalized;
}

export function canonicalizeUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidUrlError(`Cannot parse URL: "${input}"`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidUrlError(`Unsupported protocol "${parsed.protocol}" in URL: "${input}"`);
  }

  const normalizedHost = normalizeHost(parsed.hostname);
  let host = normalizedHost;
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    host = `${host}:${parsed.port}`;
  }

  // Path handling: remove trailing slashes
  const pathname = parsed.pathname.replace(/\/+$/, "");

  // Check X / Twitter
  if (X_HOSTS.has(normalizedHost)) {
    // /i/web/status/<id> -> https://x.com/i/status/<id>
    const iWebMatch = pathname.match(/^\/i\/web\/status\/([^/]+)(?:\/.*)?$/);
    if (iWebMatch && iWebMatch[1]) {
      return `https://x.com/i/status/${iWebMatch[1]}`;
    }

    // /<handle>/status/<id>/<anything> -> https://x.com/<handle>/status/<id>
    const statusMatch = pathname.match(/^\/([^/]+)\/status\/([^/]+)(?:\/.*)?$/);
    if (statusMatch && statusMatch[1] && statusMatch[2]) {
      const handle = statusMatch[1].toLowerCase();
      const id = statusMatch[2];
      return `https://x.com/${handle}/status/${id}`;
    }

    // Everything else on X: host is x.com, path kept as is
    return pathname ? `https://x.com${pathname}` : "https://x.com";
  }

  // Check Grokipedia
  if (host === "grokipedia.com") {
    if (pathname.startsWith("/page/")) {
      const rawTitle = pathname.slice("/page/".length);
      let decodedTitle = rawTitle;
      try {
        decodedTitle = decodeURIComponent(rawTitle);
        decodedTitle = decodedTitle.replace(/ /g, "_");
        decodedTitle = decodedTitle.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
      } catch {
        decodedTitle = rawTitle.replace(/ /g, "_");
      }
      return `https://grokipedia.com/page/${decodedTitle}`;
    }

    return pathname ? `https://grokipedia.com${pathname}` : "https://grokipedia.com";
  }

  // Everything else: path kept as is (case preserved)
  return pathname ? `https://${host}${pathname}` : `https://${host}`;
}

export function detectSource(url: string): SourceKind | null {
  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const host = normalizeHost(parsed.hostname);
    const pathname = parsed.pathname.replace(/\/+$/, "");

    if (host === "grokipedia.com") {
      if (pathname.startsWith("/page/") && pathname.length > "/page/".length) {
        return "grokipedia";
      }
      return null;
    }

    if (X_HOSTS.has(host)) {
      if (pathname.match(/^\/i\/web\/status\/([^/]+)(?:\/.*)?$/)) {
        return "x";
      }
      if (pathname.match(/^\/([^/]+)\/status\/([^/]+)(?:\/.*)?$/)) {
        return "x";
      }
      return null;
    }

    // Substack: <sub>.substack.com/p/<slug>
    if (host.endsWith(".substack.com") && host !== "substack.com") {
      const sub = host.slice(0, -".substack.com".length);
      if (sub.length > 0 && !sub.includes(".")) {
        if (pathname.match(/^\/p\/([^/]+)(?:\/.*)?$/)) {
          return "substack";
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function xStatusId(url: string): string | null {
  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const host = normalizeHost(parsed.hostname);
    if (!X_HOSTS.has(host)) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");

    const iWebMatch = pathname.match(/^\/i\/web\/status\/([^/]+)(?:\/.*)?$/);
    if (iWebMatch && iWebMatch[1]) {
      return iWebMatch[1];
    }

    const statusMatch = pathname.match(/^\/([^/]+)\/status\/([^/]+)(?:\/.*)?$/);
    if (statusMatch && statusMatch[2]) {
      return statusMatch[2];
    }

    return null;
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s]+?(?=(?:https?:\/\/|\s|$))/g;
  const matches = text.match(urlPattern);
  if (!matches) {
    return [];
  }

  const seenCanonical = new Set<string>();
  const result: string[] = [];

  for (const match of matches) {
    const cleaned = stripTrailingPunctuation(match);
    if (!cleaned) {
      continue;
    }

    try {
      const canonical = canonicalizeUrl(cleaned);
      if (!seenCanonical.has(canonical)) {
        seenCanonical.add(canonical);
        result.push(cleaned);
      }
    } catch {
      // Invalid ones skipped
    }
  }

  return result;
}
