// Approach ported from sbstck-dl by Alex Ferrari (MIT), https://github.com/alexferrari88/sbstck-dl
// Lists every post of a publication: the public archive API first (it has titles, dates and
// paid/free), then /sitemap.xml when the API is unavailable. Both work on custom domains.
// An error stops discovery; it never returns a partial list.

import { InvalidUrlError } from "../url";

export interface SubstackFetchResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  text: string;
  /** Seconds from a Retry-After header, when present. */
  retryAfter?: number | null;
}

export type SubstackFetch = (url: string) => Promise<SubstackFetchResponse>;

export interface DiscoveredPost {
  url: string;
  title: string | null;
  /** YYYY-MM-DD */
  published: string | null;
  access: "free" | "paid" | null;
}

export interface DiscoverOptions {
  /** YYYY-MM-DD; keeps posts published after this day. */
  after?: string | null;
  /** YYYY-MM-DD; keeps posts published before this day. */
  before?: string | null;
  signal?: AbortSignal;
  /** Called after each archive page with the number of posts found so far. */
  onProgress?: (found: number) => void;
}

const ARCHIVE_PAGE_SIZE = 50;
const MAX_ARCHIVE_PAGES = 400;

export class SubstackDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstackDiscoveryError";
  }
}

function withScheme(input: string): string {
  const trimmed = input.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The publication's origin, e.g. "https://name.substack.com" or "https://www.custom.com". */
export function substackPublicationRoot(input: string): string {
  let url: URL;
  try {
    url = new URL(withScheme(input));
  } catch {
    throw new InvalidUrlError("That isn't a valid link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidUrlError("That isn't a valid link.");
  }
  const host = url.hostname.toLowerCase();

  if (host === "open.substack.com") {
    const match = url.pathname.match(/^\/pub\/([^/]+)/);
    if (match?.[1]) return `https://${match[1].toLowerCase()}.substack.com`;
  }
  if (host === "substack.com" || host === "www.substack.com" || host === "open.substack.com") {
    throw new InvalidUrlError(
      "Use the publication's own address, like name.substack.com or its custom domain.",
    );
  }
  return `https://${host}`;
}

function cleanPostUrl(raw: string, root: URL): string | null {
  let url: URL;
  try {
    url = new URL(raw, root);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase() !== root.hostname.toLowerCase()) return null;
  if (!/^\/p\/[^/]+\/?$/.test(url.pathname)) return null;
  url.protocol = "https:";
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function dayOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (match?.[1]) return match[1];
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function inRange(day: string | null, options: DiscoverOptions): boolean {
  if (!options.after && !options.before) return true;
  if (!day) return false;
  if (options.after && !(day > options.after)) return false;
  if (options.before && !(day < options.before)) return false;
  return true;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
}

async function fromArchiveApi(
  root: URL,
  fetch: SubstackFetch,
  options: DiscoverOptions,
): Promise<DiscoveredPost[]> {
  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();
  let offset = 0;

  for (let page = 0; page < MAX_ARCHIVE_PAGES; page++) {
    throwIfAborted(options.signal);
    const endpoint = new URL("/api/v1/archive", root);
    endpoint.search = new URLSearchParams({
      sort: "new",
      offset: String(offset),
      limit: String(ARCHIVE_PAGE_SIZE),
    }).toString();

    const res = await fetch(endpoint.toString());
    if (res.status !== 200) {
      throw new SubstackDiscoveryError(`The archive returned status ${res.status}.`);
    }
    let items: unknown;
    try {
      items = JSON.parse(res.text);
    } catch {
      throw new SubstackDiscoveryError("The archive didn't return JSON.");
    }
    if (!Array.isArray(items)) {
      throw new SubstackDiscoveryError("The archive didn't return a list of posts.");
    }
    if (items.length === 0) return posts;

    for (const item of items) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const raw =
        typeof record.canonical_url === "string"
          ? record.canonical_url
          : typeof record.slug === "string"
            ? `/p/${record.slug}`
            : null;
      const url = raw ? cleanPostUrl(raw, root) : null;
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const published = dayOf(typeof record.post_date === "string" ? record.post_date : null);
      if (!inRange(published, options)) continue;
      const audience = typeof record.audience === "string" ? record.audience : null;
      posts.push({
        url,
        title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : null,
        published,
        access: audience ? (audience === "everyone" ? "free" : "paid") : null,
      });
    }
    offset += items.length;
    options.onProgress?.(posts.length);

    // Pages are newest first, so once a whole page is on or before `after`, nothing later qualifies.
    const lastRecord = items[items.length - 1] as Record<string, unknown> | null;
    const lastDay = dayOf(typeof lastRecord?.post_date === "string" ? lastRecord.post_date : null);
    if (options.after && lastDay && lastDay <= options.after) return posts;
  }
  throw new SubstackDiscoveryError("The archive kept going for too many pages.");
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

async function fromSitemap(
  root: URL,
  fetch: SubstackFetch,
  options: DiscoverOptions,
): Promise<DiscoveredPost[]> {
  throwIfAborted(options.signal);
  const res = await fetch(new URL("/sitemap.xml", root).toString());
  if (res.status !== 200) {
    throw new SubstackDiscoveryError(`The sitemap returned status ${res.status}.`);
  }
  if (!/<urlset[\s>]/.test(res.text)) {
    throw new SubstackDiscoveryError("The sitemap isn't a list of pages.");
  }

  const posts: DiscoveredPost[] = [];
  const seen = new Set<string>();
  for (const block of res.text.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1];
    if (!loc) continue;
    const url = cleanPostUrl(decodeXml(loc), root);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const lastmod = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1];
    const published = dayOf(lastmod ? decodeXml(lastmod) : null);
    if (!inRange(published, options)) continue;
    posts.push({ url, title: null, published, access: null });
  }
  if (seen.size === 0) {
    throw new SubstackDiscoveryError("The sitemap has no posts.");
  }
  posts.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
  return posts;
}

/** Lists the publication's posts, newest first. */
export async function discoverSubstackPosts(
  publicationUrl: string,
  fetch: SubstackFetch,
  options: DiscoverOptions = {},
): Promise<DiscoveredPost[]> {
  const root = new URL(substackPublicationRoot(publicationUrl));
  try {
    return await fromArchiveApi(root, fetch, options);
  } catch (apiError) {
    if (apiError instanceof DOMException && apiError.name === "AbortError") throw apiError;
    try {
      return await fromSitemap(root, fetch, options);
    } catch (sitemapError) {
      if (sitemapError instanceof DOMException && sitemapError.name === "AbortError") {
        throw sitemapError;
      }
      throw new SubstackDiscoveryError(
        `Couldn't list the posts of ${root.hostname}. Check it's a Substack publication.`,
      );
    }
  }
}
