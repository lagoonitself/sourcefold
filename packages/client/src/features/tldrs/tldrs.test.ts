import { describe, expect, it } from "vitest";
import { callsOf, createFakeDb } from "../../test/fake-db";
import * as tldrs from "../../routes/tldrs";
import * as tldr from "../../routes/tldrs/[itemId]";
import type { RouteContext } from "../../context";
import { rowToTldr, tldrInputSchema } from "./index";

const USER = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-0000000000aa";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";

const ROW = {
  item_id: ITEM,
  tldr: { gist: "Turbos cut lag.", points: ["One"], best_part: null },
  source: "ai",
  model: "GPT-6 Luna",
  body_hash: "c53-1-2",
  created_at: "2026-10-24T00:00:00Z",
  updated_at: "2026-10-24T00:00:00Z",
};

function ctx(results: Record<string, unknown>) {
  const fake = createFakeDb(results);
  const auth = { db: fake.db, userId: USER, via: "session", host: {} } as unknown as RouteContext;
  return { auth, fake };
}

describe("tldrInputSchema", () => {
  it("normalizes the TL;DR and empties model and hash", () => {
    const parsed = tldrInputSchema.parse({
      tldr: { gist: " A  gist ", points: ["- x"] },
      source: "article",
      model: "",
    });
    expect(parsed).toEqual({
      tldr: { gist: "A gist", points: ["x"], best_part: null },
      source: "article",
      model: null,
      body_hash: null,
    });
  });

  it("refuses a TL;DR without a gist and an unknown source", () => {
    expect(tldrInputSchema.safeParse({ tldr: { points: [] }, source: "ai" }).success).toBe(false);
    expect(tldrInputSchema.safeParse({ tldr: { gist: "g" }, source: "llm" }).success).toBe(false);
  });
});

describe("rowToTldr", () => {
  it("drops rows that no longer read as a TL;DR", () => {
    expect(rowToTldr({ ...ROW, tldr: { points: [] } })).toBeNull();
    expect(rowToTldr({ ...ROW, source: "other" })).toBeNull();
    expect(rowToTldr(ROW)?.tldr.gist).toBe("Turbos cut lag.");
  });
});

describe("GET /api/tldrs", () => {
  it("lists a group's TL;DRs, filtered by user", async () => {
    const { auth, fake } = ctx({ items: [{ id: ITEM }], item_tldrs: [ROW] });
    const res = await tldrs.GET(auth, new Request(`http://x/api/tldrs?folder=${FOLDER}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    const tldrQuery = fake.queries.find((q) => q.table === "item_tldrs")!;
    expect(callsOf(tldrQuery, "eq")).toContainEqual(["user_id", USER]);
    expect(callsOf(tldrQuery, "in")).toEqual([["item_id", [ITEM]]]);
  });

  it("needs a folder or a project", async () => {
    const { auth } = ctx({});
    expect((await tldrs.GET(auth, new Request("http://x/api/tldrs"))).status).toBe(400);
    expect((await tldrs.GET(auth, new Request("http://x/api/tldrs?folder=nope"))).status).toBe(400);
  });
});

describe("PUT and DELETE /api/tldrs/[itemId]", () => {
  it("upserts the user's TL;DR on a live item", async () => {
    const { auth, fake } = ctx({ items: { id: ITEM }, item_tldrs: ROW });
    const res = await tldr.PUT(
      auth,
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({
          tldr: ROW.tldr,
          source: "ai",
          model: "GPT-6 Luna",
          body_hash: "c53-1-2",
        }),
      }),
      { itemId: ITEM },
    );
    expect(res.status).toBe(200);
    const upsert = callsOf(
      fake.queries.find((q) => q.table === "item_tldrs")!,
      "upsert",
    )[0]!;
    expect(upsert[0]).toMatchObject({ item_id: ITEM, user_id: USER, source: "ai" });
    expect(upsert[1]).toEqual({ onConflict: "item_id" });
  });

  it("answers 404 for an item that isn't the user's", async () => {
    const { auth } = ctx({ items: null });
    const res = await tldr.PUT(
      auth,
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({ tldr: ROW.tldr, source: "ai" }),
      }),
      { itemId: ITEM },
    );
    expect(res.status).toBe(404);
  });

  it("deletes only the user's row", async () => {
    const { auth, fake } = ctx({ item_tldrs: null });
    const res = await tldr.DELETE(auth, new Request("http://x", { method: "DELETE" }), {
      itemId: ITEM,
    });
    expect(res.status).toBe(200);
    expect(callsOf(fake.queries[0]!, "eq")).toEqual([
      ["item_id", ITEM],
      ["user_id", USER],
    ]);
  });
});
