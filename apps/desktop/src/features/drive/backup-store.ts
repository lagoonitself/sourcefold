import * as React from "react";

// Whether the library is also backed up to Google Drive. While it is off, the Save to Drive
// button, its shortcut and the unsaved count are hidden. The Drive status (every 30 s and on focus)
// and Settings → Backup feed this; until the first answer arrives it counts as on, so nothing
// flickers away for people who never turned it off.

let backupEnabled = true;
const listeners = new Set<() => void>();

export function getBackupEnabled(): boolean {
  return backupEnabled;
}

export function setBackupEnabledState(next: boolean): void {
  if (next === backupEnabled) return;
  backupEnabled = next;
  for (const listener of listeners) listener();
}

export function subscribeBackupEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBackupEnabled(): boolean {
  return React.useSyncExternalStore(subscribeBackupEnabled, getBackupEnabled, getBackupEnabled);
}
