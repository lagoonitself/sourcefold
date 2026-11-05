// The apps' "push to Drive soon": what the website does with `pushToDriveSoon` after a response
// (apps/web/src/features/drive/push-to-drive-soon.ts), run in-process a few seconds after a change.
// The database lock (`acquire_drive_sync_lock`) keeps the website, other devices and a manual
// Save to Drive out while it runs; a push that finds the lock taken waits for the next change.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { runContentBatch } from "../features/content/run-content-batch";
import { runSaveBatch } from "../features/drive/run-save-batch";
import type { Host } from "../host";

export const DRIVE_PUSH_DELAY_MS = 3000;
/** Same budget as the website's automatic push; the rest waits for the next save. */
const PUSH_BUDGET = 10;

export interface DrivePusher {
  schedule(userId: string): void;
  /** Runs any scheduled push now (tests, sign-out). */
  flush(): Promise<void>;
  cancel(): void;
}

export function createDrivePusher(
  db: SupabaseClient<Database>,
  host: Pick<Host, "drive" | "fetchUrl" | "content">,
  options: { delayMs?: number; onPushed?(): void } = {},
): DrivePusher {
  const delayMs = options.delayMs ?? DRIVE_PUSH_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledFor: string | null = null;
  let running: Promise<void> | null = null;
  let again: string | null = null;

  async function pushToContentStore(userId: string): Promise<void> {
    if (!host.content) return;
    try {
      const result = await runContentBatch(db, userId, host, PUSH_BUDGET);
      for (const item of result.failed) {
        console.error(`Couldn't move "${item.title}" to the content store: ${item.message}`);
      }
      if (result.storageFull) console.error("The content store is full.");
      if (result.moved > 0) options.onPushed?.();
    } catch (err) {
      console.error("Automatic content save failed:", err);
    }
  }

  /** The Drive backup is on unless the person switched it off (no row yet counts as on). */
  async function backupIsOn(userId: string): Promise<boolean> {
    const { data } = await db
      .from("drive_state")
      .select("backup_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.backup_enabled ?? true;
  }

  async function push(userId: string): Promise<void> {
    await pushToContentStore(userId);

    try {
      if (!(await backupIsOn(userId)) || !(await host.drive.isConnected(userId))) return;
    } catch (err) {
      console.error("Automatic Drive save failed:", err);
      return;
    }

    const { data: locked } = await db.rpc("acquire_drive_sync_lock", { p_user_id: userId });
    if (!locked) return;
    try {
      const accessToken = await host.drive.getAccessToken(userId);
      await runSaveBatch(db, userId, accessToken, host, PUSH_BUDGET);
      options.onPushed?.();
    } catch (err) {
      console.error("Automatic Drive save failed:", err);
    } finally {
      await db.rpc("release_drive_sync_lock", { p_user_id: userId });
    }
  }

  function start(userId: string): Promise<void> {
    if (running) {
      // A change during a push gets its own push afterwards.
      again = userId;
      return running;
    }
    running = push(userId).finally(() => {
      running = null;
      if (again) {
        const next = again;
        again = null;
        schedule(next);
      }
    });
    return running;
  }

  function schedule(userId: string): void {
    if (timer) clearTimeout(timer);
    scheduledFor = userId;
    timer = setTimeout(() => {
      timer = null;
      scheduledFor = null;
      void start(userId);
    }, delayMs);
  }

  return {
    schedule,
    async flush() {
      if (timer && scheduledFor) {
        clearTimeout(timer);
        timer = null;
        const userId = scheduledFor;
        scheduledFor = null;
        await start(userId);
      } else if (running) {
        await running;
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      scheduledFor = null;
      again = null;
    },
  };
}
