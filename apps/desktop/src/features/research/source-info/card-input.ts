// Turning a highlight into a card (docs/dev/handoff-research.md, "Cards from highlights").
import {
  CARD_LIMITS,
  cardProblem,
  positionBetween,
  type Card,
  type CardInput,
  type Highlight,
} from "@sourcefold/core";
import type { TimestampMark } from "@sourcefold/core/reader";

type PileCard = Pick<Card, "section_id" | "position">;

/** The position that puts a new card after the last card of the pile (cards not in a section). */
export function nextPilePosition(cards: readonly PileCard[], floor: number | null = null): number {
  let last: number | null = floor;
  for (const card of cards) {
    if (card.section_id !== null) continue;
    if (last === null || card.position > last) last = card.position;
  }
  return positionBetween(last, null);
}

/**
 * Where the next transcript paragraph starts: the first timestamp at or after the end of the
 * highlight that is later than where the highlight starts. Null when no paragraph follows.
 */
export function nextParagraphSeconds(
  marks: ReadonlyArray<TimestampMark>,
  endOffset: number,
  startSeconds: number,
): number | null {
  let best: TimestampMark | null = null;
  for (const mark of marks) {
    if (mark.offset < endOffset || mark.seconds <= startSeconds) continue;
    if (best === null || mark.offset < best.offset) best = mark;
  }
  return best ? best.seconds : null;
}

interface CardSource {
  highlight: Pick<Highlight, "id" | "item_id" | "quote" | "seconds">;
  projectId: string;
  /** A new uuid. */
  id: string;
  position: number;
}

function checked(card: CardInput): CardInput | null {
  return cardProblem(card) === null ? card : null;
}

/** A `quote` card with the highlight's passage and time; null when the highlight has no text. */
export function buildQuoteCard({
  highlight,
  projectId,
  id,
  position,
}: CardSource): CardInput | null {
  return checked({
    id,
    project_id: projectId,
    kind: "quote",
    item_id: highlight.item_id,
    highlight_id: highlight.id,
    quote: highlight.quote.slice(0, CARD_LIMITS.quote),
    seconds: highlight.seconds,
    end_seconds: null,
    url: null,
    note: null,
    script_line: null,
    section_id: null,
    position,
  });
}

/**
 * A `broll` card for a moment of a video transcript: the highlight's text as what the clip
 * shows, its time as the start, and the next paragraph's start (when there is one) as the end.
 * Null without a start time.
 */
export function buildBrollCard(
  source: CardSource & { endSeconds: number | null },
): CardInput | null {
  const { highlight, projectId, id, position, endSeconds } = source;
  if (highlight.seconds === null) return null;
  return checked({
    id,
    project_id: projectId,
    kind: "broll",
    item_id: highlight.item_id,
    highlight_id: highlight.id,
    quote: highlight.quote.slice(0, CARD_LIMITS.quote),
    seconds: highlight.seconds,
    end_seconds: endSeconds !== null && endSeconds >= highlight.seconds ? endSeconds : null,
    url: null,
    note: null,
    script_line: null,
    section_id: null,
    position,
  });
}

/** The highlights that already have a card (the highlights panel marks them). */
export function highlightIdsWithCards(
  cards: ReadonlyArray<Pick<Card, "highlight_id">>,
): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) if (card.highlight_id) ids.add(card.highlight_id);
  return ids;
}
