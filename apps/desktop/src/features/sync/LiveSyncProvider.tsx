import * as React from "react";
import {
  createLiveSync,
  supabaseSyncTransport,
  type LiveSyncState,
  type SyncBatch,
} from "@sourcefold/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { getDeviceId, getSupabase } from "@/lib/supabase";

// Signed in, changes made on another computer (or on the website, in the extension or by Claude)
// reach this one within a second or two: the database sends a wake-up message and every view
// reloads through `sourcefold:refresh`, which also brings the local copy's files up to date
// (AuthProvider). See docs/dev/PLAN-sync.md.

export interface LiveSyncInfo {
  state: LiveSyncState;
  /** When the last change from elsewhere arrived. */
  lastChangeAt: Date | null;
}

const LiveSyncContext = React.createContext<LiveSyncInfo>({ state: "off", lastChangeAt: null });

export function useLiveSync(): LiveSyncInfo {
  return React.useContext(LiveSyncContext);
}

/** Event other parts of the app can listen to for the ids that changed elsewhere. */
export const REMOTE_CHANGE_EVENT = "sourcefold:remote-change";

function refreshViews(): void {
  window.dispatchEvent(new Event("sourcefold:refresh"));
}

export function LiveSyncProvider({ children }: { children: React.ReactNode }) {
  const { signedIn, offlineMode, session } = useAuth();
  const userId = signedIn && !offlineMode ? (session?.user_id ?? null) : null;
  const [info, setInfo] = React.useState<LiveSyncInfo>({ state: "off", lastChangeAt: null });

  React.useEffect(() => {
    if (!userId) {
      setInfo({ state: "off", lastChangeAt: null });
      return;
    }
    let supabase: ReturnType<typeof getSupabase>;
    try {
      supabase = getSupabase();
    } catch (err) {
      console.error("Live sync has no account server", err);
      return;
    }
    // The app loads everything as it starts, so the first join needs no extra reload.
    let firstCatchUp = true;
    const sync = createLiveSync({
      transport: supabaseSyncTransport(supabase),
      userId,
      deviceId: getDeviceId(),
      onChange: (batch: SyncBatch) => {
        setInfo((prev) => ({ ...prev, lastChangeAt: new Date() }));
        window.dispatchEvent(new CustomEvent(REMOTE_CHANGE_EVENT, { detail: batch }));
        refreshViews();
      },
      onCatchUp: () => {
        if (firstCatchUp) {
          firstCatchUp = false;
          return;
        }
        refreshViews();
      },
      onState: (state) => setInfo((prev) => ({ ...prev, state })),
    });
    return () => sync.stop();
  }, [userId]);

  return <LiveSyncContext.Provider value={info}>{children}</LiveSyncContext.Provider>;
}
