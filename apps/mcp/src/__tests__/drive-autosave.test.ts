import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebApi } from "../web-api";
import { ApiError } from "../web-api";
import { autosaveTiming, resetAutosaveForTests, scheduleDriveSave } from "../tools/drive-autosave";

describe("drive autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAutosaveForTests();
  });

  afterEach(() => {
    resetAutosaveForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeFakeApi(overrides: Partial<WebApi> = {}): WebApi {
    return {
      get: vi.fn(async (path: string) => {
        if (path === "/drive/status") return { connected: true };
        return {};
      }),
      post: vi.fn(async (path: string) => {
        if (path === "/drive/save") return { processed: 1, remaining: 0, done: true };
        return {};
      }),
      put: vi.fn(async () => ({})),
      patch: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      ...overrides,
    } as unknown as WebApi;
  }

  it("debounces calls so rapid saves run once after 2 minutes", async () => {
    const api = makeFakeApi();

    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.post).not.toHaveBeenCalled();

    // Second call resets the 2-minute timer
    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.post).not.toHaveBeenCalled();

    // Advance the remaining 60 seconds (120s after the 2nd call)
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).toHaveBeenCalledWith("/drive/status");
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/drive/save", { budget: 50 });
  });

  it("runs one save at a time; a call during a run schedules another run after it", async () => {
    let resolveFirstBatch!: (value: unknown) => void;
    const firstBatchPromise = new Promise((resolve) => {
      resolveFirstBatch = resolve;
    });

    let postCount = 0;
    const api = makeFakeApi({
      post: vi.fn(async (path: string) => {
        if (path === "/drive/save") {
          postCount++;
          if (postCount === 1) {
            await firstBatchPromise;
            return { processed: 1, remaining: 0, done: true };
          }
          return { processed: 1, remaining: 0, done: true };
        }
        return {};
      }) as any,
    });

    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(autosaveTiming.debounceMs);

    // First save started and is awaiting firstBatchPromise
    expect(postCount).toBe(1);

    // Call scheduleDriveSave while first save is in flight
    scheduleDriveSave(api);
    // Should NOT have started a second save yet
    expect(postCount).toBe(1);

    // Finish first save
    resolveFirstBatch({});
    // Flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    // The queued second run should now execute
    expect(postCount).toBe(2);
  });

  it("skips quietly when /drive/status says connected: false", async () => {
    const api = makeFakeApi({
      get: vi.fn(async (path: string) => {
        if (path === "/drive/status") return { connected: false };
        return {};
      }) as any,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(autosaveTiming.debounceMs);

    expect(api.get).toHaveBeenCalledWith("/drive/status");
    expect(api.post).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("skips quietly when the app answers sync_in_progress", async () => {
    const api = makeFakeApi({
      post: vi.fn(async (path: string) => {
        if (path === "/drive/save") {
          throw new ApiError(409, "A save is already running.", "sync_in_progress");
        }
        return {};
      }) as any,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(autosaveTiming.debounceMs);

    expect(api.post).toHaveBeenCalledWith("/drive/save", { budget: 50 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("never throws, never leaves unhandled rejection, and logs one line on error", async () => {
    const api = makeFakeApi({
      post: vi.fn(async () => {
        throw new Error("Network timeout contacting Google");
      }) as any,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    scheduleDriveSave(api);
    await vi.advanceTimersByTimeAsync(autosaveTiming.debounceMs);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[sourcefold] drive autosave: Network timeout contacting Google",
    );
  });
});
