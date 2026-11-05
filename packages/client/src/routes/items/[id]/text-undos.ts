import { z } from "zod";
import { jsonData, jsonError } from "../../../http";
import type { Json } from "../../../database.types";
import type { RouteContext } from "../../../context";

const idSchema = z.string().uuid();

/** Enough to undo a run of cuts; older rows are dropped so article text doesn't pile up. */
const MAX_PER_ITEM = 8;

const COLUMNS = "id, item_id, before_markdown, after_hash, lost_highlights, created_at" as const;

const postSchema = z.object({
  before: z.string().min(1).max(2_000_000),
  after_hash: z.string().regex(/^[a-f0-9]{64}$/, "Invalid removal hash."),
  lost: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
});

type UndoRow = {
  id: string;
  item_id: string;
  before_markdown: string;
  after_hash: string;
  lost_highlights: Json;
  created_at: string;
};

async function liveItem(
  auth: RouteContext,
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; error: Response }> {
  const { data, error } = await auth.db
    .from("items")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: jsonError(500, error.message) };
  if (!data) return { ok: false, error: jsonError(404, "Item not found.") };
  return { ok: true, id: data.id };
}

function toPayload(row: UndoRow) {
  return {
    id: row.id,
    item_id: row.item_id,
    before: row.before_markdown,
    after_hash: row.after_hash,
    lost: row.lost_highlights,
    created_at: row.created_at,
  };
}

/** The newest removal for this source, or null when there is nothing to undo. */
export async function GET(auth: RouteContext, _request: Request, params: { id: string }) {
  if (!idSchema.safeParse(params.id).success) return jsonError(404, "Item not found.");
  const item = await liveItem(auth, params.id);
  if (!item.ok) return item.error;

  const { data, error } = await auth.db
    .from("text_undos")
    .select(COLUMNS)
    .eq("item_id", item.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return jsonError(500, error.message);
  return jsonData(data ? toPayload(data) : null);
}

/** Remembers one removal. The caller sends the body to restore and a hash of the body after the cut. */
export async function POST(auth: RouteContext, request: Request, params: { id: string }) {
  if (!idSchema.safeParse(params.id).success) return jsonError(404, "Item not found.");
  const item = await liveItem(auth, params.id);
  if (!item.ok) return item.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data, error } = await auth.db
    .from("text_undos")
    .insert({
      user_id: auth.userId,
      item_id: item.id,
      before_markdown: parsed.data.before,
      after_hash: parsed.data.after_hash,
      lost_highlights: parsed.data.lost as unknown as Json,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(500, "Something went wrong. Try again.");

  const { data: older, error: listError } = await auth.db
    .from("text_undos")
    .select("id")
    .eq("item_id", item.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (!listError && older && older.length > MAX_PER_ITEM) {
    const drop = older.slice(MAX_PER_ITEM).map((row) => row.id);
    await auth.db.from("text_undos").delete().in("id", drop);
  }

  return jsonData(toPayload(data));
}

/** Forgets the newest removal after it has been restored. */
export async function DELETE(auth: RouteContext, _request: Request, params: { id: string }) {
  if (!idSchema.safeParse(params.id).success) return jsonError(404, "Item not found.");
  const item = await liveItem(auth, params.id);
  if (!item.ok) return item.error;

  const { data: newest, error: findError } = await auth.db
    .from("text_undos")
    .select("id")
    .eq("item_id", item.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findError) return jsonError(500, findError.message);
  if (!newest) return jsonData(null);

  const { error } = await auth.db.from("text_undos").delete().eq("id", newest.id);
  if (error) return jsonError(500, error.message);
  return jsonData({ id: newest.id });
}
