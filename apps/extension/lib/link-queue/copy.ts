import { hostLabel } from "../page-kind";

/** Same sentence the popup shows for a page it can't save. */
export const CANNOT_SAVE_MESSAGE =
  "This page can't be saved. Open a web page, YouTube video, Reddit, Hacker News or Bluesky post, Substack post, Grokipedia article or X post.";

export const PAID_POST_MESSAGE = "Paid post, not saved";
export const ALREADY_SAVED_MESSAGE = "Already saved";
export const TIMEOUT_MESSAGE = "This page took too long to open.";
export const TAB_CLOSED_MESSAGE = "The tab closed before the page could be saved.";
export const SAVE_FAILED_MESSAGE = "Couldn't save this page.";

/** `https://x.com/user/status/1` → `https://x.com/*`, the optional host permission to request. */
export function originPattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  const labeled = hostLabel(url);
  if (labeled) return labeled;
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function allowMessage(host: string): string {
  return `Allow Sourcefold to open ${host} in Chrome`;
}

export function signInMessage(host: string): string {
  return `Sign in to ${host} in Chrome, then press Retry`;
}

/** Login wall: the tab left the post, or the page itself asks the reader to sign in. */
export function looksLikeSignInPage(url: string, title = ""): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (
      path === "/login" ||
      path.startsWith("/login/") ||
      path.includes("/i/flow/login") ||
      path.includes("/i/flow/signup")
    ) {
      return true;
    }
  } catch {
    // Not a URL. The title check below still applies.
  }
  return /sign in to (?:x|twitter)|log in to (?:x|twitter)/i.test(`${title}\n${url}`);
}

export function permissionBannerText(count: number, hosts: string[]): string {
  const noun = count === 1 ? "link needs" : "links need";
  const where = hosts.length > 0 ? hosts.join(", ") : "these sites";
  return `${count} ${noun} your OK to open ${where}`;
}

export function progressText(progress: {
  index: number;
  total: number;
  addedBy: string | null;
}): string {
  const total = Math.max(progress.total, progress.index, 1);
  const noun = total === 1 ? "link" : "links";
  const who =
    progress.addedBy && progress.addedBy.toLowerCase() !== "mcp" ? ` ${progress.addedBy}` : "";
  return `Saving ${progress.index} of ${total} ${noun}${who} added…`;
}

export function failedBannerText(count: number, message: string | null): string {
  if (count === 1 && message) return message;
  return count === 1 ? "1 link couldn't be saved." : `${count} links couldn't be saved.`;
}

export function clip(value: string, max = 1000): string {
  return value.length <= max ? value : value.slice(0, max);
}
