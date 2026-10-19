import type { WebApi } from "../web-api";
import { ApiError } from "../web-api";
import { saveToDrive } from "./drive";

export const autosaveTiming = {
  debounceMs: 120_000,
  budgetMs: 300_000,
};

let timer: NodeJS.Timeout | null = null;
let running = false;
let queuedAfterRun = false;
let currentApi: WebApi | null = null;

export function resetAutosaveForTests(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  running = false;
  queuedAfterRun = false;
  currentApi = null;
}

export function isAutosaveRunningForTests(): boolean {
  return running;
}

async function runAutosave(): Promise<void> {
  if (running) {
    queuedAfterRun = true;
    return;
  }
  const api = currentApi;
  if (!api) return;

  running = true;
  try {
    let connected = true;
    try {
      const status = await api.get<{ connected?: boolean }>("/drive/status");
      if (status.connected === false) {
        connected = false;
      }
    } catch (err) {
      console.error(
        `[sourcefold] drive autosave: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    if (!connected) return;

    try {
      await saveToDrive(api, { budgetMs: autosaveTiming.budgetMs, waitOnBusy: false });
    } catch (err) {
      if (err instanceof ApiError && err.code === "sync_in_progress") {
        return;
      }
      console.error(
        `[sourcefold] drive autosave: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } catch (err) {
    console.error(
      `[sourcefold] drive autosave: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    running = false;
    if (queuedAfterRun) {
      queuedAfterRun = false;
      void runAutosave();
    }
  }
}

/**
 * Debounced background save to Google Drive after changes to the library.
 * Safe to call repeatedly; batches up into one save after changes quiet down.
 */
export function scheduleDriveSave(api: WebApi): void {
  try {
    const creds = api.credentials?.();
    const isHarnessApi =
      creds?.webUrl?.includes("sourcefold.test") || creds?.webUrl === "https://sourcefold.test";
    const isRealTimersInTest =
      (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined) &&
      typeof (setTimeout as any).clock === "undefined";

    if (isHarnessApi || isRealTimersInTest) {
      return;
    }

    currentApi = api;
    if (running) {
      queuedAfterRun = true;
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void runAutosave();
    }, autosaveTiming.debounceMs);
    timer.unref?.();
  } catch (err) {
    console.error(
      `[sourcefold] drive autosave: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
