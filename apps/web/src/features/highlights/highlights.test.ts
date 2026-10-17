import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HighlightInput } from "@sourcefold/core";
import type { Database } from "@/lib/database.types";
import { callsOf, createFakeDb } from "@/test/fake-db";
import { highlightInputSchema, highlightNotePatchSchema } from "./schema";
import { inputToRow, rowToHighlight, type HighlightRow } from "./mapping";
import { loadHighlightsForItems } from "./load";

const ID = "00000000-0000-4000-8000-0000000000a1";
const ITEM = "00000000-0000-4000-8000-0000000000b1";
const ITEM2 = "00000000-0000-4000-8000-0000000000b2";

function input(overrides: Partial<HighlightInput> = {}): HighlightInput {
  return {
    id: ID,
    item_id: ITEM,
    kind: "text",
    quote: "The exhaust spins a turbine.",
    prefix: "before ",
    suffix: " after",
    start_offset: 10,
    end_offset: 38,
    image_src: null,
    note: null,
    seconds: null,
    cited: [{ n: "12", title: "SAE paper", url: "https://www.sae.org/paper" }],
    ...overrides,
  };
}

function row(overrides: Partial<HighlightRow> = {}): HighlightRow {
  return {
    id: ID,
    item_id: ITEM,
    kind: "text",
    quote: "q",
    prefix: "",
    suffix: "",
    start_offset: 0,
    end_offset: 1,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
    ...overrides,
  };
}

const manyCitations = (count: number) =>
  Array.from({ length: count }, () => ({ n: "1", title: null, url: "https://a.b" }));

describe("highlightInputSchema", () => {
  it("accepts a valid highlight", () => {
    expect(highlightInputSchema.safeParse(input()).success).toBe(true);
  });

  it("strips fields the client shouldn't send", () => {
    const parsed = highlightInputSchema.parse({ ...input(), user_id: "x", created_at: "y" });
    expect(parsed).not.toHaveProperty("user_id");
    expect(parsed).not.toHaveProperty("created_at");
  });

  it.each([
    ["a quote over 10,000 characters", { quote: "a".repeat(10_001) }],
    ["a note over 5,000 characters", { note: "a".repeat(5_001) }],
    ["a prefix over 64 characters", { prefix: "a".repeat(65) }],
    ["a suffix over 64 characters", { suffix: "a".repeat(65) }],
    ["more than 50 citations", { cited: manyCitations(51) }],
    ["a negative offset", { start_offset: -1 }],
    ["a fractional offset", { end_offset: 12.5 }],
    ["end before start", { start_offset: 20, end_offset: 10 }],
    ["negative seconds", { seconds: -1 }],
    ["fractional seconds", { seconds: 1.5 }],
    ["an unknown kind", { kind: "video" as never }],
    ["a bad id", { id: "nope" }],
    ["an empty text quote", { quote: "   " }],
    ["an image without image_src", { kind: "image" as const, image_src: null }],
  ])("rejects %s", (_name, overrides) => {
    expect(highlightInputSchema.safeParse(input(overrides)).success).toBe(false);
  });

  it("accepts the limits exactly", () => {
    const ok = input({
      quote: "a".repeat(10_000),
      note: "n".repeat(5_000),
      prefix: "p".repeat(64),
      suffix: "s".repeat(64),
      cited: manyCitations(50),
      seconds: 0,
      start_offset: 0,
      end_offset: 0,
    });
    expect(highlightInputSchema.safeParse(ok).success).toBe(true);
  });

  it("turns an empty note into null", () => {
    expect(highlightInputSchema.parse(input({ note: "" })).note).toBeNull();
    expect(highlightNotePatchSchema.parse({ note: "" }).note).toBeNull();
  });

  it("requires the note key on PATCH", () => {
    expect(highlightNotePatchSchema.safeParse({}).success).toBe(false);
    expect(highlightNotePatchSchema.safeParse({ note: null }).success).toBe(true);
  });
});

describe("row mapping", () => {
  it("maps a row to a Highlight and drops malformed citations", () => {
    const h = rowToHighlight(
      row({
        kind: "image",
        cited: [{ n: "3", title: null, url: "https://a.b/c" }, { bad: true }, "x"],
      }),
    );
    expect(h.kind).toBe("image");
    expect(h.cited).toEqual([{ n: "3", title: null, url: "https://a.b/c" }]);
  });

  it("treats a non-array cited column as empty", () => {
    expect(rowToHighlight(row({ cited: { a: 1 } })).cited).toEqual([]);
  });

  it("writes only the columns the client controls", () => {
    expect(Object.keys(inputToRow(input())).sort()).toEqual(
      [
        "cited",
        "end_offset",
        "image_src",
        "item_id",
        "kind",
        "note",
        "prefix",
        "quote",
        "seconds",
        "start_offset",
        "suffix",
      ].sort(),
    );
  });
});

describe("loadHighlightsForItems", () => {
  it("groups by item with one query and filters by user", async () => {
    const fake = createFakeDb({
      highlights: [
        row({ id: "h1", item_id: ITEM }),
        row({ id: "h2", item_id: ITEM }),
        row({ id: "h3", item_id: ITEM2 }),
      ],
    });
    const map = await loadHighlightsForItems(
      fake.db as unknown as SupabaseClient<Database>,
      "user-1",
      [ITEM, ITEM2, ITEM],
    );

    expect(fake.queries).toHaveLength(1);
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", "user-1"]);
    expect(callsOf(fake.queries[0]!, "in")).toEqual([["item_id", [ITEM, ITEM2]]]);
    expect(map.get(ITEM)?.map((h) => h.id)).toEqual(["h1", "h2"]);
    expect(map.get(ITEM2)?.map((h) => h.id)).toEqual(["h3"]);
  });

  it("runs no query for no items", async () => {
    const fake = createFakeDb({});
    const map = await loadHighlightsForItems(
      fake.db as unknown as SupabaseClient<Database>,
      "user-1",
      [],
    );
    expect(fake.queries).toHaveLength(0);
    expect(map.size).toBe(0);
  });
});
