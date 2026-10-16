// Reads one Hacker News item from the official Algolia API
// (`https://hn.algolia.com/api/v1/items/<id>`) and renders the saved body: the story's own link
// and text, then the comments as nested blockquotes in Hacker News' own order.

import type { SourceMetaValue } from "../capture-types";
import { formatDate } from "../front-matter";
import { hackerNewsItemUrl } from "../source-links";
import { hackerNewsTextToMarkdown } from "./markdown";

/** One item of the Algolia response: a story, comment, job or poll. */
export interface HackerNewsItem {
  id: string;
  type: string;
  author: string | null;
  createdAt: string | null;
  points: number | null;
  /** The story's own address, null for a comment. */
  url: string | null;
  title: string | null;
  /** Comment or story HTML, empty when there is none. */
  text: string;
  children: HackerNewsItem[];
}

/** Five levels of comments: the top level is depth 0. */
const MAX_DEPTH = 4;
/** The most comments a saved file keeps. */
const MAX_COMMENTS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseHackerNewsItem(value: unknown): HackerNewsItem | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== "number" && typeof id !== "string") return null;

  const children = Array.isArray(value.children) ? value.children : [];
  const author = field(value.author)?.trim();

  return {
    id: String(id),
    type: field(value.type) ?? "comment",
    author: author ? author : null,
    createdAt: field(value.created_at),
    points: count(value.points),
    url: field(value.url)?.trim() || null,
    title: field(value.title)?.trim() || null,
    text: field(value.text) ?? "",
    children: children
      .map((child) => parseHackerNewsItem(child))
      .filter((child): child is HackerNewsItem => child !== null),
  };
}

export function hackerNewsTitle(item: HackerNewsItem): string {
  if (item.title) return item.title;
  if (item.author) return `Comment by ${item.author}`;
  return "Hacker News item";
}

export function hackerNewsPostedDate(item: HackerNewsItem): string | null {
  if (!item.createdAt) return null;
  try {
    return formatDate(item.createdAt);
  } catch {
    return null;
  }
}

/** Every descendant comment that still has text, at any depth: the item's comment count. */
export function hackerNewsCommentCount(item: HackerNewsItem): number {
  let total = 0;
  for (const child of item.children) {
    if (hackerNewsTextToMarkdown(child.text)) total++;
    total += hackerNewsCommentCount(child);
  }
  return total;
}

/** The front matter fields for a Hacker News item, in FILE-FORMAT order. */
export function hackerNewsMeta(item: HackerNewsItem): Record<string, SourceMetaValue> {
  return {
    author: item.author,
    posted: hackerNewsPostedDate(item),
    points: item.points,
    comments: hackerNewsCommentCount(item),
    link: item.url,
  };
}

/** Deleted comments arrive with no author or no text; keep them only for their replies. */
function isGone(item: HackerNewsItem): boolean {
  return !item.author || !hackerNewsTextToMarkdown(item.text);
}

function keepComments(item: HackerNewsItem, depth: number): HackerNewsItem[] {
  if (depth > MAX_DEPTH) return [];
  const kept: HackerNewsItem[] = [];
  for (const child of item.children) {
    const replies = keepComments(child, depth + 1);
    if (isGone(child) && replies.length === 0) continue;
    kept.push({ ...child, children: replies });
  }
  return kept;
}

function renderCommentLines(item: HackerNewsItem, depth: number): string[] {
  const prefix = "> ".repeat(depth);
  const blank = prefix.trimEnd();

  const parts = [`**${item.author ?? "[deleted]"}**`];
  const posted = hackerNewsPostedDate(item);
  if (posted) parts.push(posted);
  parts.push(`[link](${hackerNewsItemUrl(item.id)})`);

  const text = hackerNewsTextToMarkdown(item.text);
  const lines = [`${prefix}${parts.join(" · ")}`];
  if (text) {
    lines.push(blank);
    for (const line of text.split("\n")) {
      if (line === "") {
        lines.push(blank);
      } else {
        const escaped = line.startsWith("#") ? `\\${line}` : line;
        lines.push(`${prefix}${escaped}`);
      }
    }
  }
  return lines;
}

/** The saved body: the story's link and text, then `## Comments`. */
export function renderHackerNewsMarkdown(item: HackerNewsItem): string {
  const blocks: string[] = [];
  if (item.url) blocks.push(`[${item.url}](${item.url})`);
  const text = hackerNewsTextToMarkdown(item.text);
  if (text) blocks.push(text);

  const ordered: { item: HackerNewsItem; depth: number }[] = [];
  const visit = (comment: HackerNewsItem, depth: number) => {
    if (ordered.length >= MAX_COMMENTS) return;
    ordered.push({ item: comment, depth });
    for (const reply of comment.children) visit(reply, depth + 1);
  };
  for (const comment of keepComments(item, 0)) visit(comment, 0);

  if (ordered.length > 0) {
    const lines: string[] = ["## Comments", ""];
    ordered.forEach((entry, index) => {
      if (index > 0) {
        const previous = ordered[index - 1]!.depth;
        lines.push("> ".repeat(Math.min(previous, entry.depth)).trimEnd());
      }
      lines.push(...renderCommentLines(entry.item, entry.depth));
    });
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}
