import type { CaptureResult } from "../capture-page";
import { pageKindOf } from "../page-kind";
import {
  TAB_CLOSED_MESSAGE,
  TIMEOUT_MESSAGE,
  allowMessage,
  clip,
  isAllowMessage,
  hostOf,
  originPattern,
  signInMessage,
} from "./copy";
import { patchBodyForOutcome, type SaveOutcome } from "./save-page";
import {
  EMPTY_LINK_QUEUE_STATE,
  type LinkQueuePatch,
  type LinkQueueRow,
  type LinkQueueState,
} from "./types";

/** One capture attempt, or nothing if the time budget ran out first. */
export type CaptureRead = CaptureResult | null;

export interface LinkQueueDeps {
  /** Signed in with Google here, or with the desktop app's sign-in. */
  signedIn: () => Promise<boolean>;
  /** The desktop app answers a ping. The queue does not run without it. */
  desktopReachable: () => Promise<boolean>;
  workerId: () => Promise<string>;
  api: {
    claim: (worker: string) => Promise<LinkQueueRow[]>;
    patch: (id: string, body: LinkQueuePatch) => Promise<void>;
    listOpen: () => Promise<LinkQueueRow[]>;
    listRecent: () => Promise<LinkQueueRow[]>;
  };
  permissionsContains: (origins: string[]) => Promise<boolean>;
  openTab: (url: string) => Promise<number>;
  closeTab: (tabId: number) => Promise<void>;
  /** Resolves "complete", or "timeout" / "closed" without leaving the tab open. */
  waitForLoad: (tabId: number, timeoutMs: number) => Promise<"complete" | "timeout" | "closed">;
  capture: (tabId: number) => Promise<CaptureResult>;
  needsSignIn: (tabId: number, url: string) => Promise<boolean>;
  save: (url: string, folderId: string, captured: CaptureResult) => Promise<SaveOutcome>;
  readState: () => Promise<LinkQueueState>;
  writeState: (state: LinkQueueState) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  /** Whole open-and-save budget for one row. */
  timeoutMs: number;
  /** Pause between two links. */
  paceMs: number;
  /** How long to wait before asking an X page again, until the post is in the DOM. */
  pollMs: number;
}

const X_PENDING = ["Couldn't find the post on this page.", "Couldn't read this X page."];

/** X renders after `complete`. Keep asking until the post is there, or the page is something else. */
export function captureIsPending(url: string, captured: CaptureResult): boolean {
  const xPage = pageKindOf(url) === "x" || captured.kind === "x";
  if (!xPage) return false;
  if (captured.kind === "unsupported") return true;
  if (captured.kind !== "x" || captured.result.status !== "error") return false;
  const message = captured.result.message;
  return X_PENDING.some((prefix) => message.startsWith(prefix));
}

function browserRows(rows: LinkQueueRow[]): LinkQueueRow[] {
  return rows.filter(
    (row) => row.needs === "browser" && (row.status === "waiting" || row.status === "working"),
  );
}

function failedRows(rows: LinkQueueRow[]): LinkQueueRow[] {
  return rows.filter((row) => row.needs === "browser" && row.status === "failed");
}

/** Set aside until the user allows the site (failed, so the claim skips them). */
function waitingForAllow(rows: LinkQueueRow[]): LinkQueueRow[] {
  return failedRows(rows).filter((row) => isAllowMessage(row.message));
}

function dedupe(rows: LinkQueueRow[]): LinkQueueRow[] {
  const seen = new Set<string>();
  const out: LinkQueueRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

async function permissionState(
  rows: LinkQueueRow[],
  contains: (origins: string[]) => Promise<boolean>,
): Promise<LinkQueueState["permission"]> {
  const blocked: LinkQueueRow[] = [];
  const decided = new Map<string, boolean>();
  for (const row of dedupe(rows)) {
    const origin = originPattern(row.url);
    if (!origin) continue;
    let allowed = decided.get(origin);
    if (allowed === undefined) {
      allowed = await contains([origin]).catch(() => false);
      decided.set(origin, allowed);
    }
    if (!allowed) blocked.push(row);
  }
  if (!blocked.length) return null;
  const hosts: string[] = [];
  const origins: string[] = [];
  for (const row of blocked) {
    const host = hostOf(row.url);
    const origin = originPattern(row.url);
    if (host && !hosts.includes(host)) hosts.push(host);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  return { count: blocked.length, hosts, origins };
}

async function publish(
  deps: LinkQueueDeps,
  progress: LinkQueueState["progress"],
  extraBlocked: LinkQueueRow[],
): Promise<void> {
  const previous = await deps.readState().catch(() => EMPTY_LINK_QUEUE_STATE);
  const open = await deps.api.listOpen().then(
    (rows) => rows,
    () => null,
  );
  const recent = await deps.api.listRecent().then(
    (rows) => rows,
    () => null,
  );

  let permission = previous.permission;
  if (open || extraBlocked.length) {
    permission = await permissionState(
      [...(open ?? []), ...(recent ? waitingForAllow(recent) : []), ...extraBlocked],
      deps.permissionsContains,
    );
  }

  let failed = previous.failed;
  if (recent) {
    const rows = failedRows(recent).filter((row) => !isAllowMessage(row.message));
    failed = rows.length
      ? { count: rows.length, message: rows.length === 1 ? (rows[0]?.message ?? null) : null }
      : null;
  }

  await deps.writeState({ permission, progress, failed });
}

async function clearProgress(deps: LinkQueueDeps): Promise<void> {
  const current = await deps.readState().catch(() => EMPTY_LINK_QUEUE_STATE);
  if (!current.progress) return;
  await deps.writeState({ ...current, progress: null });
}

async function captureWithin(
  deps: LinkQueueDeps,
  tabId: number,
  budgetMs: number,
): Promise<CaptureRead> {
  if (budgetMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deps.capture(tabId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), budgetMs);
      }),
    ]);
  } catch {
    return { kind: "unsupported" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type ReadResult =
  { type: "capture"; captured: CaptureResult } | { type: "sign-in" } | { type: "timeout" };

async function readPage(
  deps: LinkQueueDeps,
  tabId: number,
  url: string,
  remaining: () => number,
): Promise<ReadResult> {
  let captured = await captureWithin(deps, tabId, remaining());
  if (!captured) return { type: "timeout" };

  let polls = 0;
  while (captureIsPending(url, captured) && polls < 40 && remaining() > 400) {
    if (await deps.needsSignIn(tabId, url)) return { type: "sign-in" };
    polls += 1;
    const wait = Math.min(deps.pollMs, Math.max(0, remaining() - 200));
    if (wait > 0) await deps.sleep(wait);
    else await deps.sleep(0);
    const next = await captureWithin(deps, tabId, remaining());
    if (!next) return { type: "timeout" };
    captured = next;
  }

  if (captured.kind === "x" && captured.result.status === "error") {
    if (await deps.needsSignIn(tabId, url)) return { type: "sign-in" };
  }
  if (captureIsPending(url, captured) && remaining() <= 400) return { type: "timeout" };
  return { type: "capture", captured };
}

/**
 * Opens one claimed row, saves it the way the popup would, and always closes the tab.
 * Returns "permission" when the origin isn't granted: the row is waiting again, and this
 * run must stop or the next claim would take the same row.
 */
async function processRow(
  deps: LinkQueueDeps,
  row: LinkQueueRow,
  onProgress: (row: LinkQueueRow) => Promise<void>,
): Promise<"next" | "permission"> {
  const origin = originPattern(row.url);
  const host = hostOf(row.url) || "this site";
  if (!origin) {
    await deps.api.patch(row.id, { status: "failed", message: "This page can't be saved." });
    return "next";
  }
  const allowed = await deps.permissionsContains([origin]);
  if (!allowed) {
    // Set aside as failed, not released: a released row is claimed first again every time, and
    // enough of them would fill every claim and hold up links for sites already allowed.
    // Allow in the popup sends "retry", which puts these back in line.
    await deps.api.patch(row.id, {
      status: "failed",
      message: clip(allowMessage(host)),
    });
    return "permission";
  }

  await onProgress(row);

  let tabId: number | undefined;
  const started = Date.now();
  const remaining = () => deps.timeoutMs - (Date.now() - started);
  try {
    tabId = await deps.openTab(row.url);
    const grokipedia = pageKindOf(row.url) === "grokipedia";
    if (grokipedia) {
      await deps.waitForLoad(tabId, Math.max(0, remaining()));
      const outcome = await deps.save(row.url, row.folder_id, { kind: "unsupported" });
      // A failed report leaves the row working. The next claim saves it again and hears "duplicate".
      await deps.api.patch(row.id, patchBodyForOutcome(outcome)).catch(() => {});
      return "next";
    }

    const loaded = await deps.waitForLoad(tabId, Math.max(0, remaining()));
    if (loaded !== "complete") {
      await deps.api.patch(row.id, {
        status: "failed",
        message: loaded === "closed" ? TAB_CLOSED_MESSAGE : TIMEOUT_MESSAGE,
      });
      return "next";
    }

    const read = await readPage(deps, tabId, row.url, remaining);
    if (read.type === "sign-in") {
      await deps.api.patch(row.id, { status: "failed", message: clip(signInMessage(host)) });
      return "next";
    }
    if (read.type === "timeout") {
      await deps.api.patch(row.id, { status: "failed", message: TIMEOUT_MESSAGE });
      return "next";
    }
    const outcome = await deps.save(row.url, row.folder_id, read.captured);
    await deps.api.patch(row.id, patchBodyForOutcome(outcome)).catch(() => {});
    return "next";
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Couldn't save this page.";
    await deps.api.patch(row.id, { status: "failed", message: clip(message) }).catch(() => {});
    return "next";
  } finally {
    if (tabId != null) await deps.closeTab(tabId).catch(() => {});
  }
}

async function drain(deps: LinkQueueDeps): Promise<void> {
  if (!(await deps.desktopReachable())) {
    await clearProgress(deps);
    return;
  }
  if (!(await deps.signedIn())) {
    await clearProgress(deps);
    return;
  }

  const listed = await deps.api.listOpen().then(
    (rows) => rows,
    () => null,
  );
  const total = listed ? browserRows(listed).length : 0;
  let index = 0;
  let addedBy: string | null = null;
  const released: LinkQueueRow[] = [];
  // Rows released this run for a missing permission. They go back to waiting and come first in the
  // next claim, so they are handed straight back; a claim of nothing but those ends the run.
  const releasedIds = new Set<string>();
  let processed = 0;

  try {
    while (true) {
      if (!(await deps.desktopReachable()) || !(await deps.signedIn())) break;

      let claimed: LinkQueueRow[];
      try {
        claimed = await deps.api.claim(await deps.workerId());
      } catch {
        break;
      }
      if (!claimed.length) break;

      let openedThisPass = 0;
      for (let i = 0; i < claimed.length; i++) {
        const row = claimed[i];
        if (!row) continue;
        if (releasedIds.has(row.id)) {
          await deps.api.patch(row.id, { status: "waiting" }).catch(() => {});
          continue;
        }
        if (!(await deps.desktopReachable()) || !(await deps.signedIn())) {
          // Hand back what this claim still holds, or it would stay `working` for ten minutes.
          for (const other of claimed.slice(i)) {
            await deps.api.patch(other.id, { status: "waiting" }).catch(() => {});
          }
          return;
        }
        const result = await processRow(deps, row, async (current) => {
          index += 1;
          addedBy ??= current.added_by;
          await publish(deps, { index, total: Math.max(total, index), addedBy }, released);
        });
        if (result === "permission") {
          releasedIds.add(row.id);
          released.push({ ...row, status: "waiting", needs: "browser" });
          continue;
        }
        openedThisPass += 1;
        processed += 1;
      }
      if (openedThisPass === 0) break;

      if (processed > 0 && deps.paceMs > 0) await deps.sleep(deps.paceMs);
    }
  } finally {
    await publish(deps, null, released);
  }
}

export interface LinkQueueController {
  run: () => Promise<void>;
  retryFailed: () => Promise<void>;
}

/** One drain at a time. A kick during a drain runs once more when it finishes. */
export function createLinkQueueController(deps: LinkQueueDeps): LinkQueueController {
  let running = false;
  let rerun = false;

  const run = async (): Promise<void> => {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      do {
        rerun = false;
        await drain(deps);
      } while (rerun);
    } finally {
      running = false;
    }
  };

  return {
    run,
    retryFailed: async () => {
      const recent = await deps.api.listRecent();
      for (const row of failedRows(recent)) {
        await deps.api.patch(row.id, { status: "waiting", needs: "browser" });
      }
      await run();
    },
  };
}
