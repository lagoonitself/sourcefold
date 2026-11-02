import {
  SourceError,
  canonicalizeUrl,
  canonicalWikipediaUrl,
  classifySubstackLink,
  createRateLimitedFetch,
  detectLinkKind,
  detectSource,
  discoverSubstackPosts,
  looksLikeSubstackPublication,
  isWikipediaArticleUrl,
  normalizeSubstackPostUrl,
  parseYouTubeLink,
  type CaptureRequest,
  type SourceFetch,
  type SubstackFetch,
} from "@sourcefold/core";
import {
  WikipediaError,
  WIKIPEDIA_ERROR_MESSAGES,
  WIKIPEDIA_USER_AGENT,
  extractSubstack,
  fetchSourceCapture,
  fetchWikipediaCapture,
  listYouTubeVideos,
  type LoadPdfJs,
} from "@sourcefold/core/capture";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import type { DesktopBridge } from "../desktop-bridge";
import type { Item } from "../types";
import { ApiError, type WebApi } from "../web-api";

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
  addedBy?: string;
  sourceFetch: SourceFetch;
  /** Guarded `fetch` for libraries that take a WHATWG fetch (Wikipedia). */
  publicFetch: typeof fetch;
  /** Whether the desktop app answered when the job started (paid Substack posts need it). */
  desktopOpen: boolean;
  /** Remote add-links queues paid posts instead of creating a placeholder item. */
  deferUnavailable?: boolean;
}

export interface CheckUrlResult {
  exists: boolean;
  folder_name?: string | null;
  elsewhere?: { item_id: string; folder_id: string; folder_path?: string } | null;
}

// Claude Desktop runs this server in its own Electron runtime, where pdf.js doesn't detect Node,
// never picks its worker file and failed every PDF with 'No "GlobalWorkerOptions.workerSrc"
// specified.' Handing it the worker module makes it parse in this process on any runtime.
const loadPdfJs: LoadPdfJs = async () => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs as Awaited<ReturnType<LoadPdfJs>>;
};

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
  if (err instanceof ApiError && err.status === 409) return true;
  return err instanceof Error && /already saved/i.test(err.message);
}

export function checkDuplicate(
  check: CheckUrlResult,
  allowDuplicates = false,
): { isDuplicate: boolean; message: string } {
  if (check.exists) {
    return { isDuplicate: true, message: alreadySaved(check.folder_name) };
  }
  if (!allowDuplicates && check.elsewhere) {
    return { isDuplicate: true, message: alreadySaved(check.elsewhere.folder_path) };
  }
  return { isDuplicate: false, message: "" };
}

async function checkUrl(
  api: WebApi,
  url: string,
  groupId: string,
  timeoutMs?: number,
): Promise<CheckUrlResult> {
  return api.post<CheckUrlResult>("/items/check", { url, folder_id: groupId }, { timeoutMs });
}

async function capture(api: WebApi, request: CaptureRequest, timeoutMs?: number): Promise<Item> {
  const res = await api.post<{ item?: Item } | Item>("/capture", request, { timeoutMs });
  return (res as { item?: Item }).item ?? (res as Item);
}

/** Saves through `/api/capture`; an "already saved" refusal becomes a duplicate. */
async function captureOrDuplicate(
  api: WebApi,
  request: CaptureRequest,
  title: string,
  timeoutMs?: number,
): Promise<SaveOutcome> {
  try {
    const item = await capture(api, request, timeoutMs);
    return { status: "saved", title: item.title || title, itemId: item.id };
  } catch (err) {
    if (isDuplicateError(err)) return { status: "duplicate", title, message: err.message };
    throw err;
  }
}

/** Whether the user's own computer or browser should retry a cloud fetch. */
const REFUSAL_STATUSES = new Set([401, 403, 407, 429, 451, 503]);

export function isCloudRefusal(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || REFUSAL_STATUSES.has(err.status);
  if (err instanceof SourceError) {
    if (err.code === "blocked") return true;
    if (err.code !== "fetch_failed") return false;
    // "The site answered HTTP 400 instead of the page" is the page's own answer: another computer
    // would get it too. No status means the request never got an answer (network, reset).
    const status = /\bHTTP (\d{3})\b/.exec(err.message)?.[1];
    if (!status) return true;
    const code = Number(status);
    return code >= 500 || REFUSAL_STATUSES.has(code);
  }
  // Wikipedia turns timeouts, network errors, 429 and 5xx into "fetch_failed".
  if (err instanceof WikipediaError) return err.code === "fetch_failed";
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  return /captcha|bot check|refused (?:the )?(?:request|connection)|blocked this request|too many requests|timed? ?out|timeout|network|connection (?:reset|closed|refused)|socket|fetch failed|\b(?:401|403|407|429|451|503)\b/i.test(
    err.message,
  );
}

export async function saveLink(
  url: string,
  kind: LinkKind,
  groupId: string,
  deps: LinkDeps,
  signal?: AbortSignal,
  allowDuplicates = false,
  requestTimeoutMs?: number,
): Promise<SaveOutcome> {
  switch (kind) {
    case "grokipedia":
      return saveGrokipedia(url, groupId, deps, allowDuplicates, requestTimeoutMs);
    case "wikipedia":
      return saveWikipedia(url, groupId, deps, signal, allowDuplicates, requestTimeoutMs);
    case "substack":
      return saveSubstack(url, groupId, deps, allowDuplicates, signal, requestTimeoutMs);
    case "source":
      return saveSource(url, groupId, deps, signal, allowDuplicates, requestTimeoutMs);
    case "x":
      throw new Error(
        "X posts are saved with the Sourcefold extension: open the post in Chrome and click Save.",
      );
    case "publication":
    case "youtube_list":
      throw new Error("Lists are expanded into their posts or videos before saving.");
  }
}

async function saveGrokipedia(
  url: string,
  groupId: string,
  { api }: LinkDeps,
  allowDuplicates = false,
  timeoutMs?: number,
) {
  const check = await checkUrl(api, url, groupId, timeoutMs);
  const dup = checkDuplicate(check, allowDuplicates);
  if (dup.isDuplicate) {
    return { status: "duplicate", title: null, message: dup.message } as const;
  }
  try {
    const res = await api.post<{ item?: Item } | Item>(
      "/grokipedia",
      {
        url,
        folder_id: groupId,
        ...(allowDuplicates ? { allow_duplicate: true } : {}),
      },
      { timeoutMs },
    );
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
  allowDuplicates = false,
  timeoutMs?: number,
): Promise<SaveOutcome> {
  const url = canonicalWikipediaUrl(inputUrl);
  if (!url) throw new Error(WIKIPEDIA_ERROR_MESSAGES.invalid_url);
  const before = await checkUrl(api, url, groupId, timeoutMs);
  const dup = checkDuplicate(before, allowDuplicates);
  if (dup.isDuplicate) {
    return { status: "duplicate", title: null, message: dup.message };
  }
  const article = await fetchWikipediaCapture(url, {
    parseHtml: parseHtmlOnServer,
    fetch: publicFetch,
    headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
    signal,
  });
  if (article.url !== url) {
    const resolved = await checkUrl(api, article.url, groupId, timeoutMs);
    const resolvedDup = checkDuplicate(resolved, allowDuplicates);
    if (resolvedDup.isDuplicate) {
      return {
        status: "duplicate",
        title: article.title,
        message: resolvedDup.message,
      };
    }
  }
  const request = {
    kind: "wikipedia",
    folder_id: groupId,
    capture: article,
    ...(allowDuplicates ? { allow_duplicate: true } : {}),
  } as unknown as CaptureRequest;
  return captureOrDuplicate(api, request, article.title, timeoutMs);
}

async function saveSource(
  inputUrl: string,
  groupId: string,
  { api, sourceFetch }: LinkDeps,
  signal?: AbortSignal,
  allowDuplicates = false,
  timeoutMs?: number,
): Promise<SaveOutcome> {
  const url = canonical(inputUrl);
  const before = await checkUrl(api, url, groupId, timeoutMs);
  const dup = checkDuplicate(before, allowDuplicates);
  if (dup.isDuplicate) {
    return { status: "duplicate", title: null, message: dup.message };
  }

  // Throws a SourceError whose message says what to do.
  const result = await fetchSourceCapture(inputUrl, {
    fetch: sourceFetch,
    parseHtml: parseHtmlOnServer,
    loadPdfJs,
    signal,
  });

  if (result.status === "unavailable") {
    try {
      await capture(
        api,
        {
          kind: "source_unavailable",
          folder_id: groupId,
          source: result.kind,
          url: result.url,
          title: result.title,
          reason: result.reason,
        },
        timeoutMs,
      );
    } catch (err) {
      if (!isDuplicateError(err)) throw err;
    }
    return { status: "unavailable", title: result.title, message: result.reason };
  }

  const { kind, capture: source } = result;
  if (canonical(source.url) !== url) {
    const resolved = await checkUrl(api, source.url, groupId, timeoutMs);
    const resolvedDup = checkDuplicate(resolved, allowDuplicates);
    if (resolvedDup.isDuplicate) {
      return {
        status: "duplicate",
        title: source.title,
        message: resolvedDup.message,
      };
    }
  }
  const request = {
    kind,
    folder_id: groupId,
    capture: source,
    ...(allowDuplicates ? { allow_duplicate: true } : {}),
  } as unknown as CaptureRequest;
  return captureOrDuplicate(api, request, source.title, timeoutMs);
}

// ----------------------------------------------------------------------------------------------
// Substack: through the desktop app when it is open (it holds the login cookie for paid posts and
// never hands it out), else fetched here without a cookie.
// ----------------------------------------------------------------------------------------------

function substackFetchFor(
  deps: LinkDeps,
  cookieSent: Map<string, boolean>,
  signal?: AbortSignal,
): SubstackFetch {
  const raw: SubstackFetch = async (url) => {
    if (deps.desktopOpen) {
      const res = await deps.desktop.substackFetch(url, true);
      cookieSent.set(res.url, res.cookie_sent);
      return { status: res.status, url: res.url, text: res.text, retryAfter: res.retry_after };
    }
    const res = await deps.sourceFetch({ url, signal });
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
  allowDuplicates = false,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<SaveOutcome> {
  const { api } = deps;
  const url = normalizeSubstackPostUrl(inputUrl);
  const before = await checkUrl(api, url, groupId, timeoutMs);
  const dup = checkDuplicate(before, allowDuplicates);
  if (dup.isDuplicate) {
    return { status: "duplicate", title: null, message: dup.message };
  }

  const cookieSent = new Map<string, boolean>();
  const res = await substackFetchFor(deps, cookieSent, signal)(url);
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
    if (!deps.deferUnavailable) {
      try {
        await capture(
          api,
          {
            kind: "substack_unavailable",
            folder_id: groupId,
            url: parsed.url,
            title: parsed.title,
          },
          timeoutMs,
        );
      } catch (err) {
        if (!isDuplicateError(err)) throw err;
      }
    }
    return { status: "paid", title: parsed.title, message: reason };
  }

  const { capture: post } = parsed;
  if (post.url !== url) {
    const resolved = await checkUrl(api, post.url, groupId, timeoutMs);
    const resolvedDup = checkDuplicate(resolved, allowDuplicates);
    if (resolvedDup.isDuplicate) {
      return {
        status: "duplicate",
        title: post.title,
        message: resolvedDup.message,
      };
    }
  }
  const request = {
    kind: "substack",
    folder_id: groupId,
    capture: post,
    ...(allowDuplicates ? { allow_duplicate: true } : {}),
  } as unknown as CaptureRequest;
  const outcome = await captureOrDuplicate(api, request, post.title, timeoutMs);
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

/** A playlist, channel, or Substack publication, including one on its own domain. */
export async function collectionKind(
  url: string,
  deps: LinkDeps,
): Promise<"publication" | "youtube_list" | null> {
  const kind = classifyLink(url);
  if (kind === "youtube_list" || kind === "publication") return kind;
  if (kind === "substack" || kind === "grokipedia" || kind === "wikipedia" || kind === "x") {
    return null;
  }
  let path = "/";
  try {
    path = new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (path !== "" && path !== "/archive") return null;
  const yes = await looksLikeSubstackPublication(url, substackFetchFor(deps, new Map()));
  return yes ? "publication" : null;
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

  const posts = await discoverSubstackPosts(
    url,
    substackFetchFor(deps, new Map(), options.signal),
    {
      after: options.publishedAfter ?? null,
      before: options.publishedBefore ?? null,
      signal: options.signal,
    },
  );
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
