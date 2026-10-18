import { describe, expect, it, vi } from "vitest";
import type { EmbedJob } from "../../search-api";
import {
  ERROR_BACKOFF_MS,
  IDLE_RECHECK_MS,
  createIndexerLoop,
  type IndexerLoopDeps,
} from "../indexer-loop";

const job = (n: number): EmbedJob => ({ project_id: "p1", text_hash: `h${n}`, input: `text ${n}` });
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Deps that never wait for real. `sleep` records its delay, then `onSleep` decides what's next. */
function setup(overrides: Partial<IndexerLoopDeps> = {}, onSleep?: (count: number) => void) {
  let enabled = true;
  const sleeps: number[] = [];
  let clock = 0;
  const deps: IndexerLoopDeps = {
    model: "test/model",
    isEnabled: () => enabled,
    getProjectId: () => "p1",
    ensureReady: async () => {},
    isPaused: async () => false,
    nextJobs: async () => [],
    embed: async (texts) => texts.map(() => [0.5, 0.5]),
    putVectors: async () => {},
    yieldToUi: async () => {},
    sleep: async (ms) => {
      sleeps.push(ms);
      onSleep?.(sleeps.length);
    },
    now: () => (clock += 1000),
    onSpeed: () => {},
    onError: () => {},
    onOk: () => {},
    describeError: (e) => String((e as Error).message),
    ...overrides,
  };
  return { deps, sleeps, disable: () => (enabled = false) };
}

describe("indexer loop", () => {
  it("embeds the jobs and posts vectors with the model key", async () => {
    const batches = [[job(1), job(2)], []];
    const put = vi.fn(async () => {});
    const ctl = setup({ nextJobs: async () => batches.shift() ?? [], putVectors: put });
    ctl.deps.sleep = async () => {
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("test/model", [
      { project_id: "p1", text_hash: "h1", vector: [0.5, 0.5] },
      { project_id: "p1", text_hash: "h2", vector: [0.5, 0.5] },
    ]);
  });

  it("asks for jobs of the open project, 64 at a time", async () => {
    const next = vi.fn(async () => [] as EmbedJob[]);
    const ctl = setup({ nextJobs: next });
    ctl.deps.sleep = async () => {
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(next).toHaveBeenCalledWith("test/model", 64, "p1");
  });

  it("waits 30 seconds when there is nothing to embed", async () => {
    const ctl = setup();
    const record = ctl.deps.sleep;
    ctl.deps.sleep = async (ms, wake) => {
      await record(ms, wake);
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(ctl.sleeps).toEqual([IDLE_RECHECK_MS]);
  });

  it("reports the speed, then none once idle", async () => {
    const speeds: (number | null)[] = [];
    const batches = [[job(1), job(2), job(3), job(4)], []];
    const ctl = setup({
      nextJobs: async () => batches.shift() ?? [],
      onSpeed: (s) => speeds.push(s),
    });
    ctl.deps.sleep = async () => {
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(speeds[0]).toBe(4); // 4 passages in 1 second
    expect(speeds.at(-1)).toBeNull();
  });

  it("stops when disabled and stores nothing from the batch in flight", async () => {
    let release: (v: number[][]) => void = () => {};
    const put = vi.fn(async () => {});
    const ctl = setup({
      nextJobs: async () => [job(1)],
      embed: () => new Promise((resolve) => (release = resolve)),
      putVectors: put,
    });
    const loop = createIndexerLoop(ctl.deps);
    loop.start();
    await settle();
    ctl.disable();
    loop.stop();
    release([[1, 0]]);
    await settle();
    expect(put).not.toHaveBeenCalled();
    expect(loop.running).toBe(false);
  });

  it("does nothing while indexing is paused", async () => {
    const next = vi.fn(async () => [job(1)]);
    const ctl = setup({ isPaused: async () => true, nextJobs: next });
    ctl.deps.sleep = async () => {
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(next).not.toHaveBeenCalled();
  });

  it("backs off 30 seconds after an error instead of spinning", async () => {
    const errors: string[] = [];
    const calls = vi.fn(async (): Promise<EmbedJob[]> => {
      throw new Error("Couldn't reach the index.");
    });
    const ctl = setup({ nextJobs: calls, onError: (m) => errors.push(m) });
    ctl.deps.sleep = async (ms) => {
      ctl.sleeps.push(ms);
      if (ctl.sleeps.length >= 2) ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(errors[0]).toBe("Couldn't reach the index.");
    expect(ctl.sleeps).toEqual([ERROR_BACKOFF_MS, ERROR_BACKOFF_MS]);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("backs off when the model can't load", async () => {
    const ctl = setup({
      ensureReady: async () => {
        throw new Error("Couldn't download the model. Check your connection and try again.");
      },
    });
    ctl.deps.sleep = async (ms) => {
      ctl.sleeps.push(ms);
      ctl.disable();
    };
    createIndexerLoop(ctl.deps).start();
    await settle();
    expect(ctl.sleeps).toEqual([ERROR_BACKOFF_MS]);
  });

  it("wakes from the idle wait when asked", async () => {
    const next = vi.fn(async () => [] as EmbedJob[]);
    let woken = 0;
    const ctl = setup({ nextJobs: next });
    ctl.deps.sleep = (_ms, wake) =>
      wake.then(() => {
        woken += 1;
        ctl.disable();
      });
    const loop = createIndexerLoop(ctl.deps);
    loop.start();
    await settle();
    expect(next).toHaveBeenCalledTimes(1);
    expect(woken).toBe(0);
    loop.wake();
    await settle();
    expect(woken).toBe(1);
  });
});
