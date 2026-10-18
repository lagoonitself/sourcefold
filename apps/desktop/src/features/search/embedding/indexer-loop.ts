// The background loop: while search by meaning is on, take passages that have no vector yet from
// the Rust index, embed them, and store the vectors. All outside calls are injected for tests.

import type { EmbedJob, EmbedVector } from "../search-api";

export const JOB_BATCH_SIZE = 64;
/** When there is nothing to do, look again after this long. */
export const IDLE_RECHECK_MS = 30_000;
/** After an error, wait this long, so a broken model or index can't make the loop spin. */
export const ERROR_BACKOFF_MS = 30_000;

export interface IndexerLoopDeps {
  model: string;
  isEnabled(): boolean;
  getProjectId(): string | null;
  /** Loads the model if it isn't loaded yet; rejects with a readable error if it can't. */
  ensureReady(): Promise<void>;
  isPaused(): Promise<boolean>;
  nextJobs(model: string, limit: number, projectId: string | null): Promise<EmbedJob[]>;
  /** Vectors in the same order as the texts, already cut to 256 values and normalized. */
  embed(texts: string[]): Promise<ArrayLike<number>[]>;
  putVectors(model: string, vectors: EmbedVector[]): Promise<void>;
  /** Lets the page handle input between batches. */
  yieldToUi(): Promise<void>;
  /** Resolves after `ms`, or earlier when `wake` is called. */
  sleep(ms: number, wake: Promise<void>): Promise<void>;
  now(): number;
  onSpeed(passagesPerSecond: number | null): void;
  onError(message: string): void;
  onOk(): void;
  describeError(error: unknown): string;
}

export interface IndexerLoop {
  start(): void;
  /** Stops after the batch in flight; nothing is stored once stopped. */
  stop(): void;
  /** Checks for work now instead of waiting out the idle delay. */
  wake(): void;
  readonly running: boolean;
}

export function createIndexerLoop(deps: IndexerLoopDeps): IndexerLoop {
  let running = false;
  let generation = 0;
  let wakeUp: (() => void) | null = null;
  let smoothed: number | null = null;

  const active = (gen: number) => gen === generation && deps.isEnabled();

  function newWakePromise(): Promise<void> {
    return new Promise<void>((resolve) => {
      wakeUp = resolve;
    });
  }

  async function run(gen: number) {
    while (active(gen)) {
      let delay = IDLE_RECHECK_MS;
      const wake = newWakePromise();
      try {
        await deps.ensureReady();
        if (!active(gen)) break;
        if (!(await deps.isPaused())) {
          const jobs = await deps.nextJobs(deps.model, JOB_BATCH_SIZE, deps.getProjectId());
          if (!active(gen)) break;
          if (jobs.length > 0) {
            const started = deps.now();
            const vectors = await deps.embed(jobs.map((job) => job.input));
            if (!active(gen)) break;
            if (vectors.length !== jobs.length)
              throw new Error("The model returned too few vectors.");
            await deps.putVectors(
              deps.model,
              jobs.map((job, i) => ({
                project_id: job.project_id,
                text_hash: job.text_hash,
                vector: Array.from(vectors[i]),
              })),
            );
            const seconds = Math.max(0.001, (deps.now() - started) / 1000);
            const rate = jobs.length / seconds;
            smoothed = smoothed === null ? rate : smoothed * 0.5 + rate * 0.5;
            deps.onSpeed(smoothed);
            deps.onOk();
            await deps.yieldToUi();
            continue;
          }
        }
        smoothed = null;
        deps.onSpeed(null);
        deps.onOk();
      } catch (error) {
        if (!active(gen)) break;
        smoothed = null;
        deps.onSpeed(null);
        deps.onError(deps.describeError(error));
        delay = ERROR_BACKOFF_MS;
      }
      await deps.sleep(delay, wake);
    }
    if (gen === generation) {
      running = false;
      wakeUp = null;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      void run(generation);
    },
    stop() {
      generation += 1;
      running = false;
      wakeUp?.();
      wakeUp = null;
      deps.onSpeed(null);
    },
    wake() {
      wakeUp?.();
    },
    get running() {
      return running;
    },
  };
}
