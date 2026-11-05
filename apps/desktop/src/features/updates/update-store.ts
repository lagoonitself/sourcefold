/**
 * In-app updates. The app asks the newest GitHub release for `latest.json` (tauri.conf.json →
 * plugins.updater), and when a newer, correctly signed version is there it downloads the
 * installer, runs it and restarts. One store so the startup toast and Settings → General show the
 * same state and never download twice.
 */
import { isTauri } from "@/lib/api";
import { errorMessage } from "@/lib/utils";

type Update = import("@tauri-apps/plugin-updater").Update;

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "restarting"; version: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let pending: Update | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a check or install is running, so a second one doesn't start. */
function busy(): boolean {
  return state.kind === "checking" || state.kind === "downloading" || state.kind === "restarting";
}

/**
 * Asks for a newer version. Returns the version found, or null when this one is the newest.
 * `quiet` keeps a failed check from showing an error (the startup check: no network is normal).
 */
export async function checkForUpdate({ quiet = false } = {}): Promise<string | null> {
  if (!isTauri()) return null;
  if (busy()) return state.kind === "available" ? state.version : null;
  if (state.kind === "available") return state.version;
  const before = state;
  set({ kind: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      pending = null;
      set({ kind: "current", checkedAt: Date.now() });
      return null;
    }
    pending = update;
    set({ kind: "available", version: update.version, notes: update.body ?? null });
    return update.version;
  } catch (err) {
    console.warn("[Sourcefold] Update check failed:", err);
    set(
      quiet
        ? before
        : {
            kind: "error",
            message: errorMessage(err, "Couldn't check for updates. Try again later."),
          },
    );
    return null;
  }
}

/** Downloads and installs the update found by `checkForUpdate`, then restarts the app. */
export async function installUpdate(): Promise<void> {
  if (!pending || state.kind !== "available") return;
  const update = pending;
  const version = update.version;
  let total = 0;
  let received = 0;
  set({ kind: "downloading", version, percent: null });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        set({
          kind: "downloading",
          version,
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
        });
      } else if (event.event === "Finished") {
        set({ kind: "restarting", version });
      }
    });
    set({ kind: "restarting", version });
    // On Windows the installer closes the app itself; elsewhere restart into the new version.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.error("[Sourcefold] Update failed:", err);
    set({ kind: "error", message: errorMessage(err, "Couldn't install the update. Try again.") });
    pending = null;
  }
}

/** This build's version, e.g. "0.6.0". Null outside the desktop app. */
export async function getAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}
