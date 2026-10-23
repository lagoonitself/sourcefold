import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { projectFileMediaType } from "@sourcefold/core/project-file";
import type { Database } from "@/lib/database.types";

// Post images and GIFs that came in a project file (`POST /api/items/[id]/media-upload`) wait in
// this bucket under `<user id>/<item id>/<file name>` until the Drive save copies them into the
// post's `_files` folder; then they are deleted. Migration 20261023000000_post_media_staging.sql.

export const POST_MEDIA_BUCKET = "post-media";

export interface StagedMedia {
  /** The staged copy of `name`, or null when there is none. */
  read(name: string): Promise<{ body: Uint8Array; mimeType: string } | null>;
  /** Deletes everything staged for the item. */
  clear(): Promise<void>;
}

export function stagedMediaFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  itemId: string,
): StagedMedia {
  const folder = `${userId}/${itemId}`;
  const bucket = () => supabase.storage.from(POST_MEDIA_BUCKET);
  return {
    async read(name) {
      try {
        const { data, error } = await bucket().download(`${folder}/${name}`);
        if (error || !data) return null;
        const body = new Uint8Array(await data.arrayBuffer());
        if (body.byteLength === 0) return null;
        return { body, mimeType: projectFileMediaType(name) ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async clear() {
      const { data, error } = await bucket().list(folder, { limit: 1000 });
      if (error || !data || data.length === 0) return;
      await bucket().remove(data.map((f) => `${folder}/${f.name}`));
    },
  };
}
