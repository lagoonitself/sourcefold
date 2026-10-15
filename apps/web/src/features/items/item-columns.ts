import type { Tables } from "@/lib/database.types";

export const ITEM_LIST_COLUMNS =
  "id, folder_id, kind, title, source_url, canonical_url, status, error, meta, position, created_at, note" as const;

export type ItemListRow = Pick<
  Tables<"items">,
  | "id"
  | "folder_id"
  | "kind"
  | "title"
  | "source_url"
  | "canonical_url"
  | "status"
  | "error"
  | "meta"
  | "position"
  | "created_at"
  | "note"
>;
