import { z } from "zod";
import type { RouteContext } from "../../context";
import { jsonData, jsonError } from "../../http";
import type { LinkQueueNeeds, LinkQueueRow, LinkQueueStatus } from "../../types";

const COLUMNS =
  "id, folder_id, url, kind, needs, status, claimed_by, claimed_at, attempts, message, title, item_id, added_by, created_at, updated_at";
const idSchema = z.string().uuid();
const resultSchema = z
  .object({
    status: z.enum(["saved", "duplicate", "unavailable", "failed"]),
    message: z.string().max(1000).optional(),
    title: z.string().max(1000).optional(),
    item_id: z.string().uuid().optional(),
  })
  .strict();
const releaseSchema = z
  .object({ status: z.literal("waiting"), message: z.string().max(1000).optional() })
  .strict();
const browserSchema = z
  .object({
    status: z.literal("waiting"),
    needs: z.literal("browser"),
    message: z.string().max(1000).optional(),
  })
  .strict();
const patchSchema = z.union([resultSchema, releaseSchema, browserSchema]);

function publicRow(row: Record<string, unknown>): LinkQueueRow {
  return {
    id: String(row.id),
    folder_id: String(row.folder_id),
    url: String(row.url),
    kind: typeof row.kind === "string" ? row.kind : null,
    needs: row.needs as LinkQueueNeeds,
    status: row.status as LinkQueueStatus,
    claimed_by: typeof row.claimed_by === "string" ? row.claimed_by : null,
    claimed_at: typeof row.claimed_at === "string" ? row.claimed_at : null,
    attempts: Number(row.attempts) || 0,
    message: typeof row.message === "string" ? row.message : null,
    title: typeof row.title === "string" ? row.title : null,
    item_id: typeof row.item_id === "string" ? row.item_id : null,
    added_by: String(row.added_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function PATCH(ctx: RouteContext, request: Request, params: { id: string }) {
  if (!idSchema.safeParse(params.id).success) return jsonError(400, "Invalid link queue id.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const patch =
    parsed.data.status === "waiting"
      ? {
          status: "waiting",
          ...("needs" in parsed.data ? { needs: parsed.data.needs } : {}),
          message: parsed.data.message ?? null,
          claimed_by: null,
          claimed_at: null,
        }
      : {
          status: parsed.data.status,
          message: parsed.data.message ?? null,
          ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
          ...(parsed.data.item_id === undefined ? {} : { item_id: parsed.data.item_id }),
          claimed_by: null,
          claimed_at: null,
        };

  const { data, error } = await ctx.db
    .from("link_queue")
    .update(patch)
    .eq("id", params.id)
    .eq("user_id", ctx.userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("Failed to update link queue row:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!data) return jsonError(404, "Link queue item not found.");
  return jsonData(publicRow(data as unknown as Record<string, unknown>));
}

export async function DELETE(ctx: RouteContext, _request: Request, params: { id: string }) {
  if (!idSchema.safeParse(params.id).success) return jsonError(400, "Invalid link queue id.");

  const { data: cancelled, error: cancelError } = await ctx.db
    .from("link_queue")
    .update({ status: "cancelled", claimed_by: null, claimed_at: null })
    .eq("id", params.id)
    .eq("user_id", ctx.userId)
    .in("status", ["waiting", "working"])
    .select(COLUMNS)
    .maybeSingle();
  if (cancelError) {
    console.error("Failed to cancel link queue row:", cancelError);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (cancelled) return jsonData(publicRow(cancelled as unknown as Record<string, unknown>));

  const { data: existing, error } = await ctx.db
    .from("link_queue")
    .select(COLUMNS)
    .eq("id", params.id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) {
    console.error("Failed to check link queue row:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!existing) return jsonError(404, "Link queue item not found.");
  return jsonData(publicRow(existing as unknown as Record<string, unknown>));
}
