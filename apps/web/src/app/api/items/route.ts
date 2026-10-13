import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";

export const dynamic = "force-dynamic";

const folderIdSchema = z.string().uuid("Invalid folder ID");

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const folder = url.searchParams.get("folder")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;

  if (!folder && !q) {
    return jsonError(400, "Query parameter 'folder' or 'q' is required.");
  }

  if (folder) {
    const parsed = folderIdSchema.safeParse(folder);
    if (!parsed.success) {
      return jsonError(400, "Invalid folder ID");
    }

    const { data: items, error } = await auth.db
      .from("items")
      .select("id, folder_id, kind, title, source_url, status, created_at, meta")
      .eq("user_id", auth.userId)
      .eq("folder_id", folder)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      return jsonError(500, error.message);
    }

    return jsonData(items ?? []);
  }

  if (q) {
    const escaped = q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

    const { data: items, error } = await auth.db
      .from("items")
      .select("id, folder_id, kind, title, source_url, status, created_at, meta")
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .ilike("title", `%${escaped}%`)
      .order("title", { ascending: true })
      .limit(100);

    if (error) {
      return jsonError(500, error.message);
    }

    return jsonData(items ?? []);
  }

  return jsonError(400, "Query parameter 'folder' or 'q' is required.");
}
