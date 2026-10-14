import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleAccessToken } from "@/lib/google/oauth";
import { runSaveBatch } from "./run-save-batch";

// Article text and images stay in Supabase only until they reach Drive. After a new source
// is saved, push it to Drive once the response is sent. If another save holds the lock or
// Drive isn't connected, the item waits for the next save and shows in the unsaved count.
export function pushToDriveSoon(userId: string): void {
  after(async () => {
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch {
      return;
    }

    const { data: locked } = await admin.rpc("acquire_drive_sync_lock", { p_user_id: userId });
    if (!locked) return;

    try {
      const accessToken = await getGoogleAccessToken(userId);
      await runSaveBatch(admin, userId, accessToken, 10);
    } catch (err) {
      console.error("Automatic Drive save failed:", err);
    } finally {
      await admin.rpc("release_drive_sync_lock", { p_user_id: userId });
    }
  });
}
