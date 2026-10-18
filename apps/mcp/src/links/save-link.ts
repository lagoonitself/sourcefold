import {
  canonicalizeUrl,
  canonicalWikipediaUrl,
  classifySubstackLink,
  createRateLimitedFetch,
  detectLinkKind,
  detectSource,
  discoverSubstackPosts,
  isWikipediaArticleUrl,
  normalizeSubstackPostUrl,
  parseYouTubeLink,
  type CaptureRequest,
  type SourceFetch,
  type SubstackFetch,
} from "@sourcefold/core";
import {
  WIKIPEDIA_ERROR_MESSAGES,
  WIKIPEDIA_USER_AGENT,
  extractSubstack,
  fetchSourceCapture,
  fetchWikipediaCapture,
  listYouTubeVideos,
} from "@sourcefold/core/capture";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import type { DesktopBridge } from "../desktop-bridge";
import type { Item } from "../types";
import type { WebApi } from "../web-api";

// One link at a time, the way the desktop's Add links saves it (apps/desktop/src/features/
// grokipedia/AddLinksDialog.tsx and the *-client.ts files it calls): Grokipedia through the web
// app, everything else fetched on this computer and saved through `POST /api/capture`.

export type LinkKind =
  "grokipedia" | "wikipedia" | "substack" | "publication" | "youtube_list" | "x" | "source";

export function classifyLink(url: string): LinkKind | null {
  const source = detectSource(url);
  const substack = classifySubstackLink(url);
  if (source === "grokipedia") return "grokipedia";
  if (isWikipediaArticleUrl(url)) return "wikipedia";
  if (source === "x") return "x";
  if (substack === "post") return "substack";
  if (substack === "publication") return "publication";
  if (detectLinkKind(url) === "youtube" && parseYouTubeLink(url)?.type !== "video") {
    return "youtube_list";
  }
  if (detectLinkKind(url)) return "source";
  return null;
}

/** What a saved row shows as its kind: "YouTube", "Wikipedia"… (matches format.ts kinds). */
export function itemKindOf(url: string, kind: LinkKind): string {
  if (kind === "grokipedia" || kind === "wikipedia" || kind === "x") return kind;
  if (kind === "substack" || kind === "publication") return "substack";
  if (kind === "youtube_list") return "youtube";
  return detectLinkKind(url) ?? "web";
}

export type SaveOutcome =
  | { status: "saved"; title: string; itemId: string; message?: string }
  | { status: "duplicate"; title: string | null; message: string }
  | { status: "unavailable"; title: string; message: string }
  | { status: "paid"; title: string; message: string };

export interface LinkDeps {
  api: WebApi;
  desktop: DesktopBridge;
  sourceFetch: SourceFetch;
  /** Guarded `fetch` for libraries that take a WHATWG fetch (Wikipedia). */
  publicFetch: typeof fetch;
  /** Whether the desktop app answered when the job started (paid Substack posts need it). */
  desktopOpen: boolean;
}

interface CheckUrlResult {
  exists: boolean;
  folder_name?: string | null;
}

function canonical(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

function alreadySaved(folderName: string | null | undefined): string {
  return `Already saved in ${folderName || "this group"}`;
}

function isDuplicateError(err: unknown): err is Error {
  return err instanceof Error && /already saved/i.test(err.message);
}

async function checkUrl(api: WebApi, url: string, groupId: string): Promise<CheckUrlResult> {
  return api.post<CheckUrlResult>("/items/check", { url, folder_id: groupId });
}

async function capture(api: WebApi, request: CaptureRequest): Promise<Item> {
  const res = await api.post<{ item?: Item } | Item>("/capture", request);
  return (res as { item?: Item }).item ?? (res as Item);
}

/** Saves through `/api/capture`; an "already saved" refusal becomes a duplicate. */
async function captureOrDuplicate(
  api: WebApi,
  request: CaptureRequest,
  title: string,
): Promise<SaveOutcome> {
  try {
    const item = await capture(api, request);
    return { status: "saved", title: item.title || title, itemId: item.id };
  } catch (err) {
    if (isDuplicateError(err)) return { status: "duplicate", title, message: err.message };
    throw err;
  }
}

export async function saveLink(
  url: string,
  kind: LinkKind,
  groupId: string,
  deps: LinkDeps,
  signal?: AbortSignal,
): Promise<SaveOutcome> {
  switch (kind) {
    case "grokipedia":
      return saveGrokipedia(url, groupId, deps);
    case "wikipedia":
      return saveWikipedia(url, groupId, deps, signal);
    case "substack":
      return saveSubstack(url, groupId, deps);
    case "source":
      return saveSource(url, groupId, deps, signal);
    case "x":
      throw new Error(
        "X posts are saved with the Sourcefold extension: open the post in Chrome and click Save.",
      );
    case "publication":
    case "youtube_list":
      throw new Error("Lists are expanded into their posts or videos before saving.");
  }
}

async function saveGrokipedia(url: string, groupId: string, { api }: LinkDeps) {
  const check = await checkUrl(api, url, groupId);
  if (check.exists) {
    return { status: "duplicate", title: null, message: alreadySaved(check.folder_name) } as const;
  }
  try {
    const res = await api.post<{ item?: Item } | Item>("/grokipedia", {
      url,
      folder_id: groupId,
    });
    const item = (res as { item?: Item }).item ?? (res as Item);
    return { status: "saved", title: item.title || url, itemId: item.id } as const;
  } catch (err) {
    if (isDuplicateError(err))
      return { status: "duplicate", title: null, message: err.message } as const;
    throw err;
  }
}

async function saveWikipedia(
  inputUrl: string,
  groupId: string,
  { api, publicFetch }: LinkDeps,
  signal?: AbortSignal,
): Promise<SaveOutcome> {
  const url = canonicalWikipediaUrl(inputUrl);
  if (!url) throw new Error(WIKIPEDIA_ERROR_MESSAGES.invalid_url);
  const before = await checkUrl(api, url, groupId);
  if (before.exists) {
    return { status: "duplicate", title: null, message: alreadySaved(before.folder_name) };
  }
  const article = await fetchWikipediaCapture(url, {
    parseHtml: parseHtmlOnServer,
    fetch: publicFetch,
    headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    signal,
  });
  if (article.url !== url) {
    const resolved = await checkUrl(api, article.url, groupId);
    if (resolved.exists) {
      return {
        status: "duplicate",
        title: article.title,
        message: alreadySaved(resolved.folder_name),
      };
    }
  }
  return captureOrDuplicate(
    api,
    { kind: "wikipedia", folder_id: groupId, capture: article },
    article.title,
  );
}

async function saveSource(
  inputUrl: string,
  groupId: string,
  { api, sourceFetch }: LinkDeps,
  signal?: AbortSignal,
): Promise<SaveOutcome> {
  const url = canonical(inputUrl);
  const before = await checkUrl(api, url, groupId);
  if (before.exists) {
    return { status: "duplicate", title: null, message: alreadySaved(before.folder_name) };
  }

  // Throws a SourceError whose message says what to do.
  const result = await fetchSourceCapture(inputUrl, {
    fetch: sourceFetch,
    parseHtml: parseHtmlOnServer,
    signal,
  });

  if (result.status === "unavailable") {
    try {
      await capture(api, {
        kind: "source_unavailable",
        folder_id: groupId,
        source: result.kind,
        url: result.url,
        title: result.title,
        reason: result.reason,
      });
    } catch (err) {
      if (!isDuplicateError(err)) throw err;
    }
    return { status: "unavailable", title: result.title, message: result.reason };
  }

  const { kind, capture: source } = result;
  if (canonical(source.url) !== url) {
    const resolved = await checkUrl(api, source.url, groupId);
    if (resolved.exists) {
      return {
        status: "duplicate",
        title: source.title,
        message: alreadySaved(resolved.folder_name),
      };
    }
  }
  return captureOrDuplicate(api, { kind, folder_id: groupId, capture: source }, source.title);
}

// ----------------------------------------------------------------------------------------------
// Substack: through the desktop app when it is open (it holds the login cookie for paid posts and
// never hands it out), else fetched here without a cookie.
// ----------------------------------------------------------------------------------------------

function substackFetchFor(deps: LinkDeps, cookieSent: Map<string, boolean>): SubstackFetch {
  const raw: SubstackFetch = async (url) => {
    if (deps.desktopOpen) {
      const res = await deps.desktop.substackFetch(url, true);
      cookieSent.set(res.url, res.cookie_sent);
      return { status: res.status, url: res.url, text: res.text, retryAfter: res.retry_after };
    }
    const res = await deps.sourceFetch({ url });
    const retry = Number(res.headers["retry-after"] ?? "");
    return {
      status: res.status,
      url: res.url,
      text: res.text,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
    };
  };
  return createRateLimitedFetch(raw, { ratePerSecond: 2 });
}

async function saveSubstack(
  inputUrl: string,
  groupId: string,
  deps: LinkDeps,
): Promise<SaveOutcome> {
  const { api } = deps;
  const url = normalizeSubstackPostUrl(inputUrl);
  const before = await checkUrl(api, url, groupId);
  if (before.exists) {
    return { status: "duplicate", title: null, message: alreadySaved(before.folder_name) };
  }

  const cookieSent = new Map<string, boolean>();
  const res = await substackFetchFor(deps, cookieSent)(url);
  if (res.status === 404) throw new Error("Post not found. Check the link.");
  if (res.status === 401 || res.status === 403) {
    throw new Error("Substack refused the request. If it's a paid post, check your cookie.");
  }
  if (res.status >= 400) throw new Error(`Substack answered with an error (${res.status}).`);

  const parsed = extractSubstack(parseHtmlOnServer(res.text), res.url);
  if (parsed.status === "not_substack") throw new Error("That page isn't a Substack post.");

  if (parsed.status === "paywalled") {
    const reason = !deps.desktopOpen
      ? "Paid post. Open the Sourcefold desktop app (with your Substack cookie in Settings) and add it again."
      : cookieSent.get(res.url)
        ? "Paid post. Your Substack cookie didn't unlock it: you may not subscribe, or the cookie expired."
        : "Paid post. Add your Substack cookie in the desktop app's Settings to save paid posts you subscribe to.";
    try {
      await capture(api, {
        kind: "substack_unavailable",
        folder_id: groupId,
        url: parsed.url,
        title: parsed.title,
      });
    } catch (err) {
      if (!isDuplicateError(err)) throw err;
    }
    return { status: "paid", title: parsed.title, message: reason };
  }

  const { capture: post } = parsed;
  if (post.url !== url) {
    const resolved = await checkUrl(api, post.url, groupId);
    if (resolved.exists) {
      return {
        status: "duplicate",
        title: post.title,
        message: alreadySaved(resolved.folder_name),
      };
    }
  }
  const outcome = await captureOrDuplicate(
    api,
    { kind: "substack", folder_id: groupId, capture: post },
    post.title,
  );
  if (outcome.status === "saved" && post.access === "paid") outcome.message = "Paid post";
  return outcome;
}

// ----------------------------------------------------------------------------------------------
// Lists: a YouTube playlist or channel, or a Substack publication, becomes one link per entry.
// ----------------------------------------------------------------------------------------------

export interface ListedLink {
  url: string;
  title: string | null;
  /** Duration for a video; date and paid/free for a post. */
  detail: string | null;
}

export interface ListedCollection {
  title: string | null;
  links: ListedLink[];
  truncated: boolean;
}

export interface CollectionOptions {
  limit: number;
  publishedAfter?: string | null;
  publishedBefore?: string | null;
  signal?: AbortSignal;
}

export async function listCollection(
  url: string,
  kind: "publication" | "youtube_list",
  options: CollectionOptions,
  deps: LinkDeps,
): Promise<ListedCollection> {
  if (kind === "youtube_list") {
    const list = await listYouTubeVideos(url, {
      fetch: deps.sourceFetch,
      limit: options.limit,
      signal: options.signal,
    });
    return {
      title: list.title,
      links: list.videos.map((v) => ({ url: v.url, title: v.title, detail: v.duration })),
      truncated: list.truncated,
    };
  }

  const posts = await discoverSubstackPosts(url, substackFetchFor(deps, new Map()), {
    after: options.publishedAfter ?? null,
    before: options.publishedBefore ?? null,
    signal: options.signal,
  });
  const kept = posts.slice(0, options.limit);
  return {
    title: null,
    links: kept.map((p) => ({
      url: p.url,
      title: p.title,
      detail:
        [p.published, p.access === "paid" ? "paid" : p.access === "free" ? "free" : null]
          .filter(Boolean)
          .join(", ") || null,
    })),
    truncated: posts.length > kept.length,
  };
}
