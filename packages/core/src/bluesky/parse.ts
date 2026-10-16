// Turns a `getPostThread` response into Markdown shaped like an X thread: the root post and the
// author's own replies in sequence, everyone else's replies as nested blockquotes.

import type { SourceMetaValue } from "../capture-types";
import { blueskyPostUrl } from "../source-links";

const MAX_POSTS = 200;
const MAX_DEPTH = 4;

export interface BlueskyPost {
  did: string;
  handle: string;
  name: string;
  rkey: string;
  /** `YYYY-MM-DD` (UTC), or null. */
  date: string | null;
  createdAt: string | null;
  /** Post text with facets (links, mentions) turned into Markdown. */
  text: string;
  /** Embedded media and quotes as Markdown blocks. */
  embeds: string[];
  replies: BlueskyPost[];
}

export interface BlueskyThread {
  root: BlueskyPost;
  /** The author's own replies in order: each answers the one before (the first answers root). */
  chain: BlueskyPost[];
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dateOf(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

/** Applies facets; their ranges count UTF-8 bytes. */
function textWithFacets(text: string, facets: unknown[]): string {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const ranges: { start: number; end: number; href: string }[] = [];
  for (const facetValue of facets) {
    const facet = obj(facetValue);
    const index = obj(facet?.index);
    const start = index?.byteStart;
    const end = index?.byteEnd;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      start < 0 ||
      start >= end ||
      end > bytes.length
    ) {
      continue;
    }
    for (const featureValue of arr(facet?.features)) {
      const feature = obj(featureValue);
      const type = feature?.$type;
      let href: string | null = null;
      if (type === "app.bsky.richtext.facet#link") href = str(feature?.uri);
      else if (type === "app.bsky.richtext.facet#mention") {
        const did = str(feature?.did);
        href = did ? `https://bsky.app/profile/${did}` : null;
      }
      if (href) {
        ranges.push({ start, end, href });
        break;
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const range of ranges) {
    if (range.start < at) continue;
    out += decoder.decode(bytes.slice(at, range.start));
    const label = decoder.decode(bytes.slice(range.start, range.end));
    out += `[${label}](${range.href})`;
    at = range.end;
  }
  return out + decoder.decode(bytes.slice(at));
}

function cleanLabel(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
}

function mediaLines(embed: Json): string[] {
  const type = embed.$type;
  if (type === "app.bsky.embed.images#view") {
    const lines: string[] = [];
    for (const imageValue of arr(embed.images)) {
      const image = obj(imageValue);
      const src = str(image?.fullsize) ?? str(image?.thumb);
      if (src) lines.push(`![${cleanLabel(str(image?.alt) ?? "")}](${src})`);
    }
    return lines;
  }
  if (type === "app.bsky.embed.external#view") {
    const external = obj(embed.external);
    const uri = str(external?.uri);
    if (!uri) return [];
    return [`[${cleanLabel(str(external?.title) ?? uri) || uri}](${uri})`];
  }
  return [];
}

/** "Quoting [@handle](url)" and the quoted text as a blockquote. */
function quoteBlock(record: Json): string[] {
  if (record.$type !== "app.bsky.embed.record#viewRecord") return [];
  const handle = str(obj(record.author)?.handle);
  const uri = str(record.uri);
  if (!handle || !uri) return [];
  const value = obj(record.value);
  const text = textWithFacets(str(value?.text) ?? "", arr(value?.facets));
  const inner: string[] = [];
  if (text) inner.push(text);
  for (const embedValue of arr(record.embeds)) {
    const embed = obj(embedValue);
    if (embed) inner.push(...mediaLines(embed));
  }
  const rkey = uri.split("/").pop() ?? "";
  let block = `Quoting [@${handle}](${blueskyPostUrl(handle, rkey)})`;
  if (inner.length > 0) {
    const quote = inner
      .join("\n\n")
      .split("\n")
      .map((line) => (line === "" ? ">" : `> ${line}`))
      .join("\n");
    block += `\n\n${quote}`;
  }
  return [block];
}

function embedBlocks(embed: Json | null): string[] {
  if (!embed) return [];
  const type = embed.$type;
  if (type === "app.bsky.embed.record#view") {
    const record = obj(embed.record);
    return record ? quoteBlock(record) : [];
  }
  if (type === "app.bsky.embed.recordWithMedia#view") {
    const media = obj(embed.media);
    const record = obj(obj(embed.record)?.record);
    return [...(media ? mediaLines(media) : []), ...(record ? quoteBlock(record) : [])];
  }
  return mediaLines(embed);
}

function parsePost(value: unknown): BlueskyPost | null {
  const post = obj(value);
  const author = obj(post?.author);
  const record = obj(post?.record);
  const uri = str(post?.uri);
  const did = str(author?.did);
  const handle = str(author?.handle);
  if (!post || !record || !uri || !did || !handle) return null;
  const createdAt = str(record.createdAt);
  return {
    did,
    handle,
    name: str(author?.displayName)?.trim() || handle,
    rkey: uri.split("/").pop() ?? "",
    date: dateOf(createdAt),
    createdAt,
    text: textWithFacets(str(record.text) ?? "", arr(record.facets)),
    embeds: embedBlocks(obj(post.embed)),
    replies: [],
  };
}

function parseNode(value: unknown, depth: number): BlueskyPost | "missing" | null {
  const node = obj(value);
  if (!node) return null;
  const type = str(node.$type) ?? "";
  if (type.endsWith("#notFoundPost") || type.endsWith("#blockedPost")) return "missing";
  const post = parsePost(node.post);
  if (!post) return null;
  if (depth < 64) {
    for (const reply of arr(node.replies)) {
      const child = parseNode(reply, depth + 1);
      if (child && child !== "missing") post.replies.push(child);
    }
    post.replies.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  }
  return post;
}

/** Returns "missing" for a deleted, blocked or unknown post, null when the JSON isn't a thread. */
export function parseBlueskyThread(json: unknown): BlueskyThread | "missing" | null {
  const root = parseNode(obj(json)?.thread, 0);
  if (!root || root === "missing") return root;
  const chain: BlueskyPost[] = [];
  let current = root;
  for (;;) {
    const next = current.replies.find((reply) => reply.did === root.did);
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return { root, chain };
}

export function blueskyTitle(thread: BlueskyThread): string {
  const prefix = thread.chain.length > 0 ? "Thread by" : "Post by";
  return `${prefix} ${thread.root.name} (@${thread.root.handle})`;
}

export function blueskyMeta(thread: BlueskyThread): Record<string, SourceMetaValue> {
  return {
    author: thread.root.name,
    author_url: `https://bsky.app/profile/${thread.root.handle}`,
    posted: thread.root.date,
  };
}

function postLines(post: BlueskyPost): string[] {
  const header = [`**${post.name}** (@${post.handle})`];
  if (post.date) header.push(post.date);
  header.push(`[link](${blueskyPostUrl(post.handle, post.rkey)})`);
  const parts = [header.join(" · ")];
  if (post.text) parts.push(post.text);
  parts.push(...post.embeds);
  // A blank line between header and text; inside a quote it becomes a bare ">" line.
  return parts.join("\n\n").split("\n");
}

function quoted(lines: string[], level: number): string[] {
  if (level === 0) return lines;
  const prefix = "> ".repeat(level);
  const blank = prefix.trimEnd();
  return lines.map((line) => (line === "" ? blank : `${prefix}${line}`));
}

export function renderBlueskyMarkdown(thread: BlueskyThread): string {
  const blocks: { level: number; lines: string[] }[] = [];
  let count = 0;

  const addReplies = (replies: BlueskyPost[], level: number, skip: BlueskyPost | null): void => {
    for (const reply of replies) {
      if (reply === skip) continue;
      if (count >= MAX_POSTS || level > MAX_DEPTH) return;
      count++;
      blocks.push({ level, lines: quoted(postLines(reply), level) });
      addReplies(reply.replies, level + 1, null);
    }
  };

  const sequence = [thread.root, ...thread.chain];
  for (const [i, post] of sequence.entries()) {
    if (count >= MAX_POSTS) break;
    count++;
    blocks.push({ level: 0, lines: postLines(post) });
    addReplies(post.replies, 1, sequence[i + 1] ?? null);
  }

  // Posts are separated by a blank line of the shallower level, so quotes stay apart from the
  // top-level posts around them but a reply chain stays one quote.
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    const previous = blocks[i - 1];
    if (previous) lines.push(...quoted([""], Math.min(previous.level, block.level)));
    lines.push(...block.lines);
  });
  return lines.join("\n").trim();
}
