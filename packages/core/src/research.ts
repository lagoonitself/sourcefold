// Research tools: keep / maybe / cut, outline tags, summaries, who wrote a source, quote cards,
// the outline and script, b-roll clips and duplicates (docs/dev/handoff-research.md).
// Pure and browser-safe: no Node APIs.

import {
  copySourceFromItem,
  formatHighlightTime,
  youtubeTimestampUrl,
  youtubeVideoId,
  type CopySource,
} from "./highlights";
import { parseArxivLink } from "./source-links";

// ---------------------------------------------------------------------------------------------
// Per-source fields

export const TRIAGE_VALUES = ["keep", "maybe", "cut"] as const;
export type Triage = (typeof TRIAGE_VALUES)[number];

export const TRIAGE_LABELS: Record<Triage, string> = {
  keep: "Keep",
  maybe: "Maybe",
  cut: "Cut",
};

export const AUTHOR_TYPES = [
  "lab",
  "researcher",
  "journalist",
  "company",
  "government",
  "creator",
  "forum",
  "encyclopedia",
  "other",
] as const;
export type AuthorType = (typeof AUTHOR_TYPES)[number];

export const AUTHOR_TYPE_LABELS: Record<AuthorType, string> = {
  lab: "Lab",
  researcher: "Researcher",
  journalist: "Journalist",
  company: "Company",
  government: "Government",
  creator: "Creator",
  forum: "Forum",
  encyclopedia: "Encyclopedia",
  other: "Other",
};

/** What each type means, for pickers and for Claude's tool descriptions. */
export const AUTHOR_TYPE_HINTS: Record<AuthorType, string> = {
  lab: "AI lab or research organisation (DeepMind, OpenAI, METR, Epoch AI)",
  researcher: "Academic or independent researcher, a paper",
  journalist: "News outlet or reporter",
  company: "Company blog, product page or press release",
  government: "Government or public body",
  creator: "YouTuber, podcaster, blogger or newsletter writer",
  forum: "Forum, Reddit, Hacker News, community wiki or meme site",
  encyclopedia: "Wikipedia, Grokipedia",
  other: "Anything else",
};

/** The research fields every source (item) has, besides what was captured. */
export interface ItemResearchFields {
  triage: Triage | null;
  /** Outline tags, in the order the user added them. */
  tags: string[];
  /** A short summary written by the user or Claude. */
  summary: string | null;
  /** Who wrote it, when the captured byline is missing or wrong. */
  author: string | null;
  author_type: AuthorType | null;
}

/** A change to some of them; a key left out stays as it is, `null` clears it. */
export type ItemResearchPatch = Partial<ItemResearchFields>;

export const RESEARCH_LIMITS = {
  tags: 20,
  tagLength: 60,
  summary: 5000,
  author: 200,
} as const;

export function isTriage(value: unknown): value is Triage {
  return typeof value === "string" && (TRIAGE_VALUES as readonly string[]).includes(value);
}

export function isAuthorType(value: unknown): value is AuthorType {
  return typeof value === "string" && (AUTHOR_TYPES as readonly string[]).includes(value);
}

/**
 * Trims each tag and collapses its whitespace, drops empty ones and repeats (compared without
 * case; the first spelling wins), and cuts each to the length limit. Does not cut the count:
 * callers refuse more than `RESEARCH_LIMITS.tags`.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.replace(/\s+/g, " ").trim().slice(0, RESEARCH_LIMITS.tagLength).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Same tag, ignoring case and spacing. */
export function sameTag(a: string, b: string): boolean {
  return (
    a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase()
  );
}

interface SourceLike {
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, unknown> | null;
  author?: string | null;
  author_type?: string | null;
}

function str(val: unknown): string | null {
  return typeof val === "string" && val.trim() ? val.trim() : null;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function itemUrl(item: SourceLike): string | null {
  return str(item.canonical_url) ?? str(item.source_url);
}

/**
 * Who wrote a source, for display: the author set by the user or Claude, else the captured
 * byline (author, YouTube channel, subreddit, publication, site). Null when nothing is known.
 */
export function sourceAuthor(item: SourceLike): string | null {
  const own = str(item.author);
  if (own) return own;
  const meta = item.meta ?? {};
  const author = str(meta.author) ?? str(meta.channel);
  if (author) return author;
  const sub = str(meta.subreddit);
  if (sub) return `r/${sub.replace(/^\/?r\//, "")}`;
  return str(meta.publication) ?? str(meta.site);
}

// Hosts whose type is known. A host matches itself and its subdomains.
const KNOWN_HOSTS: Record<string, AuthorType> = {
  // Labs and research organisations.
  "openai.com": "lab",
  "anthropic.com": "lab",
  "deepmind.google": "lab",
  "deepmind.com": "lab",
  "research.google": "lab",
  "ai.google": "lab",
  "ai.meta.com": "lab",
  "x.ai": "lab",
  "mistral.ai": "lab",
  "metr.org": "lab",
  "epoch.ai": "lab",
  "epochai.org": "lab",
  "redwoodresearch.org": "lab",
  "apolloresearch.ai": "lab",
  "safe.ai": "lab",
  "alignment.org": "lab",
  "rand.org": "lab",
  "ai-2027.com": "lab",
  "situational-awareness.ai": "researcher",
  // Papers.
  "arxiv.org": "researcher",
  "openreview.net": "researcher",
  "papers.nips.cc": "researcher",
  "proceedings.mlr.press": "researcher",
  "nature.com": "researcher",
  "science.org": "researcher",
  "ssrn.com": "researcher",
  "lesswrong.com": "forum",
  "alignmentforum.org": "forum",
  // News.
  "nytimes.com": "journalist",
  "wsj.com": "journalist",
  "ft.com": "journalist",
  "bloomberg.com": "journalist",
  "reuters.com": "journalist",
  "apnews.com": "journalist",
  "bbc.co.uk": "journalist",
  "bbc.com": "journalist",
  "cnn.com": "journalist",
  "cnbc.com": "journalist",
  "theguardian.com": "journalist",
  "washingtonpost.com": "journalist",
  "economist.com": "journalist",
  "axios.com": "journalist",
  "theverge.com": "journalist",
  "wired.com": "journalist",
  "arstechnica.com": "journalist",
  "techcrunch.com": "journalist",
  "theinformation.com": "journalist",
  "technologyreview.com": "journalist",
  "venturebeat.com": "journalist",
  "techspot.com": "journalist",
  "gamespot.com": "journalist",
  "ign.com": "journalist",
  "polygon.com": "journalist",
  "kotaku.com": "journalist",
  "pcgamer.com": "journalist",
  "decrypt.co": "journalist",
  "fortune.com": "journalist",
  "forbes.com": "journalist",
  "businessinsider.com": "journalist",
  "time.com": "journalist",
  "vox.com": "journalist",
  "semafor.com": "journalist",
  "404media.co": "journalist",
  "tomshardware.com": "journalist",
  "engadget.com": "journalist",
  // Forums and community sites.
  "reddit.com": "forum",
  "news.ycombinator.com": "forum",
  "knowyourmeme.com": "forum",
  "stackexchange.com": "forum",
  "stackoverflow.com": "forum",
  "quora.com": "forum",
  "fandom.com": "forum",
  // Encyclopedias.
  "wikipedia.org": "encyclopedia",
  "grokipedia.com": "encyclopedia",
  "britannica.com": "encyclopedia",
  // Creators.
  "youtube.com": "creator",
  "youtu.be": "creator",
  "substack.com": "creator",
  "medium.com": "creator",
};

function knownHostType(host: string | null): AuthorType | null {
  if (!host) return null;
  let h = host;
  for (;;) {
    const hit = KNOWN_HOSTS[h];
    if (hit) return hit;
    const dot = h.indexOf(".");
    if (dot === -1) return null;
    h = h.slice(dot + 1);
    if (!h.includes(".")) return null;
  }
}

/**
 * A guess at what kind of author wrote a source, from its kind and address. Null when there is
 * no good guess (an X post or a web page on an unknown site).
 */
export function guessAuthorType(item: SourceLike): AuthorType | null {
  switch (item.kind) {
    case "grokipedia":
    case "wikipedia":
      return "encyclopedia";
    case "reddit":
    case "hackernews":
      return "forum";
    case "youtube":
    case "substack":
      return "creator";
    case "note":
    case "image":
      return null;
  }
  const meta = item.meta ?? {};
  if (item.kind === "pdf" && str(meta.arxiv)) return "researcher";
  const host = hostOf(itemUrl(item));
  if (!host) return null;
  if (/\.gov$|\.gov\.[a-z]{2}$|\.mil$|^europa\.eu$|\.europa\.eu$/.test(host)) return "government";
  if (/\.edu$|\.ac\.[a-z]{2}$|\.edu\.[a-z]{2}$/.test(host)) return "researcher";
  return knownHostType(host);
}

/** The type to show: the one set by the user or Claude, else the guess (marked as a guess). */
export function effectiveAuthorType(item: SourceLike): {
  type: AuthorType | null;
  guessed: boolean;
} {
  if (isAuthorType(item.author_type)) return { type: item.author_type, guessed: false };
  const guess = guessAuthorType(item);
  return { type: guess, guessed: guess !== null };
}

// ---------------------------------------------------------------------------------------------
// Cards, outline sections and b-roll

/**
 * `quote`: a passage from a source (usually made from a highlight). `broll`: a clip to show,
 * from a saved video or any video link. `line`: a script line the user wrote, with no source.
 */
export type CardKind = "quote" | "broll" | "line";

export interface Card {
  /** uuid, made by the client. */
  id: string;
  /** The project (top-level folder) the card belongs to. */
  project_id: string;
  kind: CardKind;
  /** The source it came from; null for `line` cards and for b-roll from an unsaved video. */
  item_id: string | null;
  /** The highlight it was made from, while that highlight exists. */
  highlight_id: string | null;
  /** `quote`: the exact passage. `broll`: what the clip shows. `line`: always "". */
  quote: string;
  /** Video time the passage or clip starts at, in whole seconds. */
  seconds: number | null;
  /** `broll` only: where the clip ends. */
  end_seconds: number | null;
  /** `broll` only: the video link when the clip isn't from a saved source. */
  url: string | null;
  note: string | null;
  /** How the card reads in the script. Empty means "use the quote" (a `line` card always has one). */
  script_line: string | null;
  /** The outline section it is placed in; null while it waits in the card pile. */
  section_id: string | null;
  /** Order inside its section (or the pile). Any number; the client picks midpoints. */
  position: number;
  created_at: string;
  updated_at: string;
}

export type CardInput = Omit<Card, "created_at" | "updated_at">;

/** What `PATCH` may change on a card. */
export type CardPatch = Partial<
  Pick<
    Card,
    "quote" | "seconds" | "end_seconds" | "url" | "note" | "script_line" | "section_id" | "position"
  >
>;

export const CARD_LIMITS = {
  quote: 10000,
  note: 5000,
  scriptLine: 5000,
  url: 2000,
} as const;

export interface OutlineSection {
  id: string;
  project_id: string;
  /** 1–200 characters. Doubles as an outline tag on sources. */
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export type OutlineSectionInput = Omit<OutlineSection, "created_at" | "updated_at">;

export const SECTION_TITLE_MAX = 200;

/**
 * Checks a card the way the server and the desktop do. Returns the first problem as a sentence,
 * or null when the card is fine.
 */
export function cardProblem(card: CardInput): string | null {
  if (card.kind !== "quote" && card.kind !== "broll" && card.kind !== "line") {
    return "A card is a quote, a b-roll clip or a line.";
  }
  if (card.quote.length > CARD_LIMITS.quote) return "The quote is too long.";
  if (card.note !== null && card.note.length > CARD_LIMITS.note) return "The note is too long.";
  if (card.script_line !== null && card.script_line.length > CARD_LIMITS.scriptLine) {
    return "The script line is too long.";
  }
  for (const s of [card.seconds, card.end_seconds]) {
    if (s !== null && (!Number.isInteger(s) || s < 0)) return "Times are whole seconds.";
  }
  if (card.end_seconds !== null && (card.seconds === null || card.end_seconds < card.seconds)) {
    return "A clip ends after it starts.";
  }
  if (!Number.isFinite(card.position)) return "Invalid position.";
  if (card.url !== null) {
    if (card.url.length > CARD_LIMITS.url || !/^https?:\/\//i.test(card.url)) {
      return "The video link must be an http(s) address.";
    }
  }
  switch (card.kind) {
    case "quote":
      if (!card.item_id) return "A quote card needs its source.";
      if (!card.quote.trim()) return "A quote card needs the quote.";
      if (card.url !== null || card.end_seconds !== null) {
        return "Only b-roll clips have a link or an end time.";
      }
      break;
    case "broll":
      if (!card.item_id && !card.url) return "A b-roll clip needs a saved video or a link.";
      break;
    case "line":
      if (card.item_id || card.highlight_id || card.url) return "A line has no source.";
      if (card.quote !== "") return "A line has no quote.";
      if (!card.script_line?.trim()) return "A line needs its text.";
      if (card.seconds !== null || card.end_seconds !== null) return "A line has no time.";
      break;
  }
  return null;
}

/** Sections by position, then title, then id. */
export function sortSections<T extends Pick<OutlineSection, "position" | "title" | "id">>(
  sections: readonly T[],
): T[] {
  return [...sections].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title) || cmp(a.id, b.id),
  );
}

/** Cards by position, then created_at, then id. */
export function sortCards<T extends Pick<Card, "position" | "created_at" | "id">>(
  cards: readonly T[],
): T[] {
  return [...cards].sort(
    (a, b) => a.position - b.position || cmp(a.created_at, b.created_at) || cmp(a.id, b.id),
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A position between two neighbours (either may be missing), for drag and drop. */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/** "1:05–1:20", or "1:05" without an end. */
export function formatClipTime(seconds: number | null, endSeconds: number | null): string | null {
  if (seconds === null) return null;
  const start = formatHighlightTime(seconds);
  return endSeconds !== null ? `${start}–${formatHighlightTime(endSeconds)}` : start;
}

/** Reads "1:05", "01:02:05", "65" or "1m5s" as seconds; null when it can't. */
export function parseClipTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const colon = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (colon) {
    const [, h, m, s] = colon;
    if (Number(s) > 59 || (h !== undefined && Number(m) > 59)) return null;
    return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s);
  }
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(t);
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  }
  return null;
}

/**
 * The link a card opens: the video at the card's time when the source is a YouTube video (or
 * the b-roll link is one), else the source's own address.
 */
export function cardLink(
  card: Pick<Card, "seconds" | "url">,
  source: Pick<CopySource, "url"> | null,
): string | null {
  const base = card.url ?? source?.url ?? null;
  if (base && card.seconds !== null) {
    const stamped = youtubeTimestampUrl(base, card.seconds);
    if (stamped) return stamped;
  }
  return base;
}

/** A YouTube thumbnail for a video link, or null. */
export function youtubeThumbnailUrl(videoUrl: string | null | undefined): string | null {
  const id = youtubeVideoId(videoUrl);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

// ---------------------------------------------------------------------------------------------
// Script, references and the b-roll list (export formats in docs/dev/handoff-research.md)

/** The source facts the exports need, keyed by item id. */
export type SourceDirectory = Record<string, ScriptSource>;

export interface ScriptSource extends CopySource {
  item_id: string;
}

/** Builds the directory entry for an item (title, byline, address). */
export function scriptSourceFromItem(item: SourceLike & { id: string }): ScriptSource {
  const source = copySourceFromItem(item);
  const author = str(item.author);
  if (!author || source.byline.includes(author)) return { ...source, item_id: item.id };
  // An author set by the user replaces the captured one, or goes first when there was none.
  const meta = item.meta ?? {};
  const captured = str(meta.author) ?? str(meta.channel);
  const byline =
    captured && source.byline[0] === captured
      ? [author, ...source.byline.slice(1)]
      : [author, ...source.byline];
  return { ...source, byline, item_id: item.id };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function describe(source: CopySource): string {
  return [source.title, ...source.byline].filter((p) => p).join(", ");
}

/** A source for a b-roll clip that has only a link: the link's host stands in for the title. */
function linkOnlySource(url: string): CopySource {
  return { title: hostOf(url) ?? url, byline: [], url };
}

/** Numbers sources by first appearance; the same source (or link) keeps its number. */
class ReferenceNumbers {
  readonly order: { key: string; source: CopySource }[] = [];
  private readonly numbers = new Map<string, number>();

  number(card: Card, sources: SourceDirectory): number | null {
    let key: string;
    let source: CopySource;
    if (card.item_id && sources[card.item_id]) {
      key = `item:${card.item_id}`;
      source = sources[card.item_id]!;
    } else if (card.url) {
      key = `url:${card.url}`;
      source = linkOnlySource(card.url);
    } else {
      return null;
    }
    const known = this.numbers.get(key);
    if (known !== undefined) return known;
    const n = this.order.length + 1;
    this.numbers.set(key, n);
    this.order.push({ key, source });
    return n;
  }
}

function citation(n: number | null, card: Card): string {
  const time = formatClipTime(card.seconds, card.kind === "broll" ? card.end_seconds : null);
  if (n === null) return time ? ` [${time}]` : "";
  return time ? ` [${n}, ${time}]` : ` [${n}]`;
}

/** The text a card shows in the script, without its citation. Empty when there is nothing. */
export function scriptLineText(card: Pick<Card, "kind" | "quote" | "script_line">): string {
  const own = collapse(card.script_line ?? "");
  if (own) return own;
  const quote = collapse(card.quote);
  if (!quote) return "";
  return card.kind === "quote" ? `“${quote}”` : quote;
}

function referenceLine(n: number, source: CopySource): string {
  const text = describe(source);
  return source.url ? `${n}. ${text}. ${source.url}` : `${n}. ${text}.`;
}

export interface ScriptInput {
  projectTitle: string;
  sections: readonly OutlineSection[];
  /** Every card of the project; cards not placed in a section are left out of the script. */
  cards: readonly Card[];
  sources: SourceDirectory;
}

export interface ScriptLine {
  card: Card;
  text: string;
  /** Reference number, or null for a `line` card or a card whose source is gone. */
  n: number | null;
  /** The citation as written after the line, e.g. " [2, 3:12]"; "" for none. */
  citation: string;
}

export interface ScriptSectionLines {
  section: OutlineSection;
  lines: ScriptLine[];
}

export interface BuiltScript {
  sections: ScriptSectionLines[];
  /** Cited sources, numbered by first appearance. */
  references: { n: number; source: CopySource }[];
  /** The whole script as Markdown, references at the end. */
  markdown: string;
}

/**
 * Lays out the script: sections in order, each placed card as one line with its citation, and
 * the cited sources numbered by first appearance.
 *
 * ```markdown
 * # <Project> script
 *
 * ## <Section>
 *
 * <script line or “quote”> [1, 3:12]
 *
 * *B-roll: <what it shows>* [2, 1:05–1:20]
 *
 * <a line with no source>
 *
 * ## References
 *
 * 1. <title>, <byline>. <url>
 * ```
 */
export function buildScript(input: ScriptInput): BuiltScript {
  const numbers = new ReferenceNumbers();
  const bySection = new Map<string, Card[]>();
  for (const card of input.cards) {
    if (!card.section_id) continue;
    const list = bySection.get(card.section_id) ?? [];
    list.push(card);
    bySection.set(card.section_id, list);
  }

  const sections: ScriptSectionLines[] = [];
  const blocks: string[] = [`# ${collapse(input.projectTitle) || "Untitled"} script`];
  for (const section of sortSections(input.sections)) {
    const lines: ScriptLine[] = [];
    for (const card of sortCards(bySection.get(section.id) ?? [])) {
      const text = scriptLineText(card);
      if (!text) continue;
      const n = card.kind === "line" ? null : numbers.number(card, input.sources);
      const cite = card.kind === "line" ? "" : citation(n, card);
      lines.push({ card, text, n, citation: cite });
    }
    sections.push({ section, lines });
    blocks.push(`## ${collapse(section.title)}`);
    for (const line of lines) {
      blocks.push(
        line.card.kind === "broll"
          ? `*B-roll: ${line.text}*${line.citation}`
          : `${line.text}${line.citation}`,
      );
    }
  }

  const references = numbers.order.map((entry, i) => ({ n: i + 1, source: entry.source }));
  if (references.length > 0) {
    blocks.push("## References");
    blocks.push(references.map((r) => referenceLine(r.n, r.source)).join("\n"));
  }
  return { sections, references, markdown: blocks.join("\n\n") + "\n" };
}

/** A numbered reference list: `1. <title>, <byline>. <url>`, one per line. */
export function buildReferenceList(sources: readonly CopySource[]): string {
  if (sources.length === 0) return "";
  return sources.map((s, i) => referenceLine(i + 1, s)).join("\n") + "\n";
}

/**
 * The b-roll list as Markdown, clips in the order given:
 *
 * ```markdown
 * # B-roll: <Project>
 *
 * 1. <what it shows>. <title>, <byline>, [1:05–1:20](https://youtu.be/<id>?t=65). Note: <note>
 * ```
 */
export function buildBrollList(
  projectTitle: string,
  clips: readonly Card[],
  sources: SourceDirectory,
): string {
  const lines = clips.map((clip, i) => {
    const source =
      (clip.item_id ? sources[clip.item_id] : undefined) ??
      (clip.url ? linkOnlySource(clip.url) : null);
    const what = collapse(clip.script_line ?? "") || collapse(clip.quote) || "Clip";
    const parts = [`${i + 1}. ${what.replace(/[.]$/, "")}.`];
    const where: string[] = source ? [describe(source)] : [];
    const time = formatClipTime(clip.seconds, clip.end_seconds);
    const link = cardLink(clip, source);
    if (time && link) where.push(`[${time}](${link})`);
    else if (time) where.push(time);
    else if (link) where.push(link);
    if (where.length > 0) parts.push(`${where.join(", ")}.`);
    const note = collapse(clip.note ?? "");
    if (note) parts.push(`Note: ${note}`);
    return parts.join(" ");
  });
  const title = `# B-roll: ${collapse(projectTitle) || "Untitled"}`;
  return lines.length > 0 ? `${title}\n\n${lines.join("\n")}\n` : `${title}\n`;
}

/** B-roll clips in list order: by section order and position, clips not placed last. */
export function orderBrollClips(
  cards: readonly Card[],
  sections: readonly OutlineSection[],
): Card[] {
  const sectionRank = new Map(sortSections(sections).map((s, i) => [s.id, i]));
  const clips = cards.filter((c) => c.kind === "broll");
  const rank = (c: Card) =>
    c.section_id !== null && sectionRank.has(c.section_id)
      ? sectionRank.get(c.section_id)!
      : Number.MAX_SAFE_INTEGER;
  return [...clips].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === Number.MAX_SAFE_INTEGER ? 0 : a.position - b.position) ||
      cmp(a.created_at, b.created_at) ||
      cmp(a.id, b.id),
  );
}

// ---------------------------------------------------------------------------------------------
// Duplicates inside a project

export type DuplicateReason = "same_link" | "same_video" | "same_paper" | "same_title";

export const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  same_link: "Same link",
  same_video: "Same video",
  same_paper: "Same paper",
  same_title: "Same title",
};

export interface DuplicateSet {
  /** The strongest reason that joins them (link, then video, then paper, then title). */
  reason: DuplicateReason;
  /** Oldest first. */
  item_ids: string[];
}

interface DuplicateCandidate {
  id: string;
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

const REASON_RANK: Record<DuplicateReason, number> = {
  same_link: 0,
  same_video: 1,
  same_paper: 2,
  same_title: 3,
};

/** Title compared without case, punctuation, spacing or a trailing " - YouTube"-style site name. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+[-–—|]\s+(youtube|wikipedia|grokipedia|reddit|substack|x)$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const MIN_TITLE_KEY = 16;

function linkKey(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Finds sources saved more than once in one project: the same link, the same YouTube video,
 * the same arXiv paper, or the same title (not for X and Bluesky posts). Notes and images never
 * count.
 * Each item is in at most one set; sets are ordered by their oldest item.
 */
export function findDuplicateSets(items: readonly DuplicateCandidate[]): DuplicateSet[] {
  const live = items.filter((i) => i.kind !== "note" && i.kind !== "image");
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const item of live) parent.set(item.id, item.id);

  // Every pair joined, with the reason, so a set can report its strongest one.
  const joins: { a: string; b: string; reason: DuplicateReason }[] = [];
  const index = (reason: DuplicateReason, keyOf: (i: DuplicateCandidate) => string | null) => {
    const firstByKey = new Map<string, string>();
    for (const item of live) {
      const key = keyOf(item);
      if (!key) continue;
      const first = firstByKey.get(key);
      if (first === undefined) firstByKey.set(key, item.id);
      else joins.push({ a: first, b: item.id, reason });
    }
  };
  index("same_link", (i) => linkKey(itemUrl(i)));
  index("same_video", (i) => {
    const id = youtubeVideoId(itemUrl(i));
    return id ? `yt:${id}` : null;
  });
  index("same_paper", (i) => {
    const fromMeta = str((i.meta ?? {}).arxiv);
    const id = fromMeta ?? parseArxivLink(itemUrl(i) ?? "")?.id ?? null;
    return id ? `arxiv:${id}` : null;
  });
  index("same_title", (i) => {
    // Post titles are "Thread by <name>", the same for every thread by one person.
    if (i.kind === "x" || i.kind === "bluesky") return null;
    const key = titleKey(i.title);
    return key.length >= MIN_TITLE_KEY ? `title:${key}` : null;
  });

  for (const { a, b } of joins) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const byRoot = new Map<string, DuplicateCandidate[]>();
  for (const item of live) {
    const root = find(item.id);
    const list = byRoot.get(root) ?? [];
    list.push(item);
    byRoot.set(root, list);
  }
  const best = new Map<string, DuplicateReason>();
  for (const { a, reason } of joins) {
    const root = find(a);
    const known = best.get(root);
    if (!known || REASON_RANK[reason] < REASON_RANK[known]) best.set(root, reason);
  }

  const sets: DuplicateSet[] = [];
  for (const [root, list] of byRoot) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((x, y) => cmp(x.created_at, y.created_at) || cmp(x.id, y.id));
    sets.push({ reason: best.get(root) ?? "same_title", item_ids: sorted.map((i) => i.id) });
  }
  const created = new Map(live.map((i) => [i.id, i.created_at]));
  return sets.sort((x, y) =>
    cmp(created.get(x.item_ids[0]!) ?? "", created.get(y.item_ids[0]!) ?? ""),
  );
}
