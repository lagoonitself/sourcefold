import type { Token, Tokens } from "marked";
import {
  definedFootnotes,
  lexMarkdown,
  mapBlockSpans,
  safeImageUrl,
  type BlockSpan,
} from "./render-markdown";

/**
 * Cutting text out of a source's Markdown body, for the reader's "Remove text" mode.
 *
 * The reader shows the body as HTML in which each removable block carries its place in the
 * Markdown (`data-sf-src`, see `renderMarkdown(text, { sourceMap: true })`). A removal names the
 * block and, for a part of its text, the visible-text offsets inside it. This module turns that
 * into cuts in the Markdown: a whole block goes with its markers, and a part of a paragraph,
 * heading or one-line list item goes without leaving stray `**` or `[](…)` behind. Anything it
 * can't place exactly is refused, so a wrong cut is never made.
 */

export interface RemoveTarget {
  /** The block's `data-sf-src`, "start-end". */
  start: number;
  end: number;
  /** The visible text to remove, as offsets in the block's text; leave out to remove the block. */
  from?: number;
  to?: number;
  /** The block's visible text length as the page measured it; a mismatch means a bad mapping. */
  textLength?: number;
}

export type RemoveResult = { ok: true; markdown: string } | { ok: false; message: string };

const CANT_PLACE = "Part of this can't be cut here. Remove the whole block, or use Edit as text.";

class Unsupported extends Error {}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

const ENTITY_SOURCE = "&(#\\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);";
const HAS_ENTITY = new RegExp(ENTITY_SOURCE, "i");

function decodeEntities(text: string): string {
  return text.replace(new RegExp(ENTITY_SOURCE, "gi"), (match, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return "�";
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** One inline token with where it sits in the source and in the visible text. */
interface Piece {
  /** exact: source and visible text are the same characters; atomic: removed whole or not at all. */
  kind: "exact" | "atomic" | "container";
  srcStart: number;
  srcEnd: number;
  textStart: number;
  textEnd: number;
  children?: Piece[];
}

interface Walk {
  pieces: Piece[];
  /** Source and visible-text positions after the last token. */
  src: number;
  text: number;
}

function joinRaw(tokens: Token[]): string {
  return tokens.map((t) => t.raw).join("");
}

function buildPieces(tokens: Token[], srcPos: number, textPos: number, defined: Set<string>): Walk {
  const pieces: Piece[] = [];
  let src = srcPos;
  let text = textPos;

  for (const token of tokens) {
    const raw = token.raw;
    const base = { srcStart: src, srcEnd: src + raw.length, textStart: text };
    let piece: Piece;

    switch (token.type) {
      case "text": {
        if (!HAS_ENTITY.test(raw)) {
          piece = { ...base, kind: "exact", textEnd: text + raw.length };
          break;
        }
        // Names like &amp; are one character on the page: split the text around them.
        let at = 0;
        for (const match of raw.matchAll(new RegExp(ENTITY_SOURCE, "gi"))) {
          if (match.index > at) {
            const length = match.index - at;
            pieces.push({
              kind: "exact",
              srcStart: src + at,
              srcEnd: src + match.index,
              textStart: text,
              textEnd: text + length,
            });
            text += length;
          }
          const length = decodeEntities(match[0]).length;
          pieces.push({
            kind: "atomic",
            srcStart: src + match.index,
            srcEnd: src + match.index + match[0].length,
            textStart: text,
            textEnd: text + length,
          });
          text += length;
          at = match.index + match[0].length;
        }
        if (at < raw.length) {
          pieces.push({
            kind: "exact",
            srcStart: src + at,
            srcEnd: src + raw.length,
            textStart: text,
            textEnd: text + raw.length - at,
          });
          text += raw.length - at;
        }
        src += raw.length;
        continue;
      }
      case "escape":
        piece = { ...base, kind: "atomic", textEnd: text + 1 };
        break;
      case "codespan":
        piece = {
          ...base,
          kind: "atomic",
          textEnd: text + decodeEntities((token as Tokens.Codespan).text).length,
        };
        break;
      case "br":
      case "html":
        piece = { ...base, kind: "atomic", textEnd: text };
        break;
      case "image": {
        const image = token as Tokens.Image;
        // A safe image has no text; an unsafe one is shown as its alt text.
        const alt = safeImageUrl(image.href) ? 0 : decodeEntities(image.text).length;
        piece = { ...base, kind: "atomic", textEnd: text + alt };
        break;
      }
      case "footnoteRef": {
        const label = (token as Token & { label: string }).label;
        piece = {
          ...base,
          kind: "atomic",
          textEnd: text + (defined.has(label) ? label.length + 2 : raw.length),
        };
        break;
      }
      case "strong":
      case "em":
      case "del":
      case "link": {
        const inner = (token as Tokens.Generic).tokens;
        if (!inner || inner.length === 0) throw new Unsupported();
        const prefix = raw.indexOf(joinRaw(inner));
        if (prefix < 0) throw new Unsupported();
        const children = buildPieces(inner, src + prefix, text, defined);
        piece = { ...base, kind: "container", textEnd: children.text, children: children.pieces };
        break;
      }
      default:
        throw new Unsupported();
    }

    pieces.push(piece);
    src = piece.srcEnd;
    text = piece.textEnd;
  }
  return { pieces, src, text };
}

interface Cut {
  a: number;
  b: number;
  /** Where the block's text starts: spaces right after a cut there are dropped too. */
  contentStart: number;
}

/** The ranges of the source that hold the visible text from `from` to `to`. */
function cutPieces(pieces: Piece[], from: number, to: number, contentStart: number, out: Cut[]) {
  for (const piece of pieces) {
    const length = piece.textEnd - piece.textStart;
    if (length === 0) {
      // Something with no visible text (a line break, an image) goes only from inside a removal.
      if (piece.textStart > from && piece.textStart < to) {
        out.push({ a: piece.srcStart, b: piece.srcEnd, contentStart });
      }
      continue;
    }
    if (piece.textEnd <= from || piece.textStart >= to) continue;
    if (from <= piece.textStart && piece.textEnd <= to) {
      out.push({ a: piece.srcStart, b: piece.srcEnd, contentStart });
    } else if (piece.kind === "container" && piece.children) {
      cutPieces(piece.children, from, to, contentStart, out);
    } else if (piece.kind === "exact") {
      const first = Math.max(from, piece.textStart) - piece.textStart;
      const last = Math.min(to, piece.textEnd) - piece.textStart;
      out.push({ a: piece.srcStart + first, b: piece.srcStart + last, contentStart });
    } else {
      // Can't be split (an escape, a footnote mark, a name like &amp;): goes whole.
      out.push({ a: piece.srcStart, b: piece.srcEnd, contentStart });
    }
  }
}

/** The inline tokens of a block whose text can be cut in part, and where they start. */
function inlineOf(block: BlockSpan): { tokens: Token[]; base: number } | null {
  const token = block.token;
  if (token.type === "paragraph" || token.type === "heading") {
    const inner = (token as Tokens.Paragraph).tokens;
    const at = token.raw.indexOf(joinRaw(inner));
    return at < 0 ? null : { tokens: inner, base: block.start + at };
  }
  if (token.type === "list_item") {
    const item = token as Tokens.ListItem;
    const only = item.tokens[0];
    // One line of text: a second line or a nested list has had its indentation stripped.
    if (item.task || item.tokens.length !== 1 || !only) return null;
    if (only.type !== "text" && only.type !== "paragraph") return null;
    if (only.raw.includes("\n")) return null;
    const inner = (only as Tokens.Text).tokens;
    if (!inner || joinRaw(inner) !== only.raw) return null;
    const at = item.raw.indexOf(only.raw);
    return at < 0 ? null : { tokens: inner, base: block.start + at };
  }
  return null;
}

const isOpeningMark = (ch: string | undefined) => ch !== undefined && "*_~[".includes(ch);
const isClosingMark = (ch: string | undefined) => ch !== undefined && "*_~]".includes(ch);

function applyCuts(markdown: string, cuts: Cut[]): string {
  const sorted = cuts.filter((c) => c.b > c.a).sort((x, y) => x.a - y.a || x.b - y.b);
  const merged: Cut[] = [];
  for (const cut of sorted) {
    const last = merged[merged.length - 1];
    if (last && cut.a <= last.b) last.b = Math.max(last.b, cut.b);
    else merged.push({ ...cut });
  }

  let out = markdown;
  for (let i = merged.length - 1; i >= 0; i--) {
    const { a, b, contentStart } = merged[i]!;
    out = out.slice(0, a) + out.slice(b);
    if (contentStart < 0) continue;
    // Tidy the seam: no double space, no space left at the start or end of the text or next to
    // a bold, italic or link marker (`**bold **` would stop being bold).
    const before = out[a - 1];
    const after = out[a];
    if (after === " " && (before === " " || a === contentStart || isOpeningMark(before))) {
      let end = a;
      while (out[end] === " ") end++;
      out = out.slice(0, a) + out.slice(end);
    } else if (
      before === " " &&
      out[a - 2] !== " " &&
      (after === "\n" || after === undefined || isClosingMark(after)) &&
      a - 1 >= contentStart
    ) {
      out = out.slice(0, a - 1) + out.slice(a);
    }
  }
  return out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/** A removable block as the page shows it. */
export interface RenderedBlock {
  /** The block's `data-sf-src`. */
  start: number;
  end: number;
  /** Where the block's visible text starts in the whole body's visible text. */
  textStart: number;
  text: string;
}

/**
 * What to remove for a selection given as offsets into the body's visible text: a block the
 * selection covers entirely goes whole, a block it only touches loses just the selected part.
 */
export function targetsForSelection(
  blocks: RenderedBlock[],
  from: number,
  to: number,
): RemoveTarget[] {
  const targets: RemoveTarget[] = [];
  for (const block of blocks) {
    const first = Math.max(from, block.textStart) - block.textStart;
    const last = Math.min(to, block.textStart + block.text.length) - block.textStart;
    if (last <= first) continue;
    const rest = block.text.slice(0, first) + block.text.slice(last);
    if (rest.trim() === "") {
      targets.push({ start: block.start, end: block.end });
    } else {
      targets.push({
        start: block.start,
        end: block.end,
        from: first,
        to: last,
        textLength: block.text.length,
      });
    }
  }
  return targets;
}

/**
 * The body with the targets cut out of it. Fails with a message for the user when a target can't
 * be placed exactly; nothing is cut then.
 */
export function removeFromBody(markdown: string, targets: RemoveTarget[]): RemoveResult {
  if (targets.length === 0) return { ok: false, message: "Nothing to remove." };

  const tokens = lexMarkdown(markdown);
  const blocks = mapBlockSpans(tokens, markdown);
  const byKey = new Map(blocks.map((b) => [`${b.start}-${b.end}`, b]));
  const defined = definedFootnotes(tokens);

  const cuts: Cut[] = [];
  for (const target of targets) {
    const block = byKey.get(`${target.start}-${target.end}`);
    if (!block) {
      return { ok: false, message: "The text changed. Close the source, open it again and retry." };
    }
    if (target.from === undefined || target.to === undefined) {
      cuts.push({ a: block.start, b: block.end, contentStart: -1 });
      continue;
    }

    const inline = inlineOf(block);
    if (!inline) return { ok: false, message: CANT_PLACE };
    let walk: Walk;
    try {
      walk = buildPieces(inline.tokens, inline.base, 0, defined);
    } catch (error) {
      if (error instanceof Unsupported) return { ok: false, message: CANT_PLACE };
      throw error;
    }
    if (target.textLength !== undefined && target.textLength !== walk.text) {
      return { ok: false, message: CANT_PLACE };
    }
    cutPieces(walk.pieces, target.from, target.to, inline.base, cuts);
  }

  return { ok: true, markdown: applyCuts(markdown, cuts) };
}
