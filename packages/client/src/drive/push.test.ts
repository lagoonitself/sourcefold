import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runSaveBatch = vi.fn();
vi.mock("../features/drive/run-save-batch", () => ({
  runSaveBatch: (...args: unknown[]) => runSaveBatch(...args),
}));

import { createDrivePusher } from "./push";

const USER_ID = "u1";

function setup(locked = true) {
  const rpc = vi.fn(async (fn: string) => ({
    data: fn === "acquire_drive_sync_lock" ? locked : null,
    error: null,
  }));
  const db = { rpc } as never;
  const drive = {
    getAccessToken: vi.fn(async () => "token"),
    clearAccessToken: vi.fn(),
    isConnected: vi.fn(async () => true),
  };
  const host = { drive, fetchUrl: vi.fn() };
  const onPushed = vi.fn();
  const pusher = createDrivePusher(db, host, { delayMs: 3000, onPushed });
  return { rpc, drive, host, pusher, onPushed };
}

describe("createDrivePusher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runSaveBatch.mockReset();
    runSaveBatch.mockResolvedValue({ processed: 1, failed: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("pushes once, a few seconds after the last of several changes", async () => {
    const { rpc, pusher, host, onPushed } = setup();
    pusher.schedule(USER_ID);
    await vi.advanceTimersByTimeAsync(2000);
    pusher.schedule(USER_ID);
    await vi.advanceTimersByTimeAsync(2999);
    expect(runSaveBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pusher.flush();

    expect(runSaveBatch).toHaveBeenCalledTimes(1);
    expect(runSaveBatch).toHaveBeenCalledWith(expect.anything(), USER_ID, "token", host, 10);
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual([
      "acquire_drive_sync_lock",
      "release_drive_sync_lock",
    ]);
    expect(onPushed).toHaveBeenCalledTimes(1);
  });

  it("leaves it for the next change when someone else holds the lock", async () => {
    const { rpc, drive, pusher } = setup(false);
    pusher.schedule(USER_ID);
    await pusher.flush();
    expect(drive.getAccessToken).not.toHaveBeenCalled();
    expect(runSaveBatch).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(["acquire_drive_sync_lock"]);
  });

  it("always gives the lock back, even when the push fails", async () => {
    const { rpc, pusher } = setup();
    runSaveBatch.mockRejectedValueOnce(new Error("Drive is down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    pusher.schedule(USER_ID);
    await pusher.flush();
    expect(rpc.mock.calls.map(([fn]) => fn)).toContain("release_drive_sync_lock");
    error.mockRestore();
  });

  it("pushes again after a change that came in during a push", async () => {
    const { pusher } = setup();
    let finish!: () => void;
    runSaveBatch.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = () => resolve())),
    );
    pusher.schedule(USER_ID);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runSaveBatch).toHaveBeenCalledTimes(1);

    pusher.schedule(USER_ID);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runSaveBatch).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(3000);
    await pusher.flush();
    expect(runSaveBatch).toHaveBeenCalledTimes(2);
  });

  it("does nothing after cancel", async () => {
    const { pusher } = setup();
    pusher.schedule(USER_ID);
    pusher.cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runSaveBatch).not.toHaveBeenCalled();
  });
});
