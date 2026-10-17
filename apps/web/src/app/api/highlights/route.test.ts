import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf } from "@/test/fake-db";
import { createScriptedDb } from "@/test/scripted-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";
import { DELETE, PATCH, PUT } from "./[id]/route";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const ID = "00000000-0000-4000-8000-0000000000a1";
const ITEM = "00000000-0000-4000-8000-0000000000b1";
const ITEM2 = "00000000-0000-4000-8000-0000000000b2";
const FOLDER = "00000000-0000-4000-8000-0000000000c1";

function hrow(id: string, itemId: string, start = 0) {
  return {
    id,
    item_id: itemId,
    kind: "text",
    quote: "q",
    prefix: "",
    suffix: "",
    start_offset: start,
    end_offset: start + 1,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-17T00:00:00Z",
    updated_at: "2026-10-17T00:00:00Z",
  };
}

const body = {
  id: ID,
  item_id: ITEM,
  kind: "text",
  quote: "The exhaust spins a turbine.",
  prefix: "",
  suffix: "",
  start_offset: 3,
  end_offset: 31,
  image_src: null,
  note: null,
  seconds: null,
  cited: [],
};

function use(script: Parameters<typeof createScriptedDb>[0]) {
  const fake = createScriptedDb(script);
  requireApiUser.mockResolvedValue({ db: fake.db, userId: USER, via: "token" });
  return fake;
}

const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (method: string, payload: unknown) =>
  new Request(`http://localhost/api/highlights/${ID}`, {
    method,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
const deleteRequest = () => new Request("http://localhost/x", { method: "DELETE" });
const writes = (fake: ReturnType<typeof createScriptedDb>) =>
  fake.queries.filter((q) => callsOf(q, "update").length + callsOf(q, "insert").length > 0);

beforeEach(() => requireApiUser.mockReset());

describe("GET /api/highlights", () => {
  it("lists one item's highlights, scoped to the user", async () => {
    const fake = use({
      items: [{ data: { id: ITEM } }],
      highlights: [{ data: [hrow("h1", ITEM, 1), hrow("h2", ITEM, 5)] }],
    });
    const res = await GET(new Request(`http://localhost/api/highlights?item=${ITEM}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.map((h: { id: string }) => h.id)).toEqual(["h1", "h2"]);
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER]);
    expect(callsOf(fake.queries[1]!, "eq")).toContainEqual(["user_id", USER]);
  });

  it("404s for an item that isn't the user's", async () => {
    use({ items: [{ data: null }] });
    const res = await GET(new Request(`http://localhost/api/highlights?item=${ITEM}`));
    expect(res.status).toBe(404);
  });

  it("lists a folder's live items' highlights, ordered by item", async () => {
    const fake = use({
      folders: [{ data: { id: FOLDER } }],
      items: [{ data: [{ id: ITEM2 }, { id: ITEM }] }],
      highlights: [{ data: [hrow("h2", ITEM2), hrow("h1", ITEM)] }],
    });
    const res = await GET(new Request(`http://localhost/api/highlights?folder=${FOLDER}`));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.map((h: { id: string }) => h.id)).toEqual(["h1", "h2"]);
    const itemsQuery = fake.queries.find((q) => q.table === "items")!;
    expect(callsOf(itemsQuery, "eq")).toEqual(
      expect.arrayContaining([
        ["folder_id", FOLDER],
        ["user_id", USER],
      ]),
    );
    expect(callsOf(itemsQuery, "is")).toContainEqual(["deleted_at", null]);
  });

  it("404s for a folder that isn't the user's", async () => {
    use({ folders: [{ data: null }] });
    const res = await GET(new Request(`http://localhost/api/highlights?folder=${FOLDER}`));
    expect(res.status).toBe(404);
  });

  it("requires item or folder, and valid ids", async () => {
    use({});
    expect((await GET(new Request("http://localhost/api/highlights"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/highlights?item=x"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/highlights?folder=x"))).status).toBe(400);
  });
});

describe("PUT /api/highlights/[id]", () => {
  it("creates a highlight with the caller as owner", async () => {
    const fake = use({
      highlights: [{ data: null }, { data: hrow(ID, ITEM, 3) }],
      items: [{ data: { id: ITEM } }],
    });
    const res = await PUT(jsonRequest("PUT", body), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe(ID);
    const insert = fake.queries.find((q) => callsOf(q, "insert").length > 0)!;
    expect(callsOf(insert, "insert")[0]![0]).toMatchObject({
      id: ID,
      user_id: USER,
      item_id: ITEM,
    });
  });

  it("replaces an existing highlight the user owns", async () => {
    const fake = use({
      highlights: [{ data: { id: ID, user_id: USER } }, { data: hrow(ID, ITEM, 3) }],
      items: [{ data: { id: ITEM } }],
    });
    const res = await PUT(jsonRequest("PUT", { ...body, note: "hi" }), params());

    expect(res.status).toBe(200);
    const update = fake.queries.find((q) => callsOf(q, "update").length > 0)!;
    expect(callsOf(update, "update")[0]![0]).toMatchObject({ note: "hi" });
    expect(callsOf(update, "eq")).toEqual(
      expect.arrayContaining([
        ["id", ID],
        ["user_id", USER],
      ]),
    );
  });

  it("404s when the id belongs to another user, without writing", async () => {
    const fake = use({
      highlights: [{ data: { id: ID, user_id: OTHER } }],
      items: [{ data: { id: ITEM } }],
    });
    const res = await PUT(jsonRequest("PUT", body), params());

    expect(res.status).toBe(404);
    expect(writes(fake)).toHaveLength(0);
  });

  it("404s when the item isn't the user's", async () => {
    const fake = use({ highlights: [{ data: null }], items: [{ data: null }] });
    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(404);
    expect(writes(fake)).toHaveLength(0);
  });

  it("400s on limits, a mismatched id, bad JSON or a bad URL id", async () => {
    use({});
    const long = { ...body, quote: "a".repeat(10_001) };
    expect((await PUT(jsonRequest("PUT", long), params())).status).toBe(400);
    expect((await PUT(jsonRequest("PUT", { ...body, start_offset: 40 }), params())).status).toBe(
      400,
    );
    expect((await PUT(jsonRequest("PUT", body), params(ITEM))).status).toBe(400);
    expect((await PUT(jsonRequest("PUT", "{nope"), params())).status).toBe(400);
    expect((await PUT(jsonRequest("PUT", body), params("bad"))).status).toBe(400);
  });
});

describe("PATCH /api/highlights/[id]", () => {
  it("sets the note, filtered by user", async () => {
    const fake = use({ highlights: [{ data: { ...hrow(ID, ITEM), note: "Check" } }] });
    const res = await PATCH(jsonRequest("PATCH", { note: "Check" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.note).toBe("Check");
    expect(callsOf(fake.queries[0]!, "update")[0]![0]).toEqual({ note: "Check" });
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER]);
  });

  it("404s when nothing matches (not the user's)", async () => {
    use({ highlights: [{ data: null }] });
    expect((await PATCH(jsonRequest("PATCH", { note: null }), params())).status).toBe(404);
  });

  it("400s on a missing or oversized note", async () => {
    use({});
    expect((await PATCH(jsonRequest("PATCH", {}), params())).status).toBe(400);
    const long = { note: "a".repeat(5_001) };
    expect((await PATCH(jsonRequest("PATCH", long), params())).status).toBe(400);
  });
});

describe("DELETE /api/highlights/[id]", () => {
  it("hard-deletes the user's highlight", async () => {
    const fake = use({ highlights: [{ data: { id: ID } }] });
    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: ID });
    expect(callsOf(fake.queries[0]!, "delete")).toHaveLength(1);
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER]);
  });

  it("404s for a highlight that isn't there or isn't the user's", async () => {
    use({ highlights: [{ data: null }] });
    expect((await DELETE(deleteRequest(), params())).status).toBe(404);
  });
});
