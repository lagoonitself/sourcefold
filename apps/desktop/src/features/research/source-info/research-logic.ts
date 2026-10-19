// Pure logic behind status marks, tags, authors and summaries on sources (docs/dev/handoff-research.md).
import {
  AUTHOR_TYPE_LABELS,
  RESEARCH_LIMITS,
  effectiveAuthorType,
  normalizeTags,
  sameTag,
  sortSections,
  sourceAuthor,
  type AuthorType,
  type ItemResearchFields,
  type ItemResearchPatch,
  type OutlineSection,
  type Triage,
} from "@sourcefold/core";
import type { Folder } from "@/lib/types";

/** What the research UI needs of a source; `Item` and the reader's item both fit. */
export interface ResearchItem {
  id: string;
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  meta?: Record<string, any> | null;
  triage?: Triage | null;
  tags?: string[];
  summary?: string | null;
  author?: string | null;
  author_type?: AuthorType | null;
}

// ---- Project of a group -------------------------------------------------------------------------

/** The top-level folder (project) a group sits in; null when the chain is broken. */
export function projectIdOf(folders: readonly Folder[], folderId: string | null | undefined) {
  if (!folderId) return null;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId);
  for (let depth = 0; current && depth < 1000; depth++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return null;
}

// ---- Filtering a group's sources ---------------------------------------------------------------

export type StatusFilter = "all" | Triage | "none";

export const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "keep", label: "Keep" },
  { id: "maybe", label: "Maybe" },
  { id: "cut", label: "Cut" },
  { id: "none", label: "No status" },
];

export interface ListFilter {
  status: StatusFilter;
  /** A tag the sources must carry; null for any. */
  tag: string | null;
}

export const NO_FILTER: ListFilter = { status: "all", tag: null };

export function isFiltering(filter: ListFilter): boolean {
  return filter.status !== "all" || filter.tag !== null;
}

export function hasTag(item: Pick<ResearchItem, "tags">, tag: string): boolean {
  return (item.tags ?? []).some((t) => sameTag(t, tag));
}

export function filterItems<T extends ResearchItem>(items: readonly T[], filter: ListFilter): T[] {
  return items.filter((item) => {
    if (filter.status === "none" && item.triage) return false;
    if (filter.status !== "all" && filter.status !== "none" && item.triage !== filter.status) {
      return false;
    }
    if (filter.tag !== null && !hasTag(item, filter.tag)) return false;
    return true;
  });
}

/** The tags used in a group, with how many sources carry each; most used first, then A to Z. */
export function groupTags(
  items: ReadonlyArray<Pick<ResearchItem, "tags">>,
): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const item of items) {
    for (const tag of item.tags ?? []) {
      const key = tag.toLowerCase();
      const known = counts.get(key);
      if (known) known.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
  );
}

/** A remembered filter whose tag has since left the group stops filtering by that tag. */
export function resolveFilter(
  filter: ListFilter,
  tags: ReadonlyArray<{ tag: string }>,
): ListFilter {
  if (filter.tag === null) return filter;
  const tag = filter.tag;
  return tags.some((t) => sameTag(t.tag, tag)) ? filter : { ...filter, tag: null };
}

// ---- Tags ---------------------------------------------------------------------------------------

export interface TagSuggestion {
  tag: string;
  /** An outline section's title, or a tag already used in the project. */
  kind: "section" | "project";
}

/** Tags in use across a project's sources, most used first, then A to Z. */
export function projectTagsByUse(items: ReadonlyArray<Pick<ResearchItem, "tags">>): string[] {
  return groupTags(items).map((t) => t.tag);
}

function rankMatches(list: TagSuggestion[], needle: string): TagSuggestion[] {
  if (!needle) return list;
  const lower = needle.toLowerCase();
  const prefix = list.filter((s) => s.tag.toLowerCase().startsWith(lower));
  const inside = list.filter(
    (s) => !s.tag.toLowerCase().startsWith(lower) && s.tag.toLowerCase().includes(lower),
  );
  return [...prefix, ...inside];
}

/**
 * Suggestions for the tag field: the project's outline section titles first, then the tags
 * already used in the project, each in its own order (sections as in the outline, tags by use).
 * Tags the source already has are left out, and a section title wins over the same tag.
 * `query` narrows the list (names starting with it come before names containing it).
 */
export function tagSuggestions(input: {
  sections: ReadonlyArray<Pick<OutlineSection, "id" | "title" | "position">>;
  projectTags: readonly string[];
  current: readonly string[];
  query?: string;
}): TagSuggestion[] {
  const taken = (tag: string) => input.current.some((c) => sameTag(c, tag));
  const out: TagSuggestion[] = [];
  const seen = new Set<string>();
  const push = (tag: string, kind: TagSuggestion["kind"]) => {
    const clean = normalizeTags([tag])[0];
    if (!clean || taken(clean) || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    out.push({ tag: clean, kind });
  };
  for (const s of sortSections(input.sections)) push(s.title, "section");
  for (const tag of input.projectTags) push(tag, "project");
  const needle = normalizeTags([input.query ?? ""])[0] ?? "";
  const sections = rankMatches(
    out.filter((s) => s.kind === "section"),
    needle,
  );
  const tags = rankMatches(
    out.filter((s) => s.kind === "project"),
    needle,
  );
  return [...sections, ...tags];
}

export type TagChange = { ok: true; tags: string[] } | { ok: false; reason: string };

/** Adds a tag (trimmed, case-insensitively unique); refuses past the 20-tag limit. */
export function addTag(tags: readonly string[], raw: string): TagChange {
  const next = normalizeTags([...tags, raw]);
  if (next.length > RESEARCH_LIMITS.tags) {
    return { ok: false, reason: `A source can have ${RESEARCH_LIMITS.tags} tags at most.` };
  }
  return { ok: true, tags: next };
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => !sameTag(t, tag));
}

/** The tags every one of `items` carries (in the first item's order). */
export function commonTags(items: ReadonlyArray<Pick<ResearchItem, "tags">>): string[] {
  if (items.length === 0) return [];
  const [first, ...rest] = items;
  return (first.tags ?? []).filter((tag) => rest.every((item) => hasTag(item, tag)));
}

// ---- Patches ------------------------------------------------------------------------------------

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function emptyToNull(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t ? t : null;
}

/** What the source holds now for each field of a patch. */
export function currentResearch(item: ResearchItem): ItemResearchFields {
  return {
    triage: item.triage ?? null,
    tags: item.tags ?? [],
    summary: emptyToNull(item.summary),
    author: emptyToNull(item.author),
    author_type: item.author_type ?? null,
  };
}

/** Keeps only the keys of `patch` that would change `item`; null when nothing would. */
export function effectivePatch(
  item: ResearchItem,
  patch: ItemResearchPatch,
): ItemResearchPatch | null {
  const now = currentResearch(item);
  const out: ItemResearchPatch = {};
  if (patch.triage !== undefined && patch.triage !== now.triage) out.triage = patch.triage;
  if (patch.tags !== undefined && !sameList(patch.tags, now.tags)) out.tags = patch.tags;
  if (patch.summary !== undefined && emptyToNull(patch.summary) !== now.summary) {
    out.summary = emptyToNull(patch.summary);
  }
  if (patch.author !== undefined && emptyToNull(patch.author) !== now.author) {
    out.author = emptyToNull(patch.author);
  }
  if (patch.author_type !== undefined && patch.author_type !== now.author_type) {
    out.author_type = patch.author_type;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The research fields of `item` for the keys of `patch` (to roll a failed change back). */
export function researchBefore(item: ResearchItem, patch: ItemResearchPatch): ItemResearchPatch {
  const now = currentResearch(item);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof ItemResearchFields>) out[key] = now[key];
  return out as ItemResearchPatch;
}

export function applyResearch<T extends ResearchItem>(item: T, patch: ItemResearchPatch): T {
  return { ...item, ...patch };
}

// ---- Row text -----------------------------------------------------------------------------------

/** "Lab", or "Lab (guess)" when no one set it; null when there is nothing to show. */
export function authorTypeText(item: ResearchItem): string | null {
  const { type, guessed } = effectiveAuthorType(item);
  if (!type) return null;
  return guessed ? `${AUTHOR_TYPE_LABELS[type]} (guess)` : AUTHOR_TYPE_LABELS[type];
}

/** The byline captured with the source, ignoring an author someone set. */
export function capturedAuthor(item: ResearchItem): string | null {
  return sourceAuthor({ ...item, author: null });
}

/**
 * The muted line under a row's title: the author, the author type, then what the row already
 * showed ("Epoch AI, Lab, 12:03"). Notes and images keep their line as it is.
 */
export function researchMetaLine(item: ResearchItem, baseLine: string | null): string | null {
  if (item.kind === "note" || item.kind === "image") return baseLine;
  const author = sourceAuthor(item);
  const typeText = authorTypeText(item);
  if (!author && !typeText) return baseLine;
  const rest = (baseLine ?? "")
    .split(", ")
    .map((part) => part.trim())
    .filter((part) => part && (!author || part !== author));
  const parts = [author, typeText, ...rest].filter((p): p is string => Boolean(p));
  return parts.join(", ");
}

/** The tags a row shows, and how many more there are. */
export function visibleTags(
  tags: readonly string[] | undefined,
  max = 2,
): { shown: string[]; more: number } {
  const list = tags ?? [];
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}
