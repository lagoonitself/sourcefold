import {
  createRateLimitedFetch,
  discoverSubstackPosts,
  normalizeSubstackPostUrl,
  type DiscoverOptions,
  type DiscoveredPost,
  type SubstackFetch,
} from "@sourcefold/core";
import { extractSubstack } from "@sourcefold/core/capture";
import { capture, checkUrl, isTauri } from "@/lib/api";
import type { Item } from "@/lib/types";

// Substack posts are always fetched by this computer (with the user's cookie for paid posts) and
// then saved through the normal capture path: to the web account when signed in, to disk offline.

export interface SubstackCookieStatus {
  configured: boolean;
  name: string | null;
  saved_at: string | null;
}

export type SubstackCookieName = "substack.sid" | "connect.sid";

interface FetchResult {
  status: number;
  url: string;
  text: string;
  retry_after: number | null;
  cookie_sent: boolean;
}

export type SaveSubstackOutcome =
  | { kind: "saved"; title: string; item: Item; paid: boolean }
  | { kind: "paid_locked"; title: string; reason: string }
  | { kind: "duplicate"; title: string | null; message: string };

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("Saving Substack posts needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function fetchPage(url: string, withCookie: boolean): Promise<FetchResult> {
  return tauriInvoke<FetchResult>("substack_fetch", { url, withCookie });
}

// Whether the cookie went with the last request for each final URL (custom domains get it only
// once they're known to be Substack).
const cookieSentFor = new Map<string, boolean>();

const rawFetch: SubstackFetch = async (url) => {
  const res = await fetchPage(url, true);
  cookieSentFor.set(res.url, res.cookie_sent);
  return { status: res.status, url: res.url, text: res.text, retryAfter: res.retry_after };
};

// One limiter for the whole app, so a publication import and a pasted list share the pace.
const limitedFetch = createRateLimitedFetch(rawFetch, { ratePerSecond: 2 });

export function getSubstackCookie(): Promise<SubstackCookieStatus> {
  return tauriInvoke<SubstackCookieStatus>("get_substack_cookie");
}

export function setSubstackCookie(
  name: SubstackCookieName,
  value: string,
): Promise<SubstackCookieStatus> {
  return tauriInvoke<SubstackCookieStatus>("set_substack_cookie", { name, value });
}

export function clearSubstackCookie(): Promise<SubstackCookieStatus> {
  return tauriInvoke<SubstackCookieStatus>("clear_substack_cookie");
}

export function findPublicationPosts(
  url: string,
  options: DiscoverOptions = {},
): Promise<DiscoveredPost[]> {
  return discoverSubstackPosts(url, limitedFetch, options);
}

function isDuplicateError(err: unknown): err is Error {
  return err instanceof Error && /already saved/i.test(err.message);
}

async function fetchPost(url: string) {
  let res = await limitedFetch(url);
  let parsed = parse(res.text, res.url);
  // The first fetch is what marks a custom domain as Substack; fetch again if the cookie could
  // have unlocked the post.
  if (parsed.status === "paywalled" && !cookieSentFor.get(res.url)) {
    const cookie = await getSubstackCookie();
    if (cookie.configured) {
      res = await limitedFetch(res.url);
      parsed = parse(res.text, res.url);
    }
  }
  return { res, parsed, cookieSent: cookieSentFor.get(res.url) ?? false };
}

function parse(html: string, url: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return extractSubstack(doc, url);
}

export async function saveSubstackPost(
  inputUrl: string,
  folderId: string,
): Promise<SaveSubstackOutcome> {
  const url = normalizeSubstackPostUrl(inputUrl);

  const before = await checkUrl(url, folderId);
  if (before.exists) {
    return {
      kind: "duplicate",
      title: null,
      message: `Already saved in ${before.folder_name || "this group"}`,
    };
  }

  const { res, parsed, cookieSent } = await fetchPost(url);
  if (res.status === 404) throw new Error("Post not found. Check the link.");
  if (res.status === 401 || res.status === 403) {
    throw new Error("Substack refused the request. If it's a paid post, check your cookie.");
  }
  if (res.status >= 400) throw new Error(`Substack answered with an error (${res.status}).`);
  if (parsed.status === "not_substack") throw new Error("That page isn't a Substack post.");

  if (parsed.status === "paywalled") {
    const reason = cookieSent
      ? "Paid post. Your Substack cookie didn't unlock it: you may not subscribe, or the cookie expired."
      : "Paid post. Add your Substack cookie in Settings to save paid posts you subscribe to.";
    try {
      await capture({
        kind: "substack_unavailable",
        folder_id: folderId,
        url: parsed.url,
        title: parsed.title,
      });
    } catch (err) {
      if (!isDuplicateError(err)) throw err;
    }
    return { kind: "paid_locked", title: parsed.title, reason };
  }

  const { capture: post } = parsed;
  if (post.url !== url) {
    const canonical = await checkUrl(post.url, folderId);
    if (canonical.exists) {
      return {
        kind: "duplicate",
        title: post.title,
        message: `Already saved in ${canonical.folder_name || "this group"}`,
      };
    }
  }

  try {
    const item = await capture({ kind: "substack", folder_id: folderId, capture: post });
    return { kind: "saved", title: post.title, item, paid: post.access === "paid" };
  } catch (err) {
    if (isDuplicateError(err))
      return { kind: "duplicate", title: post.title, message: err.message };
    throw err;
  }
}
