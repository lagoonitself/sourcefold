import type { Placement } from "./anchoring";
import { segmentsForRange } from "./anchoring";
import {
  isTimestampLabel,
  parseFootnoteDefinition,
  parseTimestampHref,
  type FootnoteDef,
  type FootnoteRef,
  type TimestampMark,
} from "./extract";

/**
 * The DOM side of anchoring: offsets count characters of the body element's text nodes in document
 * order, which is what `textContent` returns. Marks wrap text node pieces, so links and footnote
 * markers keep working and the text (and so every offset) never changes.
 */

export const MARK_ATTR = "data-highlight-id";

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

export function textNodesOf(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/** Characters of text before the point (node, offset). */
export function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** Offsets of a DOM range; null unless both ends are inside `root`. */
export function rangeToOffsets(root: Node, range: Range): Placement | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

/** Wraps [start, end) in `<mark>` elements, one per text node piece. Returns them. */
export function wrapOffsets(
  root: Node,
  start: number,
  end: number,
  id: string,
  className: string,
): HTMLElement[] {
  const nodes = textNodesOf(root);
  const segments = segmentsForRange(
    nodes.map((n) => n.data.length),
    start,
    end,
  );
  const marks: HTMLElement[] = [];
  for (const { index, from, to } of segments) {
    const node = nodes[index];
    const parentTag = node.parentElement?.tagName ?? "";
    if (STRUCTURAL_PARENTS.has(parentTag) && !node.data.slice(from, to).trim()) continue;
    let target = node;
    if (from > 0) target = node.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = document.createElement("mark");
    mark.className = className;
    mark.setAttribute(MARK_ATTR, id);
    target.replaceWith(mark);
    mark.append(target);
    marks.push(mark);
  }
  return marks;
}

/** Takes every highlight mark off the body and joins the split text nodes again. */
export function clearMarks(root: HTMLElement): void {
  const parents = new Set<Node>();
  for (const mark of Array.from(root.querySelectorAll("mark[" + MARK_ATTR + "]"))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parents.add(parent);
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  for (const parent of parents) parent.normalize();
  for (const img of Array.from(root.querySelectorAll("img[" + MARK_ATTR + "]"))) {
    img.removeAttribute(MARK_ATTR);
    img.classList.remove("reader-image-highlight", "is-current");
  }
}

/** The image a highlight points at: same `src`, the one nearest the stored offset. */
export function findImage(
  root: HTMLElement,
  src: string,
  nearOffset: number,
): HTMLImageElement | null {
  let best: HTMLImageElement | null = null;
  let bestDistance = Infinity;
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (img.getAttribute("src") !== src) continue;
    const distance = Math.abs(
      offsetOf(root, img.parentNode ?? root, indexInParent(img)) - nearOffset,
    );
    if (distance < bestDistance) {
      best = img;
      bestDistance = distance;
    }
  }
  return best;
}

function indexInParent(node: Node): number {
  return Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node) as number;
}

/** Text offset at the position of an element (images have no text of their own). */
export function offsetBefore(root: Node, el: Node): number {
  return offsetOf(root, el.parentNode ?? root, indexInParent(el));
}

/** Highlight ids a node belongs to, innermost first. */
export function highlightIdAt(node: Node | null): string | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest("[" + MARK_ATTR + "]")?.getAttribute(MARK_ATTR) ?? null;
}

export function elementsForHighlight(root: HTMLElement, id: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[" + MARK_ATTR + '="' + id + '"]'));
}

/**
 * Timestamp links of a YouTube transcript, with the text offset each one starts at, and the
 * offset of the first heading after them (the transcript's end; Infinity when none follows).
 */
export function collectTimestamps(root: HTMLElement): { marks: TimestampMark[]; end: number } {
  const marks: TimestampMark[] = [];
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    if (!isTimestampLabel(a.textContent ?? "")) continue;
    const seconds = parseTimestampHref(a.getAttribute("href") ?? "");
    const first = a.firstChild;
    if (seconds === null || !first) continue;
    marks.push({ offset: offsetOf(root, first, 0), seconds });
  }
  let end = Infinity;
  if (marks.length > 0) {
    const last = marks[marks.length - 1].offset;
    for (const heading of Array.from(root.querySelectorAll("h1, h2, h3"))) {
      const at = offsetOf(root, heading, 0);
      if (at > last) {
        end = at;
        break;
      }
    }
  }
  return { marks, end };
}

export interface FootnoteIndex {
  refs: FootnoteRef[];
  /** Every reference in the article's list, by label, in list order. */
  defs: Map<string, FootnoteDef>;
}

/** Footnote markers in the text and the reference list at the end (render-markdown.ts). */
export function collectFootnotes(root: HTMLElement): FootnoteIndex {
  const defs = new Map<string, FootnoteDef>();
  for (const li of Array.from(root.querySelectorAll("ul.footnotes > li"))) {
    const label = (li.querySelector(".fn-label")?.textContent ?? "").replace(/^\[|\]$/g, "").trim();
    const body = li.querySelector(".fn-text");
    if (!label || !body || defs.has(label)) continue;
    const def = parseFootnoteDefinition(label, {
      text: body.textContent ?? "",
      links: Array.from(body.querySelectorAll("a")).map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: a.textContent ?? "",
      })),
    });
    if (def) defs.set(label, def);
  }
  const refs: FootnoteRef[] = [];
  for (const a of Array.from(root.querySelectorAll("sup.fn-ref > a"))) {
    const first = a.firstChild;
    const label = (a.textContent ?? "").replace(/^\[|\]$/g, "").trim();
    if (!first || !label) continue;
    refs.push({ offset: offsetOf(root, first, 0), label });
  }
  return { refs, defs };
}
