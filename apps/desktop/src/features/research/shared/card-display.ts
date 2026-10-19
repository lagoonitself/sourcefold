import { cardLink, formatClipTime, scriptLineText, type Card } from "@sourcefold/core";
import type { Item } from "@/lib/types";
import { sourceTitleFor } from "../project-data/project-data-model";

/** "3:12", or "1:05–1:20" for a clip with an end; null without a time. */
export function cardTimeText(card: Pick<Card, "kind" | "seconds" | "end_seconds">): string | null {
  return formatClipTime(card.seconds, card.kind === "broll" ? card.end_seconds : null);
}

/** Where a card comes from, as it reads under the quote: "Engineering Explained, 3:12". */
export function cardSourceLine(card: Card, itemsById: ReadonlyMap<string, Item>): string {
  if (card.kind === "line") return "Your line";
  const title = sourceTitleFor(card, itemsById) ?? "Source removed";
  const time = cardTimeText(card);
  return time ? `${title}, ${time}` : title;
}

/** What a card says: its quote, or what a clip shows, or the line itself. */
export function cardBodyText(card: Card): string {
  if (card.kind === "line") return (card.script_line ?? "").trim();
  return card.quote.trim() || (card.script_line ?? "").trim();
}

/** The link a card opens in the browser (the video at its time), or null. */
export function cardOpenUrl(card: Card, itemsById: ReadonlyMap<string, Item>): string | null {
  const item = card.item_id ? itemsById.get(card.item_id) : undefined;
  const source = item ? { url: item.canonical_url ?? item.source_url ?? null } : null;
  return cardLink(card, source);
}

/** The text shown for a card in the script (its own line, or the quote in quotation marks). */
export function cardScriptText(card: Card): string {
  return scriptLineText(card);
}
