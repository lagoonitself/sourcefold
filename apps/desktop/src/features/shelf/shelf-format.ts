import {
  parseShelfUrls,
  shelfHost,
  shelfMatches,
  type ShelfAddResult,
  type ShelfLink,
} from "@sourcefold/core";

const DAY_MS = 86_400_000;

export function linksLabel(count: number): string {
  return count === 1 ? "1 link" : `${count} links`;
}

/** "Never opened", "Opened today", "Opened yesterday", "Opened 3 days ago", then the date. */
export function formatShelfOpened(lastOpenedAt: string | null, now: Date = new Date()): string {
  if (!lastOpenedAt) return "Never opened";
  const opened = new Date(lastOpenedAt);
  if (Number.isNaN(opened.getTime())) return "Never opened";
  const days = Math.floor((startOfDay(now) - startOfDay(opened)) / DAY_MS);
  if (days <= 0) return "Opened today";
  if (days === 1) return "Opened yesterday";
  if (days < 7) return `Opened ${days} days ago`;
  const sameYear = opened.getFullYear() === now.getFullYear();
  const date = opened.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `Opened ${date}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The first line of a note, for the row's muted line. Empty when there is no note. */
export function shelfNoteLine(note: string): string {
  return (
    note
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ""
  );
}

/** The letter on a link's site tile: the first letter of its host. */
export function shelfTileLetter(url: string): string {
  return shelfHost(url).charAt(0).toUpperCase() || "?";
}

/** Filter text plus tag chips: a link must match the text and carry every chosen tag. */
export function filterShelf(links: ShelfLink[], query: string, tags: string[]): ShelfLink[] {
  const wanted = tags.map((tag) => tag.toLowerCase());
  return links.filter(
    (link) =>
      shelfMatches(link, query) &&
      wanted.every((tag) => link.tags.some((own) => own.toLowerCase() === tag)),
  );
}

export interface ShelfAddPlan {
  urls: string[];
  /** Why the text can't be added, for the dialog to show. Null when `urls` is usable. */
  error: string | null;
}

/** Reads the URL field: one or more links, anything that doesn't read as a link is dropped. */
export function planShelfAdd(text: string): ShelfAddPlan {
  if (!text.trim()) {
    return { urls: [], error: null };
  }
  const urls = parseShelfUrls(text);
  if (urls.length === 0) {
    return {
      urls,
      error: "That doesn't look like a web address. Paste a link such as https://example.com.",
    };
  }
  return { urls, error: null };
}

/** The result toast for adding links: "Added to shelf", "Added 4 links, 1 was already on your shelf". */
export function shelfAddMessage(result: ShelfAddResult): string {
  const added = result.added.length;
  const existing = result.existing.length;
  if (added === 0) {
    if (existing === 0) return "Nothing to add";
    return existing === 1
      ? "That link is already on your shelf"
      : `All ${existing} links are already on your shelf`;
  }
  const addedPart = added === 1 && existing === 0 ? "Added to shelf" : `Added ${linksLabel(added)}`;
  if (existing === 0) return addedPart;
  return `${addedPart}, ${existing} ${existing === 1 ? "was" : "were"} already on your shelf`;
}

/** The result toast for an import, with the skipped count the user asked for. */
export function shelfImportMessage(added: number, skipped: number): string {
  if (added === 0) {
    return skipped === 0
      ? "No links to import"
      : `Nothing imported, all ${linksLabel(skipped)} were already on your shelf`;
  }
  if (skipped === 0) return `Imported ${linksLabel(added)} to your shelf`;
  return `Imported ${linksLabel(added)}, skipped ${skipped} already on your shelf`;
}

/** Splits a list into consecutive chunks of at most `size`. */
export function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
