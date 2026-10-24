// TL;DR settings kept in this webview (the model choice and keys live in Rust).
import * as React from "react";

const KEY = "sourcefold:tldr";

export interface TldrPrefs {
  /** Write a TL;DR for every new save. */
  auto: boolean;
  /** Show the gist under each source's title in the list. */
  showInList: boolean;
  /** The TL;DR pane beside the list. */
  paneOpen: boolean;
  /**
   * When the feature first ran (ISO). Only sources saved after this count as new saves, so the
   * backlog is never written without the user picking its groups.
   */
  startedAt: string;
  /** Groups whose older sources the user asked TL;DRs for, until each is done. */
  pickedGroups: string[];
}

function defaults(): TldrPrefs {
  return {
    auto: true,
    showInList: true,
    paneOpen: true,
    startedAt: new Date().toISOString(),
    pickedGroups: [],
  };
}

function read(): TldrPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TldrPrefs>;
      const base = defaults();
      return {
        auto: typeof parsed.auto === "boolean" ? parsed.auto : base.auto,
        showInList: typeof parsed.showInList === "boolean" ? parsed.showInList : base.showInList,
        paneOpen: typeof parsed.paneOpen === "boolean" ? parsed.paneOpen : base.paneOpen,
        startedAt:
          typeof parsed.startedAt === "string" && !Number.isNaN(Date.parse(parsed.startedAt))
            ? parsed.startedAt
            : base.startedAt,
        pickedGroups: Array.isArray(parsed.pickedGroups)
          ? parsed.pickedGroups.filter((g): g is string => typeof g === "string")
          : [],
      };
    }
  } catch {
    // fall through to defaults
  }
  const fresh = defaults();
  write(fresh);
  return fresh;
}

function write(prefs: TldrPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage full or blocked; keep the in-memory copy
  }
}

let current: TldrPrefs | null = null;
const listeners = new Set<() => void>();

export function getTldrPrefs(): TldrPrefs {
  if (!current) current = read();
  return current;
}

export function updateTldrPrefs(patch: Partial<TldrPrefs>): void {
  current = { ...getTldrPrefs(), ...patch };
  write(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTldrPrefs(): TldrPrefs {
  return React.useSyncExternalStore(subscribe, getTldrPrefs, getTldrPrefs);
}
