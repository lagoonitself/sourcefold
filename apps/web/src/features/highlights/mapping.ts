import type { Highlight, HighlightCitation, HighlightInput } from "@sourcefold/core";
import type { Json, Tables } from "@/lib/database.types";

export const HIGHLIGHT_COLUMNS =
  "id, item_id, kind, quote, prefix, suffix, start_offset, end_offset, image_src, note, seconds, cited, created_at, updated_at" as const;

export type HighlightRow = Pick<
  Tables<"highlights">,
  | "id"
  | "item_id"
  | "kind"
  | "quote"
  | "prefix"
  | "suffix"
  | "start_offset"
  | "end_offset"
  | "image_src"
  | "note"
  | "seconds"
  | "cited"
  | "created_at"
  | "updated_at"
>;

function citedFromJson(value: Json): HighlightCitation[] {
  if (!Array.isArray(value)) return [];
  const out: HighlightCitation[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { n, title, url } = entry;
    if (typeof url !== "string") continue;
    out.push({
      n: typeof n === "string" ? n : "",
      title: typeof title === "string" ? title : null,
      url,
    });
  }
  return out;
}

export function rowToHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    item_id: row.item_id,
    kind: row.kind === "image" ? "image" : "text",
    quote: row.quote,
    prefix: row.prefix,
    suffix: row.suffix,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    image_src: row.image_src,
    note: row.note,
    seconds: row.seconds,
    cited: citedFromJson(row.cited),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Columns written on create and replace (never the timestamps or the owner). */
export function inputToRow(input: HighlightInput) {
  return {
    item_id: input.item_id,
    kind: input.kind,
    quote: input.quote,
    prefix: input.prefix,
    suffix: input.suffix,
    start_offset: input.start_offset,
    end_offset: input.end_offset,
    image_src: input.image_src,
    note: input.note,
    seconds: input.seconds,
    cited: input.cited as unknown as Json,
  };
}
