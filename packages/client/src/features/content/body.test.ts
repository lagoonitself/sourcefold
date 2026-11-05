import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadFileText = vi.fn();
const downloadFileBytes = vi.fn();
vi.mock("../../google/drive", () => ({
  downloadFileText: (...args: unknown[]) => downloadFileText(...args),
  downloadFileBytes: (...args: unknown[]) => downloadFileBytes(...args),
}));

import { ContentGoneError, ContentNotReadyError, loadItemBody, loadItemFile } from "./body";

const ME = "me";
const base = {
  id: "i1",
  kind: "article",
  markdown: null,
  content_sha256: null,
  drive_file_id: null,
  user_id: ME,
};

function hostWith(text: string | null = "from r2") {
  return {
    drive: {
      getAccessToken: vi.fn(async () => "tok"),
      clearAccessToken: vi.fn(),
      isConnected: vi.fn(async () => true),
    },
    content: {
      getText: vi.fn(async () => text),
      putText: vi.fn(),
      getFile: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" })),
      putFile: vi.fn(),
    },
  };
}
const db = {} as never;

describe("loadItemBody", () => {
  beforeEach(() => {
    downloadFileText.mockReset();
    downloadFileBytes.mockReset();
  });

  it("prefers the row's own text", async () => {
    const host = hostWith();
    expect(await loadItemBody(db, host, ME, { ...base, markdown: "row" })).toBe("row");
    expect(host.content.getText).not.toHaveBeenCalled();
  });

  it("reads R2 when the text was moved there", async () => {
    const host = hostWith();
    expect(await loadItemBody(db, host, ME, { ...base, content_sha256: "aa" })).toBe("from r2");
  });

  it("falls back to the owner's Drive when R2 has nothing", async () => {
    const host = hostWith(null);
    downloadFileText.mockResolvedValue("---\ntitle: x\n---\n\nbody text");
    const text = await loadItemBody(db, host, ME, {
      ...base,
      content_sha256: "aa",
      drive_file_id: "d1",
    });
    expect(text).toContain("body text");
    expect(downloadFileText).toHaveBeenCalledWith("tok", "d1");
  });

  it("reads old sources from Drive when there is no content store", async () => {
    downloadFileText.mockResolvedValue("---\ntitle: x\n---\n\nold text");
    const host = { ...hostWith(), content: null };
    expect(await loadItemBody(db, host, ME, { ...base, drive_file_id: "d1" })).toContain(
      "old text",
    );
  });

  it("says the Drive copy is gone when Drive has no file", async () => {
    downloadFileText.mockResolvedValue(null);
    await expect(
      loadItemBody(db, hostWith(), ME, { ...base, drive_file_id: "d1" }),
    ).rejects.toBeInstanceOf(ContentGoneError);
  });

  it("is empty when the source never had text", async () => {
    expect(await loadItemBody(db, hostWith(), ME, base)).toBe("");
  });

  it("is not ready for a member while the text is only in the owner's Drive", async () => {
    await expect(
      loadItemBody(db, hostWith(), "someone-else", { ...base, drive_file_id: "d1" }),
    ).rejects.toBeInstanceOf(ContentNotReadyError);
    expect(downloadFileText).not.toHaveBeenCalled();
  });
});

describe("loadItemFile", () => {
  const image = {
    id: "i1",
    storage_path: null,
    content_sha256: null,
    drive_file_id: null,
    user_id: ME,
  };

  it("reads Storage first", async () => {
    const download = vi.fn(async () => ({
      data: new Blob([new Uint8Array([7])], { type: "image/gif" }),
      error: null,
    }));
    const dbWithStorage = { storage: { from: () => ({ download }) } } as never;
    const file = await loadItemFile(dbWithStorage, hostWith(), ME, {
      ...image,
      storage_path: "u/i1/a.gif",
    });
    expect([...file!.bytes]).toEqual([7]);
    expect(file!.mimeType).toBe("image/gif");
  });

  it("then R2, then the owner's Drive", async () => {
    const fromR2 = await loadItemFile(db, hostWith(), ME, { ...image, content_sha256: "aa" });
    expect(fromR2!.mimeType).toBe("image/png");

    downloadFileBytes.mockResolvedValue(new Uint8Array([5]));
    const fromDrive = await loadItemFile(db, { ...hostWith(), content: null }, ME, {
      ...image,
      drive_file_id: "d1",
    });
    expect([...fromDrive!.bytes]).toEqual([5]);
  });

  it("is null when no store has it", async () => {
    expect(await loadItemFile(db, hostWith(), ME, image)).toBeNull();
  });
});
