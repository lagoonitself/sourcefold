// The Link Shelf (docs/dev/PLAN-shelf.md): request checks, row mapping and the add logic shared
// by the routes.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  normalizeShelfTags,
  normalizeShelfUrl,
  SHELF_LIMITS,
  shelfKey,
  shelfTitleFallback,
  type ShelfAddResult,
  type ShelfLink,
} from "@sourcefold/core";
import type { Database } from "../../database.types";

export const SHELF_COLUMNS =
  "id, url, key, title, note, tags, pinned, open_count, last_opened_at, created_at, updated_at" as const;

export function rowToShelfLink(
  row: Database["public"]["Tables"]["shelf_links"]["Row"] | ShelfLink,
): ShelfLink {
  return {
    id: row.id,
    url: row.url,
    key: row.key,
    title: row.title,
    note: row.note,
    tags: row.tags ?? [],
    pinned: row.pinned,
    open_count: row.open_count,
    last_opened_at: row.last_opened_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const urlField = z
  .string({ message: "A link needs a URL." })
  .max(SHELF_LIMITS.url, `A URL can be at most ${SHELF_LIMITS.url} characters.`)
  .transform((value, ctx) => {
    const url = normalizeShelfUrl(value);
    const key = url ? shelfKey(url) : null;
    if (!url || !key) {
      ctx.addIssue({ code: "custom", message: `"${value.slice(0, 80)}" isn't a web address.` });
      return z.NEVER;
    }
    return { url, key };
  });

const titleField = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(
    z.string().max(SHELF_LIMITS.title, `A title can be at most ${SHELF_LIMITS.title} characters.`),
  );

const noteField = z
  .string()
  .transform((v) => v.replace(/\r\n/g, "\n").trim())
  .pipe(
    z.string().max(SHELF_LIMITS.note, `A note can be at most ${SHELF_LIMITS.note} characters.`),
  );

const tagsField = z
  .array(z.string(), { message: "Tags must be a list." })
  .transform((v) => normalizeShelfTags(v));

export const shelfInputSchema = z.object({
  url: urlField,
  title: titleField.optional(),
  note: noteField.optional(),
  tags: tagsField.optional(),
  pinned: z.boolean().optional(),
});

export const shelfAddSchema = z.union([
  z.object({
    links: z
      .array(shelfInputSchema)
      .min(1, "Give at least one link.")
      .max(SHELF_LIMITS.batch, `Add at most ${SHELF_LIMITS.batch} links at a time.`),
  }),
  shelfInputSchema.transform((link) => ({ links: [link] })),
]);

export const shelfPatchSchema = z
  .object({
    url: urlField.optional(),
    title: titleField.optional(),
    note: noteField.optional(),
    tags: tagsField.optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

export type ShelfInputParsed = z.infer<typeof shelfInputSchema>;

/** Adds links the shelf doesn't have yet; links whose key is already there come back unchanged. */
export async function addShelfLinks(
  db: SupabaseClient<Database>,
  userId: string,
  inputs: ShelfInputParsed[],
): Promise<ShelfAddResult> {
  const keys = [...new Set(inputs.map((i) => i.url.key))];
  const existingByKey = new Map<string, ShelfLink>();
  for (let i = 0; i < keys.length; i += 100) {
    const { data, error } = await db
      .from("shelf_links")
      .select(SHELF_COLUMNS)
      .eq("user_id", userId)
      .in("key", keys.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) existingByKey.set(row.key, rowToShelfLink(row));
  }

  const existing: ShelfLink[] = [];
  const toInsert: Database["public"]["Tables"]["shelf_links"]["Insert"][] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const { url, key } = input.url;
    const old = existingByKey.get(key);
    if (old) {
      if (!seen.has(key)) existing.push(old);
      seen.add(key);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push({
      user_id: userId,
      url,
      key,
      title: input.title || shelfTitleFallback(url),
      note: input.note ?? "",
      tags: input.tags ?? [],
      pinned: input.pinned ?? false,
    });
  }

  const added: ShelfLink[] = [];
  if (toInsert.length) {
    // ignoreDuplicates: a link added from another device in between isn't an error.
    const { data, error } = await db
      .from("shelf_links")
      .upsert(toInsert, { onConflict: "user_id,key", ignoreDuplicates: true })
      .select(SHELF_COLUMNS);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) added.push(rowToShelfLink(row));
  }
  return { added, existing };
}
