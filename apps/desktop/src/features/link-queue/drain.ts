import { isYouTubeRateLimit } from "@sourcefold/core/capture";
import type { LinkQueueRow } from "@sourcefold/client";
import { isSessionExpiredError } from "@/lib/remote-client";
import {
  formatWait,
  isYouTubeVideoLink,
  YOUTUBE_RATE_LIMIT_WAITS_MS,
} from "../sources/youtube-pacing";
import { BROWSER_MESSAGE, clipText, collectionMessage, YOUTUBE_RELEASE_MESSAGE } from "./copy";
import { classifyQueuedLink, needsBrowser } from "./links";
import type { BatchSummary, DrainHooks, DrainProgress, LinkQueuePatch, SavedLink } from "./types";
import { emptySummary } from "./types";

/** Rows claimed on each pass. The loop claims again until the queue is empty or YouTube backs off. */
export const DESKTOP_CLAIM_LIMIT = 5;

/** After YouTube is still limiting requests, later runs leave YouTube alone this long. */
export const YOUTUBE_COOLDOWN_MS = 5 * 60_000;

// Shared by every run: the next refresh starts a new run within seconds, and without this it
// would claim the videos it just released and ask YouTube again straight away.
let youtubeCooldownUntil = 0;

export function resetYouTubeCooldownForTests(): void {
  youtubeCooldownUntil = 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RowResult = "done" | "stopped" | "youtube_limited";

type ChildTally = {
  saved: number;
  duplicate: number;
  unavailable: number;
  failed: number;
  browser: number;
  firstProblem?: string;
};

type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "stopped" }
  | { ok: false; reason: "youtube_limited" }
  | { ok: false; reason: "error"; error: unknown };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function stopping(hooks: DrainHooks): boolean {
  return hooks.stopped() || hooks.signal.aborted;
}

/**
 * Claims `needs: "desktop"` rows and saves each with the Add links path.
 * One run at a time is the caller's job. This function stops when `stopped()` is set,
 * and stops taking YouTube once a video is still limited after the paced waits.
 */
export async function drainDesktopQueue(hooks: DrainHooks): Promise<BatchSummary> {
  const summary = emptySummary();
  let addedBy: string | null | undefined;
  const note = (row: LinkQueueRow) => {
    const name = row.added_by.trim();
    if (!name) return;
    if (addedBy === undefined) addedBy = name;
    else if (addedBy !== name) addedBy = null;
  };
  const state = { lastWasYouTube: false, progress: null as DrainProgress | null };
  // While YouTube cools down, YouTube rows are released unread and the run makes one pass only:
  // released rows keep their place at the front of the queue and would be claimed again.
  let youtubeLimited = Date.now() < youtubeCooldownUntil;

  const send = async (id: string, body: LinkQueuePatch) => {
    try {
      await hooks.patch(id, body);
    } catch (error) {
      if (isSessionExpiredError(error)) throw error;
      console.warn("Couldn't update a waiting link.", error);
    }
  };

  const release = async (row: LinkQueueRow, message: string | null) => {
    const text = clipText(message);
    await send(idOf(row), text ? { status: "waiting", message: text } : { status: "waiting" });
  };

  const handToBrowser = async (row: LinkQueueRow) => {
    await send(idOf(row), {
      status: "waiting",
      needs: "browser",
      message: BROWSER_MESSAGE,
    });
    summary.browser += 1;
    note(row);
  };

  const fail = async (row: LinkQueueRow, message: string, title?: string | null) => {
    await send(idOf(row), {
      status: "failed",
      message: clipText(message) ?? "Failed to save",
      ...(clipText(title) ? { title: clipText(title) } : {}),
    });
    summary.failed += 1;
    note(row);
  };

  while (!stopping(hooks)) {
    let rows: LinkQueueRow[];
    try {
      rows = await hooks.claim({
        needs: "desktop",
        worker: hooks.worker,
        limit: DESKTOP_CLAIM_LIMIT,
      });
    } catch (error) {
      if (!isSessionExpiredError(error) && !stopping(hooks)) {
        console.warn("Couldn't claim links waiting for this computer.", error);
      }
      break;
    }
    if (rows.length === 0) break;

    const batchAddedBy = oneAddedBy(rows);
    for (let index = 0; index < rows.length; index++) {
      if (stopping(hooks)) {
        for (const rest of rows.slice(index)) await release(rest, rest.message);
        summary.addedBy = addedBy ?? null;
        return summary;
      }
      const row = rows[index]!;
      state.progress = {
        index: index + 1,
        total: rows.length,
        addedBy: batchAddedBy,
        pause: null,
      };
      hooks.onProgress(state.progress);

      if (youtubeLimited && isYouTubeWork(row)) {
        await release(row, YOUTUBE_RELEASE_MESSAGE);
        continue;
      }

      const result = await processRow(row);
      if (result === "stopped") {
        for (const rest of rows.slice(index + 1)) await release(rest, rest.message);
        summary.addedBy = addedBy ?? null;
        return summary;
      }
      if (result === "youtube_limited") {
        youtubeLimited = true;
        youtubeCooldownUntil = Date.now() + YOUTUBE_COOLDOWN_MS;
        summary.youtubeLimited = true;
      }
    }

    if (youtubeLimited || rows.length < DESKTOP_CLAIM_LIMIT) break;
  }

  summary.addedBy = addedBy ?? null;
  return summary;

  async function processRow(row: LinkQueueRow): Promise<RowResult> {
    const kind = classifyQueuedLink(row.url, row.kind);
    if (kind === "x") {
      state.lastWasYouTube = false;
      await handToBrowser(row);
      return "done";
    }
    if (kind === "youtube_list") return processYouTubeList(row);
    if (kind === "publication") {
      state.lastWasYouTube = false;
      return processPublication(row);
    }
    if (kind === "unknown") {
      state.lastWasYouTube = false;
      await fail(row, "That isn't a link Sourcefold can save.");
      return "done";
    }
    return saveSingle(row, isYouTubeVideoLink(row.url));
  }

  async function saveSingle(row: LinkQueueRow, youtube: boolean): Promise<RowResult> {
    if (youtube) {
      const paced = await pace();
      if (!paced) {
        await release(row, row.message);
        return "stopped";
      }
    } else {
      state.lastWasYouTube = false;
    }

    const result = await attempt(youtube, () => hooks.save(row.url, row.folder_id, hooks.signal));
    if (!result.ok) {
      if (result.reason === "stopped") {
        await release(row, row.message);
        return "stopped";
      }
      if (result.reason === "youtube_limited") {
        state.lastWasYouTube = true;
        await release(row, YOUTUBE_RELEASE_MESSAGE);
        return "youtube_limited";
      }
      state.lastWasYouTube = youtube;
      if (needsBrowser(result.error)) {
        await handToBrowser(row);
        return "done";
      }
      await fail(row, errorMessage(result.error, "Failed to save"));
      return "done";
    }

    state.lastWasYouTube = youtube;
    await applySingle(row, result.value);
    return "done";
  }

  async function processYouTubeList(row: LinkQueueRow): Promise<RowResult> {
    const listed = await attempt(true, () => hooks.listYouTube(row.url, hooks.signal));
    state.lastWasYouTube = true;
    if (!listed.ok) {
      if (listed.reason === "stopped") {
        await release(row, row.message);
        return "stopped";
      }
      if (listed.reason === "youtube_limited") {
        await release(row, YOUTUBE_RELEASE_MESSAGE);
        return "youtube_limited";
      }
      if (needsBrowser(listed.error)) {
        await handToBrowser(row);
        return "done";
      }
      await fail(row, errorMessage(listed.error, "Couldn't list the videos."));
      return "done";
    }

    const { title, videos, truncated } = listed.value;
    if (videos.length === 0) {
      await fail(row, "No videos found.", title);
      return "done";
    }

    const tally = emptyTally();
    for (const video of videos) {
      if (stopping(hooks)) {
        await release(row, row.message);
        return "stopped";
      }
      const paced = await pace();
      if (!paced) {
        await release(row, row.message);
        return "stopped";
      }
      const saved = await attempt(true, () => hooks.save(video.url, row.folder_id, hooks.signal));
      if (!saved.ok) {
        if (saved.reason === "stopped") {
          await release(row, row.message);
          return "stopped";
        }
        if (saved.reason === "youtube_limited") {
          await release(row, YOUTUBE_RELEASE_MESSAGE);
          return "youtube_limited";
        }
        noteChildProblem(tally, saved.error);
        continue;
      }
      noteChildOutcome(tally, saved.value);
    }

    await finishCollection(row, title, tally, videos.length, "video", truncated);
    return "done";
  }

  async function processPublication(row: LinkQueueRow): Promise<RowResult> {
    let posts: { url: string; title: string | null }[];
    try {
      if (stopping(hooks)) {
        await release(row, row.message);
        return "stopped";
      }
      posts = (await hooks.listPosts(row.url, hooks.signal)).posts;
    } catch (error) {
      if (stopping(hooks) || isAbortError(error)) {
        await release(row, row.message);
        return "stopped";
      }
      if (needsBrowser(error)) {
        await handToBrowser(row);
        return "done";
      }
      await fail(row, errorMessage(error, "Couldn't list posts."));
      return "done";
    }

    if (posts.length === 0) {
      await fail(row, "No posts found.");
      return "done";
    }

    const tally = emptyTally();
    for (const post of posts) {
      if (stopping(hooks)) {
        await release(row, row.message);
        return "stopped";
      }
      try {
        const outcome = await hooks.save(post.url, row.folder_id, hooks.signal);
        noteChildOutcome(tally, outcome);
      } catch (error) {
        if (stopping(hooks) || isAbortError(error)) {
          await release(row, row.message);
          return "stopped";
        }
        noteChildProblem(tally, error);
      }
    }

    await finishCollection(row, null, tally, posts.length, "post", false);
    return "done";
  }

  function noteChildProblem(tally: ChildTally, error: unknown) {
    if (needsBrowser(error)) {
      tally.browser += 1;
      return;
    }
    tally.failed += 1;
    tally.firstProblem ??= errorMessage(error, "Failed to save");
  }

  function noteChildOutcome(tally: ChildTally, outcome: SavedLink) {
    if (outcome.kind === "saved") {
      tally.saved += 1;
      summary.libraryChanged = true;
      return;
    }
    if (outcome.kind === "duplicate") {
      tally.duplicate += 1;
      return;
    }
    tally.unavailable += 1;
    summary.libraryChanged = true;
    tally.firstProblem ??= outcome.message;
  }

  async function finishCollection(
    row: LinkQueueRow,
    title: string | null,
    tally: ChildTally,
    total: number,
    kind: "video" | "post",
    truncated: boolean,
  ) {
    note(row);
    if (tally.browser === total) {
      await handToBrowser(row);
      return;
    }
    const inLibrary = tally.saved + tally.duplicate;
    const word = total === 1 ? kind : kind === "video" ? "videos" : "posts";
    const titled = clipText(title);
    if (inLibrary === 0) {
      const message = tally.firstProblem ?? `Couldn't save any of the ${total} ${word}.`;
      if (tally.unavailable === total && tally.failed === 0) {
        summary.unavailable += 1;
        await send(idOf(row), {
          status: "unavailable",
          message: clipText(message),
          ...(titled ? { title: titled } : {}),
        });
      } else {
        await fail(row, message, title);
      }
      return;
    }

    const message = collectionMessage(inLibrary, total, kind, truncated);
    if (tally.saved > 0) {
      summary.saved += 1;
      await send(idOf(row), {
        status: "saved",
        message,
        ...(titled ? { title: titled } : {}),
      });
    } else {
      summary.duplicate += 1;
      await send(idOf(row), {
        status: "duplicate",
        message,
        ...(titled ? { title: titled } : {}),
      });
    }
  }

  async function applySingle(row: LinkQueueRow, outcome: SavedLink) {
    note(row);
    const title = clipText(outcome.title ?? undefined);
    if (outcome.kind === "saved") {
      summary.saved += 1;
      summary.libraryChanged = true;
      const itemId = isUuid(outcome.itemId) ? outcome.itemId : undefined;
      await send(idOf(row), {
        status: "saved",
        ...(title ? { title } : {}),
        ...(clipText(outcome.message) ? { message: clipText(outcome.message) } : {}),
        ...(itemId ? { item_id: itemId } : {}),
      });
      return;
    }
    if (outcome.kind === "duplicate") {
      summary.duplicate += 1;
      await send(idOf(row), {
        status: "duplicate",
        message: clipText(outcome.message) ?? "Already saved",
        ...(title ? { title } : {}),
      });
      return;
    }
    summary.unavailable += 1;
    summary.libraryChanged = true;
    await send(idOf(row), {
      status: "unavailable",
      message: clipText(outcome.message) ?? "Not saved",
      ...(title ? { title } : {}),
    });
  }

  /** YouTube videos leave a short gap, then wait 1 minute and 3 minutes on a rate limit. */
  async function attempt<T>(youtube: boolean, run: () => Promise<T>): Promise<Attempt<T>> {
    for (let tryIndex = 0; ; tryIndex++) {
      if (stopping(hooks)) return { ok: false, reason: "stopped" };
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        if (stopping(hooks) || isAbortError(error)) return { ok: false, reason: "stopped" };
        const waitMs =
          youtube && isYouTubeRateLimit(error) ? YOUTUBE_RATE_LIMIT_WAITS_MS[tryIndex] : undefined;
        if (waitMs === undefined) {
          if (youtube && isYouTubeRateLimit(error)) return { ok: false, reason: "youtube_limited" };
          return { ok: false, reason: "error", error };
        }
        const waited = await hooks.wait(
          waitMs,
          () => stopping(hooks),
          (secondsLeft) => {
            if (!state.progress) return;
            hooks.onProgress({ ...state.progress, pause: formatWait(secondsLeft) });
          },
        );
        if (!waited || stopping(hooks)) return { ok: false, reason: "stopped" };
        if (state.progress) hooks.onProgress({ ...state.progress, pause: null });
      }
    }
  }

  async function pace(): Promise<boolean> {
    if (!state.lastWasYouTube) {
      state.lastWasYouTube = true;
      return true;
    }
    const waited = await hooks.wait(hooks.youTubeGapMs(), () => stopping(hooks));
    return waited && !stopping(hooks);
  }
}

function emptyTally(): ChildTally {
  return { saved: 0, duplicate: 0, unavailable: 0, failed: 0, browser: 0 };
}

function idOf(row: LinkQueueRow): string {
  return row.id;
}

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function isYouTubeWork(row: LinkQueueRow): boolean {
  const kind = classifyQueuedLink(row.url, row.kind);
  return kind === "youtube_list" || (kind === "source" && isYouTubeVideoLink(row.url));
}

function oneAddedBy(rows: LinkQueueRow[]): string | null {
  const names = new Set(rows.map((row) => row.added_by.trim()).filter((name) => name.length > 0));
  if (names.size !== 1) return null;
  return [...names][0] ?? null;
}
