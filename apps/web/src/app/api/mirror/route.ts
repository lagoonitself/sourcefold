import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import {
  buildMirrorManifest,
  type MirrorFolder,
  type MirrorItem,
} from "@/features/mirror/manifest";

export const dynamic = "force-dynamic";

const PAGE = 1000;

// Every file in the library with its path in Drive, so the desktop app can keep a copy on disk.
export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  const { data: folders, error: foldersError } = await db
    .from("folders")
    .select("id, parent_id, name, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (foldersError) return jsonError(500, foldersError.message);

  // PostgREST returns at most 1000 rows per request.
  const items: MirrorItem[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("items")
      .select("id, folder_id, kind, title, status, meta, created_at, updated_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return jsonError(500, error.message);
    items.push(...((data ?? []) as MirrorItem[]));
    if (!data || data.length < PAGE) break;
  }

  return jsonData({ files: buildMirrorManifest((folders ?? []) as MirrorFolder[], items) });
}
