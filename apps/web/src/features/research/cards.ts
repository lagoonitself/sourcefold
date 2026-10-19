import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type CardInput, type CardKind, cardProblem } from "@sourcefold/core";
import type { Database } from "@/lib/database.types";
import { type LiveFolder, loadLiveFolders, projectIdOf } from "@/features/research/projects";

export const CARD_COLUMNS =
  "id, project_id, kind, item_id, highlight_id, quote, seconds, end_seconds, url, note, script_line, section_id, position, created_at, updated_at" as const;

export const cardIdSchema = z.string().uuid("Invalid card ID");

export const cardInputSchema = z
  .object({
    id: z.string().uuid("Invalid card ID"),
    project_id: z.string().uuid("Invalid project ID"),
    kind: z.enum(["quote", "broll", "line"] satisfies [CardKind, ...CardKind[]]),
    item_id: z.string().uuid("Invalid item ID").nullable().optional().default(null),
    highlight_id: z.string().uuid("Invalid highlight ID").nullable().optional().default(null),
    quote: z.string().optional().default(""),
    seconds: z.number().nullable().optional().default(null),
    end_seconds: z.number().nullable().optional().default(null),
    url: z.string().nullable().optional().default(null),
    note: z.string().nullable().optional().default(null),
    script_line: z.string().nullable().optional().default(null),
    section_id: z.string().uuid("Invalid section ID").nullable().optional().default(null),
    position: z.number().optional().default(0),
  })
  .superRefine((data, ctx) => {
    const card: CardInput = {
      id: data.id,
      project_id: data.project_id,
      kind: data.kind,
      item_id: data.item_id,
      highlight_id: data.highlight_id,
      quote: data.quote,
      seconds: data.seconds,
      end_seconds: data.end_seconds,
      url: data.url,
      note: data.note,
      script_line: data.script_line,
      section_id: data.section_id,
      position: data.position,
    };
    const problem = cardProblem(card);
    if (problem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem,
      });
    }
  });

export const cardPatchSchema = z
  .object({
    quote: z.string().optional(),
    seconds: z.number().nullable().optional(),
    end_seconds: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    script_line: z.string().nullable().optional(),
    section_id: z.string().uuid("Invalid section ID").nullable().optional(),
    position: z.number().optional(),
  })
  .refine(
    (data) =>
      data.quote !== undefined ||
      data.seconds !== undefined ||
      data.end_seconds !== undefined ||
      data.url !== undefined ||
      data.note !== undefined ||
      data.script_line !== undefined ||
      data.section_id !== undefined ||
      data.position !== undefined,
    { message: "At least one field must be provided to update." },
  );

/**
 * Drops cards whose item_id points at a source that is soft-deleted or sits in a
 * soft-deleted group. Line cards (item_id null) are always kept.
 */
export async function filterLiveCards<T extends { item_id: string | null; project_id: string }>(
  db: SupabaseClient<Database>,
  userId: string,
  cards: T[],
): Promise<T[]> {
  if (cards.length === 0) return [];

  const itemIds = Array.from(
    new Set(cards.map((c) => c.item_id).filter((id): id is string => id !== null)),
  );

  if (itemIds.length === 0) {
    return cards;
  }

  // Load items that have not been soft-deleted
  const CHUNK_SIZE = 50;
  const liveItems: { id: string; folder_id: string }[] = [];
  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    const chunk = itemIds.slice(i, i + CHUNK_SIZE);
    const { data, error } = await db
      .from("items")
      .select("id, folder_id")
      .in("id", chunk)
      .eq("user_id", userId)
      .is("deleted_at", null);

    if (error) throw new Error(error.message);
    if (data) {
      const rows = Array.isArray(data) ? data : [data];
      liveItems.push(...rows);
    }
  }

  if (liveItems.length === 0) {
    return cards.filter((c) => c.item_id === null);
  }

  const folders = await loadLiveFolders(db, userId);

  // Map each live item to its root project ID
  const itemProjectMap = new Map<string, string>();
  for (const item of liveItems) {
    const projId = projectIdOf(folders, item.folder_id);
    if (projId !== null) {
      itemProjectMap.set(item.id, projId);
    }
  }

  return cards.filter((c) => {
    if (c.item_id === null) return true;
    const projId = itemProjectMap.get(c.item_id);
    return projId !== undefined && projId === c.project_id;
  });
}

/**
 * Checks whether an item exists, is not soft-deleted, and belongs to a live folder
 * inside the given project.
 */
export async function isLiveItem(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
  projectId: string,
  folders?: LiveFolder[],
): Promise<boolean> {
  const { data: itemData, error } = await db
    .from("items")
    .select("id, folder_id")
    .eq("id", itemId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return false;
  const item = Array.isArray(itemData) ? itemData[0] : itemData;
  if (!item) return false;

  const liveFolders = folders ?? (await loadLiveFolders(db, userId));
  const itemProjId = projectIdOf(liveFolders, item.folder_id);
  return itemProjId !== null && itemProjId === projectId;
}
