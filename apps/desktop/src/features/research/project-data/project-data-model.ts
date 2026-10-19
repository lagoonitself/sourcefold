import {
  findDuplicateSets,
  normalizeTags,
  sameTag,
  scriptSourceFromItem,
  sortCards,
  type Card,
  type CardPatch,
  type OutlineSection,
  type SourceDirectory,
} from "@sourcefold/core";
import type { Item } from "@/lib/types";

/** Everything the project views read: the project's cards, sections and live sources. */
export interface ProjectDataState {
  cards: Card[];
  sections: OutlineSection[];
  items: Item[];
}

export const EMPTY_PROJECT_DATA: ProjectDataState = { cards: [], sections: [], items: [] };

/** Source facts for the script, reference and b-roll exports, by item id. */
export function buildSourceDirectory(items: readonly Item[]): SourceDirectory {
  const directory: SourceDirectory = {};
  for (const item of items) directory[item.id] = scriptSourceFromItem(item);
  return directory;
}

export interface ProjectViewCounts {
  /** Cards in the project (the card pile and the sections). */
  outline: number;
  /** B-roll clips. */
  broll: number;
  /** Groups of sources saved more than once. */
  duplicates: number;
}

export function projectViewCounts(
  cards: readonly Card[],
  items: readonly Item[],
): ProjectViewCounts {
  return {
    outline: cards.length,
    broll: cards.filter((c) => c.kind === "broll").length,
    duplicates: findDuplicateSets(items).length,
  };
}

/** The cards with one card's fields changed. */
export function applyCardPatch(cards: readonly Card[], id: string, patch: CardPatch): Card[] {
  return cards.map((card) => (card.id === id ? { ...card, ...patch } : card));
}

/** Only the fields `patch` changes, as they are on `card` (to put them back after a failed write). */
export function revertPatch(card: Card, patch: CardPatch): CardPatch {
  const back: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof CardPatch)[]) back[key] = card[key];
  return back as CardPatch;
}

/** Deleting a section sends its cards back to the card pile. */
export function releaseSectionCards(cards: readonly Card[], sectionId: string): Card[] {
  return cards.map((card) =>
    card.section_id === sectionId ? { ...card, section_id: null } : card,
  );
}

/**
 * What the server does when a section is renamed: every source tagged with the old title gets the
 * new one in the same place in its list (and no repeat when it already had the new one).
 */
export function renameTagOnItems(
  items: readonly Item[],
  oldTitle: string,
  newTitle: string,
): Item[] {
  return items.map((item) => {
    const tags = item.tags ?? [];
    if (!tags.some((t) => sameTag(t, oldTitle))) return item;
    return { ...item, tags: normalizeTags(tags.map((t) => (sameTag(t, oldTitle) ? newTitle : t))) };
  });
}

/** The sources of the project that carry a tag (compared without case or extra spaces). */
export function sourcesWithTag(items: readonly Item[], tag: string): Item[] {
  return items.filter((item) => (item.tags ?? []).some((t) => sameTag(t, tag)));
}

/** How many sources carry each section's title as a tag, by section id. */
export function taggedCounts(
  sections: readonly OutlineSection[],
  items: readonly Item[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const section of sections) counts[section.id] = sourcesWithTag(items, section.title).length;
  return counts;
}

/** The title of the source a card comes from (a link host for a clip with only a link), if any. */
export function sourceTitleFor(
  card: Pick<Card, "item_id" | "url">,
  itemsById: ReadonlyMap<string, Item>,
): string | null {
  if (card.item_id) {
    const item = itemsById.get(card.item_id);
    return item ? item.title : null;
  }
  if (card.url) {
    try {
      return new URL(card.url).hostname.replace(/^www\./, "");
    } catch {
      return card.url;
    }
  }
  return null;
}

/** Cards of one container (a section, or the card pile when null), in order. */
export function cardsIn(cards: readonly Card[], sectionId: string | null): Card[] {
  return sortCards(cards.filter((c) => c.section_id === sectionId));
}
