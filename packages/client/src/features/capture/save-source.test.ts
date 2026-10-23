import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { callsOf, createFakeDb } from "../../test/fake-db";

const findDuplicate = vi.fn();
const nextPosition = vi.fn();

vi.mock("./find-duplicate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./find-duplicate")>()),
  findDuplicate: (...args: unknown[]) => findDuplicate(...args),
  nextPosition: (...args: unknown[]) => nextPosition(...args),
}));

import { saveSource, saveSourceUnavailable } from "./save-source";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000aa";
const ITEM_ROW = {
  id: "item-1",
  folder_id: FOLDER_ID,
  kind: "youtube",
  title: "How a Turbocharger Works",
  source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  status: "saved",
  created_at: "2026-10-16T10:00:00Z",
};

function fakeDb() {
  const fake = createFakeDb({ items: ITEM_ROW });
  return { fake, db: fake.db as unknown as SupabaseClient<Database> };
}

function insertedRow(fake: ReturnType<typeof fakeDb>["fake"]) {
  const insert = fake.queries.find((q) => callsOf(q, "insert").length > 0)!;
  return callsOf(insert, "insert")[0]![0] as Record<string, unknown>;
}

describe("saveSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findDuplicate.mockResolvedValue(null);
    nextPosition.mockResolvedValue(0);
  });

  it("saves a capture with its canonical URL and the capture meta as-is", async () => {
    const { fake, db } = fakeDb();
    const capture = {
      url: "https://youtu.be/dQw4w9WgXcQ?t=42",
      title: "How a Turbocharger Works",
      meta: { channel: "Engineering Explained", duration: "1:02:10" },
      markdown: "## Transcript\n\nHello.",
    };

    const result = await saveSource(db, USER_ID, "youtube", FOLDER_ID, capture);

    expect(result.success).toBe(true);
    expect(findDuplicate).toHaveBeenCalledWith(
      fake.db,
      USER_ID,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      FOLDER_ID,
    );
    expect(insertedRow(fake)).toMatchObject({
      user_id: USER_ID,
      folder_id: FOLDER_ID,
      kind: "youtube",
      status: "saved",
      source_url: "https://youtu.be/dQw4w9WgXcQ?t=42",
      canonical_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      meta: { channel: "Engineering Explained", duration: "1:02:10" },
      markdown: "## Transcript\n\nHello.\n",
      position: 0,
    });
  });

  it("refuses a capture with no text instead of saving an empty source", async () => {
    const { fake, db } = fakeDb();
    const result = await saveSource(db, USER_ID, "web", FOLDER_ID, {
      url: "https://www.youtube.com/",
      title: "YouTube",
      meta: {},
      markdown: "  \n ",
    });
    expect(result).toMatchObject({ success: false, status: 422, error: { code: "no_content" } });
    expect(fake.queries.some((q) => callsOf(q, "insert").length > 0)).toBe(false);
  });

  it("falls back to the capture URL when it cannot be canonicalized", async () => {
    const { fake, db } = fakeDb();

    const result = await saveSource(db, USER_ID, "web", FOLDER_ID, {
      url: "not a url",
      title: "A page",
      meta: {},
      markdown: "Text.",
    });

    expect(result.success).toBe(true);
    expect(findDuplicate).toHaveBeenCalledWith(fake.db, USER_ID, "not a url", FOLDER_ID);
    expect(insertedRow(fake)).toMatchObject({ canonical_url: "not a url" });
  });

  it("returns the duplicate response without inserting", async () => {
    const { fake, db } = fakeDb();
    findDuplicate.mockResolvedValue({
      item_id: "old",
      folder_id: FOLDER_ID,
      folder_name: "Engines",
    });

    const result = await saveSource(db, USER_ID, "youtube", FOLDER_ID, {
      url: "https://youtu.be/dQw4w9WgXcQ",
      title: "How a Turbocharger Works",
      meta: {},
      markdown: "Text.",
    });

    expect(result).toMatchObject({
      success: false,
      status: 409,
      error: { code: "duplicate", item_id: "old", folder_name: "Engines" },
    });
    expect(fake.queries).toHaveLength(0);
  });
});

describe("saveSourceUnavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findDuplicate.mockResolvedValue(null);
    nextPosition.mockResolvedValue(0);
  });

  it("stores an unavailable item with no markdown and marks the response", async () => {
    const { fake, db } = fakeDb();

    const result = await saveSourceUnavailable(db, USER_ID, {
      folder_id: FOLDER_ID,
      source: "youtube",
      url: "https://www.youtube.com/watch?v=abcDEF12345",
      title: "No captions here",
      reason: "No captions on this video",
    });

    expect(result).toMatchObject({ success: true, status: 201, unavailable: true });
    expect(insertedRow(fake)).toMatchObject({
      kind: "youtube",
      status: "unavailable",
      error: "No captions on this video",
      markdown: null,
      canonical_url: "https://www.youtube.com/watch?v=abcDEF12345",
    });
  });
});
