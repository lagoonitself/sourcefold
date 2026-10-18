import * as React from "react";
import { toast } from "sonner";
import { getFolders, getItem, isTauri } from "@/lib/api";
import type { Item } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { parseShowPayload, planShow, type ShowNavigation } from "./agent-show";

export interface AgentEventHandlers {
  /** Reloads the folder list into the app's state. */
  refreshFolders: () => Promise<void>;
  /** Opens the project and group, focuses the source, and opens the reader when asked. */
  navigate: (navigation: ShowNavigation) => void;
}

/**
 * Listens for what the Sourcefold MCP server asks of the app (Rust side: `agent.rs`):
 * `agent-changed` reloads the library, `agent-show` opens a group, a source or a highlight.
 * Does nothing outside the desktop app.
 */
export function useAgentEvents(handlers: AgentEventHandlers) {
  const latest = React.useRef(handlers);
  latest.current = handlers;

  React.useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    // Only the newest show request goes through if several arrive while one is loading.
    let showRequest = 0;

    const handleShow = async (payload: unknown) => {
      const requestId = ++showRequest;
      const target = parseShowPayload(payload);
      if (!target) {
        toast.error("Claude asked to show something Sourcefold couldn't read.");
        return;
      }

      let item: Item | null = null;
      if ("source_id" in target) {
        try {
          item = await getItem(target.source_id);
        } catch (err) {
          if (requestId !== showRequest) return;
          toast.error("Couldn't show that source in Sourcefold.", {
            description: errorMessage(err, "It may have been deleted."),
          });
          return;
        }
      }

      try {
        // Claude may have just made the group, so load the list into the app before opening it.
        await latest.current.refreshFolders();
        const folders = await getFolders(true);
        if (requestId !== showRequest) return;
        const plan = planShow(target, folders, item);
        if (!plan.ok) {
          toast.error(plan.message);
          return;
        }
        latest.current.navigate(plan.navigation);
      } catch (err) {
        if (requestId === showRequest) {
          toast.error(errorMessage(err, "Couldn't show that in Sourcefold."));
        }
      }
    };

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const subscriptions = await Promise.all([
        listen("agent-changed", () => {
          // The app's folder and item reload, the highlights and Drive status all run on this
          // event, in signed-in and offline mode alike.
          window.dispatchEvent(new Event("sourcefold:refresh"));
        }),
        listen<unknown>("agent-show", (event) => void handleShow(event.payload)),
      ]);
      if (disposed) subscriptions.forEach((fn) => fn());
      else unlisten.push(...subscriptions);
    })().catch((err) => console.error("Couldn't listen for Claude events", err));

    return () => {
      disposed = true;
      unlisten.forEach((fn) => fn());
    };
  }, []);
}
