import type { LinkQueueRow } from "@sourcefold/client";

export type { LinkQueueNeeds, LinkQueueRow, LinkQueueStatus } from "@sourcefold/client";

/** One of the three `PATCH /api/link-queue/[id]` bodies. */
export type LinkQueuePatch =
  | {
      status: "saved" | "duplicate" | "unavailable" | "failed";
      message?: string;
      title?: string;
      item_id?: string;
    }
  | { status: "waiting"; message?: string }
  | { status: "waiting"; needs: "desktop" | "browser"; message?: string };

/** What one Add-links save returns. Refusals and YouTube limits are thrown, not returned. */
export type SavedLink =
  | { kind: "saved"; title: string; itemId: string; message?: string }
  | { kind: "duplicate"; title: string | null; message: string }
  | { kind: "unavailable"; title: string | null; message: string };

export interface DrainProgress {
  /** 1-based index in the batch just claimed. */
  index: number;
  total: number;
  addedBy: string | null;
  /** Set while waiting out a YouTube limit, for example "1 min". */
  pause: string | null;
}

/** Counts are queue rows, not videos inside a playlist. */
export interface BatchSummary {
  saved: number;
  duplicate: number;
  unavailable: number;
  failed: number;
  browser: number;
  youtubeLimited: boolean;
  addedBy: string | null;
  /** A save wrote or updated the library, so the group lists should reload. */
  libraryChanged: boolean;
}

export function emptySummary(): BatchSummary {
  return {
    saved: 0,
    duplicate: 0,
    unavailable: 0,
    failed: 0,
    browser: 0,
    youtubeLimited: false,
    addedBy: null,
    libraryChanged: false,
  };
}

export type YouTubeListResult = {
  title: string | null;
  videos: { url: string; title: string }[];
  truncated: boolean;
};

export type PublicationListResult = {
  posts: { url: string; title: string | null }[];
};

/** How the drain reaches the local API and the Add links save path. Tests pass fakes. */
export interface DrainHooks {
  worker: string;
  stopped(): boolean;
  signal: AbortSignal;
  claim(body: { needs: "desktop"; worker: string; limit: number }): Promise<LinkQueueRow[]>;
  patch(id: string, body: LinkQueuePatch): Promise<void>;
  /** Queues posts or videos from a collection for the extension, one row each. */
  enqueueForBrowser(body: { folderId: string; urls: string[]; addedBy: string }): Promise<void>;
  save(url: string, folderId: string, signal: AbortSignal): Promise<SavedLink>;
  listYouTube(url: string, signal: AbortSignal): Promise<YouTubeListResult>;
  listPosts(url: string, signal: AbortSignal): Promise<PublicationListResult>;
  onProgress(progress: DrainProgress): void;
  wait(
    ms: number,
    shouldStop: () => boolean,
    onTick?: (secondsLeft: number) => void,
  ): Promise<boolean>;
  youTubeGapMs(): number;
}
