// What a link waiting in `link_queue` is waiting for, in words a person can act on. The desktop
// app, the Chrome extension and Claude's get_add_progress all describe links with this, so they
// never disagree (docs/dev/PLAN-link-status.md).

/** The parts of a `link_queue` row this needs. */
export interface QueuedLinkInfo {
  needs: "desktop" | "browser";
  status: "waiting" | "working" | "saved" | "duplicate" | "unavailable" | "failed" | "cancelled";
  message: string | null;
  claimed_by?: string | null;
}

/** Last check-ins from `GET /api/link-queue/workers`. */
export interface LinkWorkersSeen {
  /** Newest check-in of any desktop app, ISO time, or null. */
  desktop_seen_at: string | null;
  /** Newest check-in of any extension, ISO time, or null. */
  extension_seen_at: string | null;
  /** Whether that newest extension could work the queue (signed in and reaching the desktop). */
  extension_can_run: boolean;
}

export const NO_WORKERS_SEEN: LinkWorkersSeen = {
  desktop_seen_at: null,
  extension_seen_at: null,
  extension_can_run: false,
};

/**
 * A worker counts as running when it checked in this recently. The desktop checks in every
 * 60 s and the extension every 30 s; two missed check-ins still count.
 */
export const WORKER_ALIVE_MS = 150_000;

export type LinkState =
  | "waiting_desktop" // the desktop app isn't open
  | "waiting_chrome" // the desktop is open, Chrome (with the extension) isn't
  | "waiting_both" // a Chrome link, and neither is open
  | "up_next" // its helper is running; it'll be saved within a minute or two
  | "saving"
  | "needs_allow" // the extension needs the person's OK to open this site
  | "needs_sign_in" // the site asked to sign in, in Chrome
  | "saved"
  | "duplicate"
  | "unavailable"
  | "failed"
  | "cancelled";

export interface LinkStatus {
  state: LinkState;
  /** Short, for a list row or a badge tooltip: "Saved", "Waiting for Chrome". */
  label: string;
  /** One sentence on what happens next or what to do. Empty when there is nothing to add. */
  hint: string;
  /** The person has to do something before this link can be saved. */
  needsYou: boolean;
  /** Finished, one way or another. */
  done: boolean;
}

/** Rows the extension set aside until its site is allowed carry this (apps/extension copy.ts). */
export function isAllowLinkMessage(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith("Allow Sourcefold to open "));
}

/** Rows that stopped at a sign-in page carry this. */
export function isSignInLinkMessage(message: string | null | undefined): boolean {
  return Boolean(message && /^Sign in to .+ in Chrome/.test(message));
}

function aliveAt(seenAt: string | null, now: number): boolean {
  if (!seenAt) return false;
  const time = Date.parse(seenAt);
  return Number.isFinite(time) && now - time <= WORKER_ALIVE_MS;
}

export interface WorkersAlive {
  desktop: boolean;
  /** Chrome is open with the extension, signed in, and reaching the desktop app. */
  chrome: boolean;
  /** Chrome is open with the extension, but it can't work the queue yet. */
  chromeIdle: boolean;
}

export function workersAlive(seen: LinkWorkersSeen, now = Date.now()): WorkersAlive {
  const desktop = aliveAt(seen.desktop_seen_at, now);
  const extension = aliveAt(seen.extension_seen_at, now);
  return {
    desktop,
    chrome: extension && seen.extension_can_run && desktop,
    chromeIdle: extension && !(seen.extension_can_run && desktop),
  };
}

const DESKTOP = "the Sourcefold desktop app";
const CHROME = "Chrome with the Sourcefold extension";

/**
 * `seen` is null when check-ins can't be read (an older server without `link_workers`): waiting
 * links are then described without saying whether their helper is running.
 */
export function describeQueuedLink(
  row: QueuedLinkInfo,
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): LinkStatus {
  const alive = seen ? workersAlive(seen, now) : null;
  const chromeLink = row.needs === "browser";
  const finished = (state: LinkState, label: string, hint = ""): LinkStatus => ({
    state,
    label,
    hint,
    needsYou: false,
    done: true,
  });

  switch (row.status) {
    case "saved":
      return finished("saved", "Saved");
    case "duplicate":
      return finished("duplicate", "Already saved", "It was already in this group.");
    case "unavailable":
      return finished("unavailable", "Nothing to save", row.message ?? "");
    case "cancelled":
      return finished("cancelled", "Cancelled");
    case "failed":
      if (isAllowLinkMessage(row.message)) {
        return {
          state: "needs_allow",
          label: "Needs your OK in Chrome",
          hint: "Open the Sourcefold extension in Chrome and click Allow.",
          needsYou: true,
          done: false,
        };
      }
      if (isSignInLinkMessage(row.message)) {
        return {
          state: "needs_sign_in",
          label: "Sign in needed in Chrome",
          hint: `${row.message}.`.replace(/\.\.$/, "."),
          needsYou: true,
          done: false,
        };
      }
      return {
        state: "failed",
        label: "Couldn't save",
        hint: row.message ? `${row.message} Retry to try again.` : "Retry to try again.",
        needsYou: true,
        done: false,
      };
    case "working":
      return {
        state: "saving",
        label: chromeLink ? "Saving in Chrome" : "Saving on your computer",
        hint: "",
        needsYou: false,
        done: false,
      };
    case "waiting":
    default:
      break;
  }

  if (!alive) {
    return {
      state: chromeLink ? "waiting_chrome" : "waiting_desktop",
      label: chromeLink ? "Waiting for Chrome" : "Waiting for your computer",
      hint: chromeLink
        ? `It's saved while ${DESKTOP} and ${CHROME} are open.`
        : `It's saved while ${DESKTOP} is open.`,
      needsYou: false,
      done: false,
    };
  }

  if (!chromeLink) {
    if (alive.desktop) {
      return {
        state: "up_next",
        label: "Up next",
        hint: "Your desktop app will save it in a moment.",
        needsYou: false,
        done: false,
      };
    }
    return {
      state: "waiting_desktop",
      label: "Waiting for the desktop app",
      hint: `Open ${DESKTOP} on your computer to save it.`,
      needsYou: true,
      done: false,
    };
  }

  if (alive.chrome) {
    return {
      state: "up_next",
      label: "Up next",
      hint: "Chrome will save it in a moment.",
      needsYou: false,
      done: false,
    };
  }
  if (!alive.desktop) {
    return {
      state: alive.chromeIdle ? "waiting_desktop" : "waiting_both",
      label: alive.chromeIdle ? "Waiting for the desktop app" : "Waiting for the desktop app and Chrome",
      hint: alive.chromeIdle
        ? `Chrome is ready. Open ${DESKTOP} too: Chrome saves these only while it's open.`
        : `Open ${DESKTOP} and ${CHROME} to save it.`,
      needsYou: true,
      done: false,
    };
  }
  return {
    state: "waiting_chrome",
    label: "Waiting for Chrome",
    hint: alive.chromeIdle
      ? "Chrome is open but the Sourcefold extension isn't signed in. Open it and sign in."
      : `Open ${CHROME} to save it.`,
    needsYou: true,
    done: false,
  };
}

export interface LinkStatusSummary {
  total: number;
  saved: number;
  /** Saved, already saved, nothing to save or cancelled. */
  done: number;
  /** Waiting with its helper running, or being saved now. */
  moving: number;
  /** Waiting on the person (open an app, Allow, sign in, Retry). */
  needsYou: number;
  /** The one thing to do first, when something needs the person; null otherwise. */
  nextStep: string | null;
}

const NEXT_STEP_ORDER: LinkState[] = [
  "waiting_both",
  "waiting_desktop",
  "waiting_chrome",
  "needs_allow",
  "needs_sign_in",
  "failed",
];

export function summarizeLinks(
  rows: QueuedLinkInfo[],
  seen: LinkWorkersSeen | null,
  now = Date.now(),
): LinkStatusSummary {
  const statuses = rows.map((row) => describeQueuedLink(row, seen, now));
  let nextStep: string | null = null;
  for (const state of NEXT_STEP_ORDER) {
    const first = statuses.find((s) => s.state === state);
    if (first) {
      nextStep = first.hint;
      break;
    }
  }
  return {
    total: statuses.length,
    saved: statuses.filter((s) => s.state === "saved").length,
    done: statuses.filter((s) => s.done).length,
    moving: statuses.filter((s) => s.state === "up_next" || s.state === "saving").length,
    needsYou: statuses.filter((s) => s.needsYou).length,
    nextStep,
  };
}
