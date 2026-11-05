import { z } from "zod";
import type { RouteContext } from "../../context";
import { jsonData, jsonError } from "../../http";

// Check-ins from the desktop app and the Chrome extension (link_workers), so every place that
// lists waiting links can say whether their helper is running (docs/dev/PLAN-link-status.md).

const checkInSchema = z.object({
  worker: z
    .string()
    .trim()
    .regex(/^(desktop|extension):[A-Za-z0-9-]{1,80}$/, "Invalid worker id."),
  kind: z.enum(["desktop", "extension"]),
  can_run: z.boolean().optional(),
  version: z.string().trim().max(40).optional(),
});

/** `{ desktop_seen_at, extension_seen_at, extension_can_run }` (LinkWorkersSeen in core). */
export async function GET(ctx: RouteContext) {
  const { data, error } = await ctx.db
    .from("link_workers")
    .select("kind, can_run, seen_at")
    .eq("user_id", ctx.userId)
    .order("seen_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Failed to load link workers:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  const rows = data ?? [];
  const desktop = rows.find((row) => row.kind === "desktop");
  // Prefer an extension that can work the queue, if any checked in recently enough to matter.
  const extensions = rows.filter((row) => row.kind === "extension");
  const extension = extensions.find((row) => row.can_run) ?? extensions[0];
  return jsonData({
    desktop_seen_at: desktop?.seen_at ?? null,
    extension_seen_at: extension?.seen_at ?? null,
    extension_can_run: Boolean(extension?.can_run),
  });
}

export async function POST(ctx: RouteContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }
  if (!parsed.data.worker.startsWith(`${parsed.data.kind}:`)) {
    return jsonError(400, "The worker id doesn't match its kind.");
  }
  const { error } = await ctx.db.rpc("link_worker_check_in", {
    p_worker: parsed.data.worker,
    p_kind: parsed.data.kind,
    p_can_run: parsed.data.can_run ?? true,
    p_version: parsed.data.version,
    p_user_id: ctx.userId,
  });
  if (error) {
    console.error("Failed to record link worker check-in:", error);
    return jsonError(500, "Something went wrong. Try again.");
  }
  return jsonData({ ok: true });
}
