// The switch in Settings and the live status of search by meaning, as a small subscribable store.

import type { MeaningSearchInfo } from "./types";

export const MEANING_STORAGE_KEY = "sourcefold:searchMeaning";

export function readEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(MEANING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean) {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled) localStorage.setItem(MEANING_STORAGE_KEY, "1");
    else localStorage.removeItem(MEANING_STORAGE_KEY);
  } catch {
    // Private mode or a full disk: the switch then lasts until the app closes.
  }
}

function initialInfo(): MeaningSearchInfo {
  const enabled = readEnabled();
  return {
    enabled,
    state: enabled ? "loading" : "off",
    device: null,
    progress: null,
    message: null,
    passagesPerSecond: null,
  };
}

let info: MeaningSearchInfo = initialInfo();
const listeners = new Set<() => void>();

export function getInfo(): MeaningSearchInfo {
  return info;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Replaces the info object (so React sees a change) only when a value really differs. */
export function patchInfo(patch: Partial<MeaningSearchInfo>) {
  const changed = (Object.keys(patch) as (keyof MeaningSearchInfo)[]).some(
    (key) => info[key] !== patch[key],
  );
  if (!changed) return;
  info = { ...info, ...patch };
  for (const listener of [...listeners]) listener();
}

export function setEnabled(enabled: boolean) {
  writeEnabled(enabled);
  if (enabled) {
    patchInfo({ enabled: true, state: "loading", message: null, progress: null });
  } else {
    patchInfo({
      enabled: false,
      state: "off",
      device: null,
      progress: null,
      message: null,
      passagesPerSecond: null,
    });
  }
}

/** Test helper: back to the stored state. */
export function resetStore() {
  info = initialInfo();
  for (const listener of [...listeners]) listener();
}
