import type { Highlight } from "@sourcefold/core";
import {
  SOURCE_SPAN_ATTR,
  locateHighlight,
  targetsForSelection,
  type RemoveTarget,
  type RenderedBlock,
} from "@sourcefold/core/reader";
import { trimRange } from "./anchoring";
import { rangeToOffsets } from "./dom-anchoring";

/**
 * Removing text from a saved source (the reader's "Remove text" mode and "Edit as text").
 * The pure parts live here; the hook in `use-reader-cleanup.ts` does the saving.
 */

/**
 * Sources whose text can be edited: the page as it was saved. Notes have their own editor, images
 * have no text, and an X thread is built from its posts.
 */
const EDITABLE_TEXT_KINDS: ReadonlySet<string> = new Set([
  "grokipedia",
  "wikipedia",
  "substack",
  "youtube",
  "web",
  "reddit",
  "pdf",
  "hackernews",
  "bluesky",
]);

export function canEditText(kind: string): boolean {
  return EDITABLE_TEXT_KINDS.has(kind);
}

/** The removable blocks on the page, with where each one's text starts. */
export function renderedBlocks(root: HTMLElement): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let position = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      position += (node as Text).data.length;
      continue;
    }
    const el = node as HTMLElement;
    const span = el.getAttribute(SOURCE_SPAN_ATTR);
    if (!span) continue;
    const [start, end] = span.split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    blocks.push({ start: start!, end: end!, textStart: position, text: el.textContent ?? "" });
  }
  return blocks;
}

/** What a selection in the body would remove. Empty when it holds no removable text. */
export function targetsForRange(root: HTMLElement, range: Range): RemoveTarget[] {
  const offsets = rangeToOffsets(root, range);
  if (!offsets) return [];
  const trimmed = trimRange(root.textContent ?? "", offsets.start, offsets.end);
  if (!trimmed) return [];
  return targetsForSelection(renderedBlocks(root), trimmed.start, trimmed.end);
}

/** The whole block the pointer is over. */
export function targetForBlock(el: HTMLElement): RemoveTarget | null {
  const [start, end] = (el.getAttribute(SOURCE_SPAN_ATTR) ?? "").split("-").map(Number);
  return Number.isInteger(start) && Number.isInteger(end) ? { start: start!, end: end! } : null;
}

/** What a rendered body shows: its text and the addresses of its images. */
export interface BodyView {
  text: string;
  images: ReadonlySet<string>;
}

export function describeHtml(html: string): BodyView {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const images = new Set(
    Array.from(holder.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter((src): src is string => Boolean(src)),
  );
  return { text: holder.textContent ?? "", images };
}

/**
 * The highlights that sat in the text and no longer have anything to sit on after an edit. A
 * highlight that was already unplaced before the edit is not counted: it is not new damage.
 */
export function lostHighlights(
  highlights: Highlight[],
  before: BodyView,
  after: BodyView,
): Highlight[] {
  return highlights.filter((h) => {
    if (h.kind === "image") {
      return (
        Boolean(h.image_src) && before.images.has(h.image_src!) && !after.images.has(h.image_src!)
      );
    }
    return locateHighlight(before.text, h) !== null && locateHighlight(after.text, h) === null;
  });
}

export function removalMessage(count: number, lostCount: number): string {
  const what =
    count === 1 ? "Removed it from this source." : `Removed ${count} parts of this source.`;
  if (lostCount === 0) return what;
  return `${what} ${lostCount === 1 ? "1 highlight" : `${lostCount} highlights`} in that text went with it.`;
}
