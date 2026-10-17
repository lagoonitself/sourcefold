import { MARK_ATTR } from "./dom-anchoring";

/** The reader's keyboard focus unit: paragraphs, list items, blockquotes, images, table rows. */

export const FOCUS_CLASS = "reader-block-focus";

const CANDIDATES = "p, li, blockquote, img, tr, pre";

function isLeafBlock(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "IMG" || tag === "PRE") return true;
  if (tag === "P") {
    // A paragraph that only holds an image is the image's wrapper.
    return !(el.querySelector("img") && !(el.textContent ?? "").trim());
  }
  if (tag === "LI") return !el.querySelector(":scope > p, :scope > blockquote");
  if (tag === "BLOCKQUOTE") return !el.querySelector(":scope > p, :scope > ul, :scope > ol");
  if (tag === "TR") return true;
  return false;
}

export function listBlocks(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(isLeafBlock);
}

/** The text of a block, without the lists nested under a list item. */
export function blockRange(block: HTMLElement): Range {
  const range = document.createRange();
  range.selectNodeContents(block);
  if (block.tagName === "LI") {
    const nested = block.querySelector(":scope > ul, :scope > ol");
    if (nested) range.setEndBefore(nested);
  }
  return range;
}

/** First block whose bottom edge is below the top of the scroll area (what the reader sees). */
export function firstVisibleBlock(blocks: HTMLElement[], containerTop: number): HTMLElement | null {
  for (const block of blocks) {
    if (block.getBoundingClientRect().bottom > containerTop + 4) return block;
  }
  return blocks[blocks.length - 1] ?? null;
}

export function highlightIdInBlock(block: HTMLElement): string | null {
  if (block.hasAttribute(MARK_ATTR)) return block.getAttribute(MARK_ATTR);
  const inside = block.querySelector("[" + MARK_ATTR + "]");
  if (inside) return inside.getAttribute(MARK_ATTR);
  return block.closest("[" + MARK_ATTR + "]")?.getAttribute(MARK_ATTR) ?? null;
}

export function setFocusedBlock(root: HTMLElement, block: HTMLElement | null): void {
  for (const old of Array.from(root.querySelectorAll("." + FOCUS_CLASS))) {
    old.classList.remove(FOCUS_CLASS);
  }
  block?.classList.add(FOCUS_CLASS);
}
