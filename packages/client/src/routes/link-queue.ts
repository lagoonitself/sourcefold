import { z } from "zod";
import type { RouteContext } from "../context";
import { invalidFolderMessage } from "../features/capture/find-duplicate";
import { jsonData, jsonError } from "../http";
import type { LinkQueueNeeds, LinkQueueRow, LinkQueueStatus } from "../types";

const COLUMNS =
  "id, folder_id, url, kind, needs, status, claimed_by, claimed_at, attempts, message, title, item_id, added_by, created_at, updated_at";
const OPEN_STATUSES: LinkQueueStatus[] = ["waiting", "working"];
const UUID = z.string().uuid();

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

const linkSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required.")
    .max(4000, "URL must be at most 4000 characters.")
    .refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    }, "Enter an http or https link."),
  kind: z.string().max(40).nullable().optional(),
  needs: z.enum(["desktop", "browser"]).optional(),
  message: z.string().max(1000).optional(),
});

const createSchema = z.object({
  folder_id: UUID,
  added_by: z.string().trim().min(1).max(100).optional(),
  links: z.array(linkSchema).min(1).max(200),
});

async function existingOpenRow(
  ctx: RouteContext,
  folderId: string,
  url: string,
): Promise<{ row: LinkQueueRow | null; error: string | null }> {
  const { data, error } = await ctx.db
    .from("link_queue")
    .select(COLUMNS)
    .eq("user_id", ctx.userId)
    .eq("folder_id", folderId)
    .eq("url", url)
    .in("status", OPEN_STATUSES)
    .maybeSingle();

  return {
    row: data ? publicRow(data as unknown as Record<string, unknown>) : null,
    error: error?.message ?? null,
  };
}

export async function GET(ctx: RouteContext, request: Request) {
  const query = new URL(request.url).searchParams;
  const status = query.get("status") ?? "open";
  if (status !== "open" && status !== "recent") {
    return jsonError(400, "Status must be 'open' or 'recent'.");
  }

  const needsValue = query.get("needs");
  if (needsValue && needsValue !== "desktop" && needsValue !== "browser") {
    return jsonError(400, "Needs must be 'desktop' or 'browser'.");
  }

  const folderId = query.get("folder_id");
  if (folderId && !UUID.safeParse(folderId).success) {
    return jsonError(400, "Invalid folder ID.");
  }

  const idsValue = query.get("ids");
  const ids = idsValue
    ? [
        ...new Set(
          idsValue
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ]
    : [];
  if (ids.some((id) => !UUID.safeParse(id).success)) {
    return jsonError(400, "Invalid link queue id.");
  }

  const limitValue = query.get("limit");
  const limit = limitValue === null ? 200 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return jsonError(400, "Limit must be between 1 and 500.");
  }

  let selection = ctx.db.from("link_queue").select(COLUMNS).eq("user_id", ctx.userId);
  if (ids.length > 0) {
    selection = selection.in("id", ids);
  } else if (status === "open") {
    selection = selection.in("status", OPEN_STATUSES);
  } else {
    selection = selection.gte(
      "created_at",
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  }
  if (needsValue) selection = selection.eq("needs", needsValue);
  if (folderId) selection = selection.eq("folder_id", folderId);

  const { data, error } = await selection.order("created_at", { ascending: true }).limit(limit);
  if (error) {
    console.error("Failed to load link queue:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return jsonData((data ?? []).map((row) => publicRow(row as unknown as Record<string, unknown>)));
}

export async function POST(ctx: RouteContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data: folder, error: folderError } = await ctx.db
    .from("folders")
    .select("id, parent_id")
    .eq("id", parsed.data.folder_id)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (folderError) {
    console.error("Failed to check link queue group:", folderError);
    return jsonError(500, "Something went wrong. Try again.");
  }
  if (!folder) return jsonError(400, invalidFolderMessage("invalid folder"));
  if (!folder.parent_id) {
    return jsonError(400, invalidFolderMessage("sources must be saved in a group"));
  }

  const rows: LinkQueueRow[] = [];
  for (const link of parsed.data.links) {
    const open = await existingOpenRow(ctx, parsed.data.folder_id, link.url);
    if (open.error) {
      console.error("Failed to check open link queue row:", open.error);
      return jsonError(500, "Something went wrong. Try again.");
    }
    if (open.row) {
      rows.push(open.row);
      continue;
    }

    const { data, error } = await ctx.db
      .from("link_queue")
      .insert({
        user_id: ctx.userId,
        folder_id: parsed.data.folder_id,
        url: link.url,
        kind: link.kind ?? null,
        needs: link.needs ?? "desktop",
        message: link.message ?? null,
        added_by: parsed.data.added_by ?? "mcp",
      })
      .select(COLUMNS)
      .single();

    if (error?.code === "23505") {
      const duplicate = await existingOpenRow(ctx, parsed.data.folder_id, link.url);
      if (duplicate.row) {
        rows.push(duplicate.row);
        continue;
      }
    }
    if (error || !data) {
      console.error("Failed to add link to queue:", error);
      return jsonError(500, "Something went wrong. Try again.");
    }
    rows.push(publicRow(data as unknown as Record<string, unknown>));
  }

  return jsonData(rows, 201);
}
