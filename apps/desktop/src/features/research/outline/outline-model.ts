import {
  SECTION_TITLE_MAX,
  positionBetween,
  sortSections,
  type Card,
  type CardPatch,
  type OutlineSection,
} from "@sourcefold/core";
import { cardsIn } from "../project-data/project-data-model";

// ---------------------------------------------------------------------------------------------
// Outline section validation and normalization

export type NormalizeSectionTitleResult =
  { ok: true; title: string } | { ok: false; error: string };

/**
 * Validates and normalizes an outline section title:
 * collapses whitespace, trims, and checks that length is between 1 and SECTION_TITLE_MAX characters.
 */
export function normalizeSectionTitle(raw: string): NormalizeSectionTitleResult {
  const title = raw.replace(/\s+/g, " ").trim();
  if (!title) {
    return { ok: false, error: "Section title can't be empty." };
  }
  if (title.length > SECTION_TITLE_MAX) {
    return { ok: false, error: `Section title must be ${SECTION_TITLE_MAX} characters or fewer.` };
  }
  return { ok: true, title };
}

// ---------------------------------------------------------------------------------------------
// The card pile's filters

/** `all`: every card; `none`: cards with no source (lines); otherwise one source's item id. */
export interface PileFilter {
  source: string;
  text: string;
}

export const NO_PILE_FILTER: PileFilter = { source: "all", text: "" };
export const PILE_NO_SOURCE = "none";

export function pileFilterActive(filter: PileFilter): boolean {
  return filter.source !== "all" || filter.text.trim() !== "";
}

/** Everything a card shows, lower case, for the text filter. */
function haystack(card: Card, sourceTitle: string | null): string {
  return [card.quote, card.script_line, card.note, sourceTitle]
    .filter((part): part is string => Boolean(part))
    .join("\n")
    .toLowerCase();
}

/** The pile's cards that pass the source filter and contain every word of the text filter. */
export function filterPile(
  pile: readonly Card[],
  filter: PileFilter,
  sourceTitleOf: (card: Card) => string | null,
): Card[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return pile.filter((card) => {
    if (filter.source === PILE_NO_SOURCE) {
      if (card.item_id !== null || card.url !== null) return false;
    } else if (filter.source !== "all" && card.item_id !== filter.source) {
      return false;
    }
    if (words.length === 0) return true;
    const text = haystack(card, sourceTitleOf(card));
    return words.every((word) => text.includes(word));
  });
}

export interface PileSourceOption {
  /** An item id, or `PILE_NO_SOURCE`. */
  id: string;
  title: string;
  count: number;
}

/** The sources with cards waiting in the pile, by title, for the source filter's menu. */
export function pileSourceOptions(
  pile: readonly Card[],
  sourceTitleOf: (card: Card) => string | null,
): PileSourceOption[] {
  const byId = new Map<string, PileSourceOption>();
  for (const card of pile) {
    const id = card.item_id ?? (card.url === null ? PILE_NO_SOURCE : null);
    if (id === null) continue;
    const known = byId.get(id);
    if (known) known.count += 1;
    else
      byId.set(id, {
        id,
        title:
          id === PILE_NO_SOURCE ? "Lines (no source)" : (sourceTitleOf(card) ?? "Removed source"),
        count: 1,
      });
  }
  return [...byId.values()].sort(
    (a, b) =>
      Number(a.id === PILE_NO_SOURCE) - Number(b.id === PILE_NO_SOURCE) ||
      a.title.localeCompare(b.title),
  );
}

// ---------------------------------------------------------------------------------------------
// Drag and drop

/** Where a dragged card was dropped: on another card (before or after it) or on a whole list. */
export type CardDropTarget =
  { type: "card"; id: string; after: boolean } | { type: "container"; sectionId: string | null };

/**
 * True when the dragged item's centre is below the centre of the one it is over, so it goes after
 * it. Both are `{ top, height }` rectangles in the same coordinates.
 */
export function dropIsAfter(
  dragged: { top: number; height: number },
  over: { top: number; height: number },
): boolean {
  return dragged.top + dragged.height / 2 > over.top + over.height / 2;
}

/**
 * The section and position a dragged card gets, from the cards around the drop. Null when the card
 * would end up where it already is.
 */
export function computeCardDrop(
  cards: readonly Card[],
  activeId: string,
  target: CardDropTarget,
): CardPatch | null {
  const active = cards.find((c) => c.id === activeId);
  if (!active) return null;

  let sectionId: string | null;
  let list: Card[];
  let insertIndex: number;
  if (target.type === "container") {
    sectionId = target.sectionId;
    list = cardsIn(cards, sectionId).filter((c) => c.id !== activeId);
    insertIndex = list.length;
  } else {
    const over = cards.find((c) => c.id === target.id);
    if (!over || over.id === activeId) return null;
    sectionId = over.section_id;
    list = cardsIn(cards, sectionId).filter((c) => c.id !== activeId);
    const overIndex = list.findIndex((c) => c.id === over.id);
    insertIndex = target.after ? overIndex + 1 : overIndex;
  }

  const position = positionBetween(
    list[insertIndex - 1]?.position ?? null,
    list[insertIndex]?.position ?? null,
  );

  if (sectionId === active.section_id) {
    const before = cardsIn(cards, sectionId).map((c) => c.id);
    const after = [...list.slice(0, insertIndex), active, ...list.slice(insertIndex)].map(
      (c) => c.id,
    );
    if (before.length === after.length && before.every((id, i) => id === after[i])) return null;
  }
  return { section_id: sectionId, position };
}

/** The position a dragged section gets when dropped on another section; null when unchanged. */
export function computeSectionDrop(
  sections: readonly OutlineSection[],
  activeId: string,
  overId: string,
  after: boolean,
): number | null {
  const sorted = sortSections(sections);
  const active = sorted.find((s) => s.id === activeId);
  if (!active || activeId === overId) return null;
  const list = sorted.filter((s) => s.id !== activeId);
  const overIndex = list.findIndex((s) => s.id === overId);
  if (overIndex === -1) return null;
  const insertIndex = after ? overIndex + 1 : overIndex;
  const before = sorted.map((s) => s.id);
  const next = [...list.slice(0, insertIndex), active, ...list.slice(insertIndex)].map((s) => s.id);
  if (before.every((id, i) => id === next[i])) return null;
  return positionBetween(
    list[insertIndex - 1]?.position ?? null,
    list[insertIndex]?.position ?? null,
  );
}

// ---------------------------------------------------------------------------------------------
// Keyboard

/** Alt+Up / Alt+Down on a card: one place up or down; past the end of a section it crosses over. */
export function moveCardByKey(
  cards: readonly Card[],
  sections: readonly OutlineSection[],
  cardId: string,
  direction: "up" | "down",
): CardPatch | null {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return null;
  const list = cardsIn(cards, card.section_id);
  const index = list.findIndex((c) => c.id === cardId);
  if (index === -1) return null;

  if (direction === "up") {
    if (index > 0) {
      return {
        section_id: card.section_id,
        position: positionBetween(list[index - 2]?.position ?? null, list[index - 1].position),
      };
    }
    const order = sortSections(sections);
    const sectionIndex = order.findIndex((s) => s.id === card.section_id);
    if (card.section_id === null || sectionIndex <= 0) return null;
    const previous = order[sectionIndex - 1];
    const last = cardsIn(cards, previous.id).at(-1);
    return { section_id: previous.id, position: positionBetween(last?.position ?? null, null) };
  }

  if (index < list.length - 1) {
    return {
      section_id: card.section_id,
      position: positionBetween(list[index + 1].position, list[index + 2]?.position ?? null),
    };
  }
  const order = sortSections(sections);
  const sectionIndex = order.findIndex((s) => s.id === card.section_id);
  if (card.section_id === null || sectionIndex === -1 || sectionIndex >= order.length - 1) {
    return null;
  }
  const next = order[sectionIndex + 1];
  const first = cardsIn(cards, next.id)[0];
  return { section_id: next.id, position: positionBetween(null, first?.position ?? null) };
}

/** Alt+Up / Alt+Down on a section header: its new position, or null at the first or last place. */
export function moveSectionByKey(
  sections: readonly OutlineSection[],
  sectionId: string,
  direction: "up" | "down",
): number | null {
  const list = sortSections(sections);
  const index = list.findIndex((s) => s.id === sectionId);
  if (index === -1) return null;
  if (direction === "up") {
    if (index === 0) return null;
    return positionBetween(list[index - 2]?.position ?? null, list[index - 1].position);
  }
  if (index === list.length - 1) return null;
  return positionBetween(list[index + 1].position, list[index + 2]?.position ?? null);
}

export interface FocusTarget {
  kind: "card" | "section";
  id: string;
}

/** What `j` and `k` walk through: the pile's cards, then each section's header and its cards. */
export function focusOrder(
  pile: readonly Card[],
  sections: readonly OutlineSection[],
  cards: readonly Card[],
): FocusTarget[] {
  const order: FocusTarget[] = pile.map((c) => ({ kind: "card", id: c.id }));
  for (const section of sortSections(sections)) {
    order.push({ kind: "section", id: section.id });
    for (const card of cardsIn(cards, section.id)) order.push({ kind: "card", id: card.id });
  }
  return order;
}

/** The one to focus after `id` goes away: the next in line, else the one before it. */
export function focusAfterRemoval(order: readonly FocusTarget[], id: string): FocusTarget | null {
  const index = order.findIndex((t) => t.id === id);
  if (index === -1) return null;
  return order[index + 1] ?? order[index - 1] ?? null;
}

/** The target `step` places from the current one (clamped); the first when nothing is focused. */
export function stepFocus(
  order: readonly FocusTarget[],
  currentId: string | null,
  step: 1 | -1,
): FocusTarget | null {
  if (order.length === 0) return null;
  const index = order.findIndex((t) => t.id === currentId);
  if (index === -1) return order[0];
  return order[Math.max(0, Math.min(order.length - 1, index + step))];
}
