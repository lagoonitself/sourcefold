import { z } from "zod";
import { canonicalizeUrl } from "@sourcefold/core";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { findExistingItemByCanonicalUrl } from "@/features/grokipedia/save-grokipedia";

export const dynamic = "force-dynamic";

const checkSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
});

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = checkSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "URL is required");
  }

  let canonical: string;
  try {
    canonical = canonicalizeUrl(parsed.data.url);
  } catch {
    return jsonError(400, "That isn't a valid link.");
  }

  const existing = await findExistingItemByCanonicalUrl(auth.supabase, canonical);

  if (!existing) {
    return jsonData({ exists: false });
  }

  return jsonData({
    exists: true,
    item_id: existing.id,
    folder_id: existing.folder_id,
    folder_name: existing.folder_name,
  });
}
