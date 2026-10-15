// Classifies a pasted link. Post links on custom domains look like any "/p/<slug>" page;
// whether it's really Substack is decided after fetching (the page has Substack's preloads).

export type SubstackLinkKind = "post" | "publication";

export function isSubstackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "substack.com" || h.endsWith(".substack.com");
}

export function classifySubstackLink(input: string): SubstackLinkKind | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");

  if (host === "open.substack.com" && /^\/pub\/[^/]+\/p\/[^/]+$/.test(path)) return "post";
  if (/^\/p\/[^/]+$/.test(path)) return "post";
  if (isSubstackHost(host) && host !== "substack.com" && host !== "www.substack.com") {
    if (path === "" || path === "/archive") return "publication";
  }
  return null;
}

/** open.substack.com/pub/<name>/p/<slug> → https://<name>.substack.com/p/<slug>. */
export function normalizeSubstackPostUrl(input: string): string {
  const url = new URL(input.trim());
  const match = url.pathname.match(/^\/pub\/([^/]+)\/p\/([^/]+)/);
  if (url.hostname.toLowerCase() === "open.substack.com" && match?.[1] && match[2]) {
    return `https://${match[1].toLowerCase()}.substack.com/p/${match[2]}`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
