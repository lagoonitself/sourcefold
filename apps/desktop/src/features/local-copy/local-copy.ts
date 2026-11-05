import { isTauri } from "@/lib/api";

// Signed in, the desktop keeps a copy of every file on this computer, in the storage folder, laid
// out like Drive (docs/FILE-FORMAT.md). The work happens in Rust (src-tauri/src/local_copy.rs).

export interface LocalCopyFailure {
  path: string;
  message: string;
}

export interface LocalCopyReport {
  status: "done" | "busy" | "off";
  folder: string;
  total: number;
  written: number;
  moved: number;
  removed: number;
  failed: LocalCopyFailure[];
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

let lastReport: LocalCopyReport | null = null;
let lastRunAt: Date | null = null;
const listeners = new Set<() => void>();

export function getLastLocalCopy(): { report: LocalCopyReport | null; at: Date | null } {
  return { report: lastReport, at: lastRunAt };
}

export function onLocalCopyChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let running: Promise<LocalCopyReport | null> | null = null;
let again = false;

async function runOnce(): Promise<LocalCopyReport> {
  const report = await tauriInvoke<LocalCopyReport>("sync_local_copy");
  if (report.status !== "busy") {
    lastReport = report;
    lastRunAt = new Date();
    listeners.forEach((l) => l());
  }
  return report;
}

/**
 * Brings the copy on this computer up to date. Asked while a run is going (a change arrived from
 * another computer mid-run), it runs once more afterwards instead of dropping the request, so the
 * newest change always lands. Many asks during one run still make only one more run.
 */
export function syncLocalCopy(): Promise<LocalCopyReport | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let report: LocalCopyReport;
      do {
        again = false;
        report = await runOnce();
      } while (again);
      return report;
    } finally {
      running = null;
    }
  })();
  return running;
}

export function getLocalCopyEnabled(): Promise<boolean> {
  return isTauri() ? tauriInvoke<boolean>("get_local_copy_enabled") : Promise.resolve(false);
}

export function setLocalCopyEnabled(enabled: boolean): Promise<void> {
  return tauriInvoke<void>("set_local_copy_enabled", { enabled });
}

export function openStorageFolder(): Promise<void> {
  return tauriInvoke<void>("open_storage_folder");
}
