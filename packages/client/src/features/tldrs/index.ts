// TL;DRs of saved sources (docs/dev/PLAN-tldr.md): request checks, row mapping and loading.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { normalizeTldr, TLDR_LIMITS, type ItemTldr } from "@sourcefold/core";
import type { Database } from "../../database.types";

export const TLDR_COLUMNS =
  "item_id, tldr, source, model, body_hash, created_at, updated_at" as const;

export interface TldrRow {
  item_id: string;
  tldr: unknown;
  source: string;
  model: string | null;
  body_hash: string | null;
  created_at: string;
  updated_at: string;
}

export const tldrInputSchema = z.object({
  tldr: z.unknown().transform((value, ctx) => {
    const tldr = normalizeTldr(value);
    if (!tldr) {
      ctx.addIssue({ code: "custom", message: "A TL;DR needs a gist." });
      return z.NEVER;
    }
    return tldr;
  }),
  source: z.enum(["article", "ai"], { message: "Source must be article or ai." }),
  model: z
    .string()
    .trim()
    .max(TLDR_LIMITS.model, `Model must be at most ${TLDR_LIMITS.model} characters.`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
  body_hash: z
    .string()
    .max(TLDR_LIMITS.bodyHash, "Invalid body hash.")
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
});

/** A row as the API answers it; a row whose JSON no longer reads as a TL;DR is dropped. */
export function rowToTldr(row: TldrRow): ItemTldr | null {
  const tldr = normalizeTldr(row.tldr);
  if (!tldr || (row.source !== "article" && row.source !== "ai")) return null;
  return {
    item_id: row.item_id,
    tldr,
    source: row.source,
    model: row.model,
    body_hash: row.body_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ID_CHUNK = 100;

/** The user's TL;DRs for these items, in the order of `itemIds`. */
export async function loadTldrsForItems(
  db: SupabaseClient<Database>,
  userId: string,
  itemIds: string[],
): Promise<ItemTldr[]> {
  const byId = new Map<string, ItemTldr>();
  for (let i = 0; i < itemIds.length; i += ID_CHUNK) {
    const chunk = itemIds.slice(i, i + ID_CHUNK);
    const { data, error } = await db
      .from("item_tldrs")
      .select(TLDR_COLUMNS)
      .eq("user_id", userId)
      .in("item_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as TldrRow[]) {
      const tldr = rowToTldr(row);
      if (tldr) byId.set(tldr.item_id, tldr);
    }
  }
  return itemIds.flatMap((id) => {
    const tldr = byId.get(id);
    return tldr ? [tldr] : [];
  });
}
