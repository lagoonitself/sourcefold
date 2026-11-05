import "server-only";
import { after } from "next/server";
import { runContentBatch } from "@sourcefold/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { webContentStore, webDriveAccess, webFetchUrl } from "@/lib/web-drive";
import { runSaveBatch } from "./run-save-batch";

// Article text and images stay in Supabase only until they reach R2 (and Drive, if the person's
// backup is on). After a new source is saved, move it once the response is sent. If another save
// holds the lock or Drive isn't connected or is switched off, the Drive copy waits for the next
// save and shows in the unsaved count.
export function pushToDriveSoon(userId: string): void {
  after(async () => {
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch {
      return;
    }

    const host = { drive: webDriveAccess, fetchUrl: webFetchUrl, content: webContentStore() };

    if (host.content) {
      try {
        const result = await runContentBatch(admin, userId, host, 10);
        for (const item of result.failed) {
          console.error(`Couldn't move "${item.title}" to the content store: ${item.message}`);
        }
        if (result.storageFull) console.error("The content store is full.");
      } catch (err) {
        console.error("Automatic content save failed:", err);
      }
    }

    // The Drive backup is on unless the person switched it off (no row yet counts as on).
    const { data: state } = await admin
      .from("drive_state")
      .select("backup_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (state?.backup_enabled === false) return;
    if (!(await webDriveAccess.isConnected(userId))) return;

    const { data: locked } = await admin.rpc("acquire_drive_sync_lock", { p_user_id: userId });
    if (!locked) return;

    try {
      const accessToken = await webDriveAccess.getAccessToken(userId);
      await runSaveBatch(admin, userId, accessToken, host, 10);
    } catch (err) {
      console.error("Automatic Drive save failed:", err);
    } finally {
      await admin.rpc("release_drive_sync_lock", { p_user_id: userId });
    }
  });
}
