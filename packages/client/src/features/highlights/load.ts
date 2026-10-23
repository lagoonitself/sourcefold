import type { SupabaseClient } from "@supabase/supabase-js";
import type { Highlight } from "@sourcefold/core";
import type { Database } from "../../database.types";
import { HIGHLIGHT_COLUMNS, rowToHighlight, type HighlightRow } from "./mapping";

const ID_CHUNK = 100;
const PAGE_SIZE = 1000;

/**
 * The user's highlights for these items, grouped by item, each list ordered by start_offset, then
 * created_at. One query per chunk of ids (not per item). Filters by user_id because the callers
 * use the admin client.
 */
export async function loadHighlightsForItems(
  db: SupabaseClient<Database>,
  userId: string,
  itemIds: string[],
): Promise<Map<string, Highlight[]>> {
  const byItem = new Map<string, Highlight[]>();
  const unique = [...new Set(itemIds)];

  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const chunk = unique.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from("highlights")
        .select(HIGHLIGHT_COLUMNS)
        .eq("user_id", userId)
        .in("item_id", chunk)
        .order("item_id", { ascending: true })
        .order("start_offset", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as HighlightRow[];
      for (const row of rows) {
        const list = byItem.get(row.item_id) ?? [];
        list.push(rowToHighlight(row));
        byItem.set(row.item_id, list);
      }
      if (rows.length < PAGE_SIZE) break;
    }
  }

  return byItem;
}
