import type { BatchSummary } from "./types";

/** Shown on the row the extension will claim. */
export const BROWSER_MESSAGE = "Needs Chrome with the Sourcefold extension";

/** Written when YouTube is still limiting after the paced retries, and the row goes back to waiting. */
export const YOUTUBE_RELEASE_MESSAGE =
  "YouTube is still limiting requests. Sourcefold will try again in a few minutes.";

const TEXT_MAX = 1000;

export function clipText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > TEXT_MAX ? trimmed.slice(0, TEXT_MAX) : trimmed;
}

export function formatSavingStatus(index: number, total: number, addedBy: string | null): string {
  const who = addedBy ? ` from ${addedBy}` : "";
  return `Saving links${who}: ${index} of ${total}`;
}

export function formatSavingDetail(
  index: number,
  total: number,
  addedBy: string | null,
  pause: string | null,
): string {
  const base = formatSavingStatus(index, total, addedBy);
  if (!pause) return base;
  return `${base}. YouTube is limiting requests. Trying again in ${pause}.`;
}

function linkWord(count: number): string {
  return count === 1 ? "link" : "links";
}

/** Toast after a drain finishes. Null when nothing was reported. */
export function formatBatchToast(summary: BatchSummary): string | null {
  const sentences: string[] = [];
  if (summary.saved > 0) {
    const noun = linkWord(summary.saved);
    sentences.push(
      summary.addedBy
        ? `Saved ${summary.saved} ${noun} ${summary.addedBy} added.`
        : `Saved ${summary.saved} ${noun}.`,
    );
  } else if (summary.duplicate > 0 && summary.failed === 0 && summary.unavailable === 0) {
    sentences.push(
      summary.duplicate === 1
        ? "1 link was already saved."
        : `${summary.duplicate} links were already saved.`,
    );
  }
  if (summary.unavailable > 0 && summary.saved === 0) {
    sentences.push(
      summary.unavailable === 1
        ? "1 link had nothing to save."
        : `${summary.unavailable} links had nothing to save.`,
    );
  }
  if (summary.browser > 0) {
    sentences.push(summary.browser === 1 ? "1 needs Chrome." : `${summary.browser} need Chrome.`);
  }
  if (summary.failed > 0) {
    sentences.push(summary.failed === 1 ? "1 failed." : `${summary.failed} failed.`);
  }
  if (summary.youtubeLimited) sentences.push(YOUTUBE_RELEASE_MESSAGE);
  if (sentences.length === 0) return null;
  return sentences.join(" ");
}

export function formatChromeWaiting(count: number): string {
  return count === 1 ? "1 needs Chrome" : `${count} need Chrome`;
}

export function formatChromeHint(count: number): string {
  if (count === 1) {
    return "1 link needs Chrome. Open Chrome with the Sourcefold extension to save it.";
  }
  return `${count} links need Chrome. Open Chrome with the Sourcefold extension to save them.`;
}

export function collectionMessage(
  inLibrary: number,
  total: number,
  kind: "video" | "post",
  truncated: boolean,
): string {
  const word = total === 1 ? kind : kind === "video" ? "videos" : "posts";
  const line =
    inLibrary === total ? `Saved ${total} ${word}` : `Saved ${inLibrary} of ${total} ${word}`;
  if (!truncated) return line;
  return `${line}. Only the first ${total} ${word} are added.`;
}
