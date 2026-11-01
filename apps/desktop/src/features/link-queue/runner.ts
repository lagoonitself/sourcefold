import { isSessionExpiredError } from "@/lib/remote-client";
import type { BatchSummary } from "./types";

export interface RunContext {
  stopped(): boolean;
  signal: AbortSignal;
}

/**
 * Starts a drain on demand and ignores a second start while one is in progress.
 * `stop()` aborts the run (sign-out, or the status unmounting).
 */
export function createLinkQueueRunner(
  run: (ctx: RunContext) => Promise<BatchSummary>,
  options: {
    signedIn(): boolean;
    onFinished(summary: BatchSummary): void;
  },
) {
  let running = false;
  let stopRequested = false;
  let controller: AbortController | null = null;

  async function start(): Promise<void> {
    if (running || stopRequested || !options.signedIn()) return;
    running = true;
    stopRequested = false;
    controller = new AbortController();
    const signal = controller.signal;
    try {
      const summary = await run({
        stopped: () => stopRequested || !options.signedIn(),
        signal,
      });
      if (!stopRequested && options.signedIn()) options.onFinished(summary);
    } catch (error) {
      if (!isSessionExpiredError(error)) {
        console.warn("Saving links from the queue failed.", error);
      }
    } finally {
      running = false;
      controller = null;
    }
  }

  return {
    start,
    stop() {
      stopRequested = true;
      controller?.abort();
    },
    get running() {
      return running;
    },
  };
}
