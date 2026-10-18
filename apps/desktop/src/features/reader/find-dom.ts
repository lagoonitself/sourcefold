import { segmentsForRange } from "./anchoring";
import { textNodesOf } from "./dom-anchoring";
import type { TextRange } from "./find-text";

/**
 * The DOM side of find in this source. Find marks are `<mark data-find>` elements that wrap pieces
 * of text nodes, exactly as highlight marks do, so `textContent` and every text offset stay the
 * same. They are separate from highlight marks (another attribute and class), are never saved, and
 * `clearMarks` in dom-anchoring.ts leaves them alone.
 */

export const FIND_ATTR = "data-find";
export const FIND_CLASS = "reader-find";
export const FIND_CURRENT_CLASS = "is-find-current";

/** Parents whose whitespace-only text nodes sit between blocks; a mark there would be invalid. */
const STRUCTURAL_PARENTS = new Set([
  "UL",
  "OL",
  "TABLE",
  "THEAD",
  "TBODY",
  "TFOOT",
  "TR",
  "BLOCKQUOTE",
  "DIV",
]);

/** Wraps each range in `<mark data-find>` pieces. Returns the marks of every range, in order. */
export function applyFindMarks(root: Node, ranges: TextRange[]): HTMLElement[][] {
  const nodes = textNodesOf(root);
  const lengths = nodes.map((n) => n.data.length);
  const result: HTMLElement[][] = ranges.map(() => []);
  // Last range first: splitting a text node keeps its start where it was, so the lengths measured
  // up front stay right for every range that lies before.
  for (let r = ranges.length - 1; r >= 0; r--) {
    const { start, end } = ranges[r];
    const marks: HTMLElement[] = [];
    for (const { index, from, to } of segmentsForRange(lengths, start, end)) {
      const node = nodes[index];
      const parentTag = node.parentElement?.tagName ?? "";
      if (STRUCTURAL_PARENTS.has(parentTag) && !node.data.slice(from, to).trim()) continue;
      let target = node;
      if (from > 0) target = node.splitText(from);
      if (to - from < target.data.length) target.splitText(to - from);
      const mark = document.createElement("mark");
      mark.className = FIND_CLASS;
      mark.setAttribute(FIND_ATTR, "");
      target.replaceWith(mark);
      mark.append(target);
      marks.push(mark);
    }
    result[r] = marks;
  }
  return result;
}

/** Takes every find mark off the page and joins the split text nodes again. */
export function clearFindMarks(root: Element): void {
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll("mark[" + FIND_ATTR + "]"))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parents.add(parent);
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  for (const parent of parents) parent.normalize();
}

const FLASH_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, pre, td, th, blockquote:not(:has(p))";
const FLASH_LIMIT = 12;

/** The paragraphs, list items and headings the range touches, for the landing flash. */
export function blocksInRange(root: Element, range: TextRange): HTMLElement[] {
  const nodes = textNodesOf(root);
  const lengths = nodes.map((n) => n.data.length);
  const segments = segmentsForRange(lengths, range.start, range.end);
  const blocks: HTMLElement[] = [];
  for (const { index } of segments) {
    const block = nodes[index].parentElement?.closest<HTMLElement>(FLASH_BLOCKS) ?? null;
    if (block && root.contains(block) && !blocks.includes(block)) blocks.push(block);
    if (blocks.length >= FLASH_LIMIT) break;
  }
  return blocks;
}

/** A DOM range over [start, end) of `root`'s text, for measuring where it sits on screen. */
export function domRangeFor(root: Node, range: TextRange): Range | null {
  const nodes = textNodesOf(root);
  const lengths = nodes.map((n) => n.data.length);
  const segments = segmentsForRange(lengths, range.start, range.end);
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  const dom = document.createRange();
  dom.setStart(nodes[first.index], first.from);
  dom.setEnd(nodes[last.index], last.to);
  return dom;
}
