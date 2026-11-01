import { z } from "zod";
import type { RouteContext } from "../../context";
import { jsonData, jsonError } from "../../http";
import type { LinkQueueNeeds, LinkQueueRow, LinkQueueStatus } from "../../types";

const bodySchema = z.object({
  needs: z.enum(["desktop", "browser"]),
  worker: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).optional(),
});

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

export async function POST(ctx: RouteContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data, error } = await ctx.db.rpc("claim_link_queue", {
    p_user_id: ctx.userId,
    p_needs: parsed.data.needs,
    p_worker: parsed.data.worker,
    p_limit: parsed.data.limit ?? 1,
  });
  if (error) {
    console.error("Failed to claim link queue rows:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return jsonData((data ?? []).map((row) => publicRow(row as unknown as Record<string, unknown>)));
}
