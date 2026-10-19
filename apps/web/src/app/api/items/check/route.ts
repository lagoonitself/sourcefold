import { z } from "zod";
import { canonicalizeUrl, detectSource } from "@sourcefold/core";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { findExistingItemByCanonicalUrl } from "@/features/grokipedia/save-grokipedia";
import { findDuplicateElsewhere } from "@/features/capture/find-duplicate";

export const dynamic = "force-dynamic";

// A link counts as saved only in the group it would be saved to; other groups and other
// projects can hold their own copy.
const checkSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  folder_id: z.string().uuid("Pick a group."),
});

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = checkSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "URL is required");
  }

  let canonical: string;
  try {
    canonical = canonicalizeUrl(parsed.data.url);
  } catch {
    return jsonError(400, "That isn't a valid link.");
  }

  const existing = await findExistingItemByCanonicalUrl(
    auth.db,
    auth.userId,
    canonical,
    parsed.data.folder_id,
  );

  if (existing) {
    return jsonData({
      exists: true,
      item_id: existing.id,
      folder_id: existing.folder_id,
      folder_name: existing.folder_name,
      elsewhere: null,
    });
  }

  // If no item matches and the URL is an X post, also look up x_posts by the post's canonical URL
  if (detectSource(canonical) === "x") {
    const { data: existingNodes } = await auth.db
      .from("x_posts")
      .select("item_id")
      .eq("user_id", auth.userId)
      .eq("canonical_url", canonical);

    if (existingNodes && existingNodes.length > 0) {
      const candidateItemIds = Array.from(new Set(existingNodes.map((n) => n.item_id)));
      const { data: liveItem } = await auth.db
        .from("items")
        .select("id, folder_id, folders!items_folder_id_fkey(name, deleted_at)")
        .eq("user_id", auth.userId)
        .in("id", candidateItemIds)
        .eq("folder_id", parsed.data.folder_id)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();

      if (liveItem) {
        const folder = Array.isArray(liveItem.folders) ? liveItem.folders[0] : liveItem.folders;
        const folderName =
          folder && !folder.deleted_at && folder.name ? folder.name : "another folder";

        return jsonData({
          exists: true,
          item_id: liveItem.id,
          folder_id: liveItem.folder_id,
          folder_name: folderName,
          elsewhere: null,
        });
      }
    }
  }

  const elsewhere = await findDuplicateElsewhere(
    auth.db,
    auth.userId,
    canonical,
    parsed.data.folder_id,
  );

  return jsonData({ exists: false, elsewhere: elsewhere ?? null });
}
