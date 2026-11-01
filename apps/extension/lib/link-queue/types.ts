export type { LinkQueueNeeds, LinkQueueRow, LinkQueueStatus } from "@sourcefold/client";

/** A finished save, or a release back to `waiting` (missing host permission, or Retry). */
export type LinkQueuePatch =
  | {
      status: "saved" | "duplicate" | "unavailable" | "failed";
      message?: string;
      title?: string;
      item_id?: string;
    }
  | {
      status: "waiting";
      message?: string;
      needs?: "browser";
    };

/** What the popup banner reads. Stored in `chrome.storage.local`. */
export interface LinkQueueState {
  /** Open browser rows whose origin this extension may not open yet. */
  permission: { count: number; hosts: string[]; origins: string[] } | null;
  /** Set while a claimed row is open in a tab. */
  progress: { index: number; total: number; addedBy: string | null } | null;
  /** Browser rows in the last 7 days that failed. Retry sets them back to waiting. */
  failed: { count: number; message: string | null } | null;
}

export const EMPTY_LINK_QUEUE_STATE: LinkQueueState = {
  permission: null,
  progress: null,
  failed: null,
};
