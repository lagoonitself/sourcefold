import { canonicalizeUrl } from "@sourcefold/core";
import { assertPublicUrl, BlockedAddressError, type Lookup } from "./public-fetch";

// What add_links makes of the `links` it is given (QA 2026-11-05): every entry is accounted for.
// A link given twice, text with no link in it and a link Sourcefold can't open are reported, never
// dropped in silence, and links to this computer or the local network are refused here, before
// anything fetches them or queues them for the user's desktop app or Chrome.

export const LOCAL_ADDRESS_MESSAGE =
  "Sourcefold doesn't open links to this computer or your local network.";

export interface SkippedLink {
  /** The link, or the text that held none. */
  input: string;
  message: string;
}

export interface ReadLinks {
  urls: string[];
  skipped: SkippedLink[];
}

/** `scheme:` at the start of a token, for links Sourcefold can't open (file:, ftp:, javascript:). */
const OTHER_SCHEME = /^([a-z][a-z0-9+.-]*):(?:\/\/)?\S/i;
const NON_WEB_SCHEMES = new Set([
  "javascript",
  "data",
  "mailto",
  "file",
  "about",
  "chrome",
  "blob",
]);
const TRAILING = /[)\]}>.,;:!?'"]+$/;

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

function canonical(url: string): string {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

/** The links in `entries`, in order, once each, and what was left out and why. */
export function readLinkArgs(entries: string[]): ReadLinks {
  const urls: string[] = [];
  const skipped: SkippedLink[] = [];
  const seen = new Map<string, string>();

  for (const entry of entries) {
    let found = 0;
    for (const raw of entry.split(/\s+/)) {
      // Links glued together ("https://a.comhttps://b.com") are split like Add links does.
      const parts = raw.split(/(?=https?:\/\/)/i).filter(Boolean);
      for (const part of parts) {
        const token = part.replace(TRAILING, "");
        if (!token) continue;
        if (/^https?:\/\//i.test(token)) {
          found++;
          let parsed: URL;
          try {
            parsed = new URL(token);
          } catch {
            skipped.push({ input: shorten(token), message: "Not a valid link." });
            continue;
          }
          if (!parsed.hostname) {
            skipped.push({ input: shorten(token), message: "Not a valid link." });
            continue;
          }
          const key = canonical(token);
          const first = seen.get(key);
          if (first !== undefined) {
            skipped.push({
              input: shorten(token),
              message:
                first === token
                  ? "Given twice in this call; saved once."
                  : `The same link as ${shorten(first)}, given earlier in this call; saved once.`,
            });
            continue;
          }
          seen.set(key, token);
          urls.push(token);
          continue;
        }
        const scheme = OTHER_SCHEME.exec(token)?.[1]?.toLowerCase();
        if (scheme && (token.includes("://") || NON_WEB_SCHEMES.has(scheme))) {
          found++;
          skipped.push({
            input: shorten(token),
            message: `Sourcefold only saves http and https links, not ${scheme}: links.`,
          });
        }
      }
    }
    if (found === 0 && entry.trim()) {
      skipped.push({
        input: shorten(entry),
        message: "Not a link. Pass full addresses starting with https://.",
      });
    }
  }
  return { urls, skipped };
}

/**
 * Splits off links to this computer or the local network: by name or address, and by what the
 * name resolves to. A name that can't be looked up stays (saving it fails on its own).
 */
export async function refuseLocalAddresses(
  urls: string[],
  resolve?: Lookup,
  timeoutMs = 3_000,
): Promise<ReadLinks> {
  const kept: string[] = [];
  const skipped: SkippedLink[] = [];
  await Promise.all(
    urls.map(async (url, index) => {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const slow = new Promise<void>((done) => {
          timer = setTimeout(done, timeoutMs);
        });
        await Promise.race([assertPublicUrl(new URL(url), resolve), slow]).finally(() =>
          clearTimeout(timer),
        );
        kept[index] = url;
      } catch (err) {
        if (err instanceof BlockedAddressError) {
          skipped[index] = { input: shorten(url), message: LOCAL_ADDRESS_MESSAGE };
        } else {
          kept[index] = url;
        }
      }
    }),
  );
  return { urls: kept.filter(Boolean), skipped: skipped.filter(Boolean) };
}

/** One line per skipped link, for a tool's reply. */
export function skippedLines(skipped: SkippedLink[]): string[] {
  return skipped.map((s) => `- not saved: ${s.input} (${s.message})`);
}
