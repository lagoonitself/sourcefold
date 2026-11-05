"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createLiveSync, supabaseSyncTransport } from "@sourcefold/client/live-sync";
import { createClient } from "@/lib/supabase/client";

// Changes made on another computer, in the desktop app, the extension or by Claude show up here
// within a few seconds: the database sends a wake-up message and the page reloads its data
// (docs/dev/PLAN-sync.md). Renders nothing.
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let stop: (() => void) | null = null;
    const supabase = createClient();
    // The first join needs no reload: the page was just rendered.
    let firstCatchUp = true;

    void supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (stopped || !userId) return;
      const sync = createLiveSync({
        transport: supabaseSyncTransport(supabase),
        userId,
        onChange: () => router.refresh(),
        onCatchUp: () => {
          if (firstCatchUp) {
            firstCatchUp = false;
            return;
          }
          router.refresh();
        },
      });
      stop = () => sync.stop();
    });

    return () => {
      stopped = true;
      stop?.();
    };
  }, [router]);

  return null;
}
