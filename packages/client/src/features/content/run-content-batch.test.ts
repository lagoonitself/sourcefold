import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadFileText = vi.fn();
const downloadFileBytes = vi.fn();
vi.mock("../../google/drive", () => ({
  downloadFileText: (...args: unknown[]) => downloadFileText(...args),
  downloadFileBytes: (...args: unknown[]) => downloadFileBytes(...args),
}));

import { runContentBatch } from "./run-content-batch";
import { ContentStoreError } from "./worker-store";

function item(over: Record<string, unknown>) {
  return {
    id: "i1",
    title: "T",
    kind: "article",
    markdown: "text",
    storage_path: null,
    drive_file_id: null,
    meta: {},
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function setup(opts: { waiting?: unknown[]; driveOnly?: unknown[]; connected?: boolean } = {}) {
  const remove = vi.fn(async () => ({}));
  const download = vi.fn(async () => ({
    data: new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
    error: null,
  }));
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "content_waiting_items") return { data: opts.waiting ?? [], error: null };
    if (fn === "content_drive_only_items") return { data: opts.driveOnly ?? [], error: null };
    return { data: true, error: null };
  });
  const db = { rpc, storage: { from: () => ({ download, remove }) } } as never;
  const content = {
    getText: vi.fn(),
    getFile: vi.fn(),
    putText: vi.fn(async (_id: string, body: string) => ({ sha256: "h", bytes: body.length })),
    putFile: vi.fn(async (_id: string, bytes: Uint8Array) => ({
      sha256: "f",
      bytes: bytes.length,
    })),
  };
  const drive = {
    getAccessToken: vi.fn(async () => "tok"),
    clearAccessToken: vi.fn(),
    isConnected: vi.fn(async () => opts.connected ?? false),
  };
  return { db, rpc, content, drive, remove };
}

describe("runContentBatch", () => {
  beforeEach(() => {
    downloadFileText.mockReset();
    downloadFileBytes.mockReset();
  });

  it("does nothing without a content store", async () => {
    const { db, drive } = setup();
    const result = await runContentBatch(db, "u1", { drive, content: null });
    expect(result).toEqual({ moved: 0, failed: [], storageFull: false });
  });

  it("puts waiting text in R2 and marks it stored", async () => {
    const { db, rpc, content, drive } = setup({ waiting: [item({})] });
    const result = await runContentBatch(db, "u1", { drive, content });
    expect(result.moved).toBe(1);
    expect(content.putText).toHaveBeenCalledWith("i1", "text");
    expect(rpc).toHaveBeenCalledWith("mark_item_content_stored", {
      p_id: "i1",
      p_seen_updated_at: "2026-01-01T00:00:00Z",
      p_sha256: "h",
      p_bytes: 4,
      p_user_id: "u1",
    });
  });

  it("moves an image and removes the Storage file when the database clears it", async () => {
    const { db, content, drive, remove } = setup({
      waiting: [item({ id: "img", kind: "image", markdown: null, storage_path: "u1/img/a.png" })],
    });
    const result = await runContentBatch(db, "u1", { drive, content });
    expect(result.moved).toBe(1);
    expect(content.putFile).toHaveBeenCalledWith("img", expect.any(Uint8Array), "image/png");
    expect(remove).toHaveBeenCalledWith(["u1/img/a.png"]);
  });

  it("collects a failing item and goes on", async () => {
    const { db, content, drive } = setup({
      waiting: [item({ id: "bad", title: "Bad" }), item({ id: "ok" })],
    });
    content.putText.mockRejectedValueOnce(new Error("boom"));
    const result = await runContentBatch(db, "u1", { drive, content });
    expect(result.moved).toBe(1);
    expect(result.failed).toEqual([{ id: "bad", title: "Bad", message: "boom" }]);
  });

  it("stops on a 401 from the store", async () => {
    const { db, content, drive } = setup({ waiting: [item({})] });
    content.putText.mockRejectedValueOnce(new ContentStoreError(401, "unauthorized", "No"));
    await expect(runContentBatch(db, "u1", { drive, content })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("stops and reports when storage is full", async () => {
    const { db, content, drive } = setup({ waiting: [item({ id: "a" }), item({ id: "b" })] });
    content.putText.mockRejectedValueOnce(new ContentStoreError(507, "storage_full", "Full"));
    const result = await runContentBatch(db, "u1", { drive, content });
    expect(result.storageFull).toBe(true);
    expect(result.moved).toBe(0);
    expect(content.putText).toHaveBeenCalledTimes(1);
  });

  it("copies Drive-only sources to R2 while Drive is connected", async () => {
    downloadFileText.mockResolvedValue("---\ntitle: x\n---\n\nold text");
    const { db, content, drive } = setup({
      connected: true,
      driveOnly: [item({ id: "old", markdown: null, drive_file_id: "d1" })],
    });
    const result = await runContentBatch(db, "u1", { drive, content });
    expect(result.moved).toBe(1);
    expect(content.putText.mock.calls[0]![1]).toContain("old text");
  });

  it("skips Drive-only sources when Drive is not connected", async () => {
    const { db, rpc, content, drive } = setup({ connected: false, driveOnly: [item({})] });
    await runContentBatch(db, "u1", { drive, content });
    expect(rpc.mock.calls.map(([fn]) => fn)).not.toContain("content_drive_only_items");
  });
});
