import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";
import { DELETE, PATCH, PUT } from "./[id]/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const GROUP_ID = "00000000-0000-4000-8000-0000000000bb";
const ITEM_ID = "00000000-0000-4000-8000-0000000000cc";
const CARD_ID = "00000000-0000-4000-8000-0000000000dd";

function cardRow(id: string, projectId: string, pos = 0) {
  return {
    id,
    project_id: projectId,
    kind: "line",
    item_id: null,
    highlight_id: null,
    quote: "",
    seconds: null,
    end_seconds: null,
    url: null,
    note: null,
    script_line: "Opening hook line",
    section_id: null,
    position: pos,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
  };
}

const params = (id = CARD_ID) => ({ params: Promise.resolve({ id }) });

function jsonRequest(method: string, payload: unknown, id = CARD_ID) {
  return new Request(`http://localhost/api/cards/${id}`, {
    method,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("GET /api/cards", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("lists cards by project_id", async () => {
    const fake = createFakeDb({
      cards: [cardRow("c2", PROJECT_ID, 2), cardRow("c1", PROJECT_ID, 1)],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request(`http://localhost/api/cards?project=${PROJECT_ID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.map((c: { id: string }) => c.id)).toEqual(["c1", "c2"]);
  });

  it("lists cards by item_id", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      items: [{ id: ITEM_ID, folder_id: PROJECT_ID }],
      cards: [{ ...cardRow("c1", PROJECT_ID), item_id: ITEM_ID }],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request(`http://localhost/api/cards?item=${ITEM_ID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].item_id).toBe(ITEM_ID);
  });

  it("card of a soft-deleted item is left out", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const liveItemId = "00000000-0000-4000-8000-0000000000c1";
    const deletedItemId = "00000000-0000-4000-8000-0000000000c2";

    // Deleted item is omitted from items result because deleted_at is not null in real db
    const fake = createFakeDb({
      folders,
      items: [{ id: liveItemId, folder_id: PROJECT_ID }],
      cards: [
        { ...cardRow("c_live", PROJECT_ID, 1), kind: "quote", item_id: liveItemId, quote: "q1" },
        { ...cardRow("c_del", PROJECT_ID, 2), kind: "quote", item_id: deletedItemId, quote: "q2" },
      ],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    // Under ?project=, the card of the soft-deleted item is left out
    const resProject = await GET(new Request(`http://localhost/api/cards?project=${PROJECT_ID}`));
    expect(resProject.status).toBe(200);
    const jsonProject = await resProject.json();
    expect(jsonProject.data.map((c: { id: string }) => c.id)).toEqual(["c_live"]);

    // Under ?item= for the deleted item
    const fakeForItem = createFakeDb({
      folders,
      items: [],
      cards: [
        { ...cardRow("c_del", PROJECT_ID, 1), kind: "quote", item_id: deletedItemId, quote: "q2" },
      ],
    });
    requireApiUser.mockResolvedValue({ db: fakeForItem.db, userId: USER_ID, via: "token" });

    const resItem = await GET(new Request(`http://localhost/api/cards?item=${deletedItemId}`));
    expect(resItem.status).toBe(200);
    const jsonItem = await resItem.json();
    expect(jsonItem.data).toEqual([]);
  });

  it("card of an item in a soft-deleted group is left out", async () => {
    const DELETED_GROUP_ID = "00000000-0000-4000-8000-0000000000ee";
    // folders only contains live folders; DELETED_GROUP_ID is soft-deleted and thus omitted
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const itemInDeletedGroup = "00000000-0000-4000-8000-0000000000e1";

    const fake = createFakeDb({
      folders,
      items: [{ id: itemInDeletedGroup, folder_id: DELETED_GROUP_ID }],
      cards: [
        {
          ...cardRow("c_del_group", PROJECT_ID, 1),
          kind: "quote",
          item_id: itemInDeletedGroup,
          quote: "q",
        },
      ],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    // Under ?project=
    const resProject = await GET(new Request(`http://localhost/api/cards?project=${PROJECT_ID}`));
    expect(resProject.status).toBe(200);
    const jsonProject = await resProject.json();
    expect(jsonProject.data).toEqual([]);

    // Under ?item=
    const resItem = await GET(new Request(`http://localhost/api/cards?item=${itemInDeletedGroup}`));
    expect(resItem.status).toBe(200);
    const jsonItem = await resItem.json();
    expect(jsonItem.data).toEqual([]);
  });

  it("line card is kept", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const deletedItemId = "00000000-0000-4000-8000-0000000000c2";

    const fake = createFakeDb({
      folders,
      items: [], // no live items
      cards: [
        { ...cardRow("c_del", PROJECT_ID, 1), kind: "quote", item_id: deletedItemId, quote: "q" },
        cardRow("c_line", PROJECT_ID, 2),
      ],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request(`http://localhost/api/cards?project=${PROJECT_ID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.map((c: { id: string }) => c.id)).toEqual(["c_line"]);
  });

  it("requires project or item parameter", async () => {
    const fake = createFakeDb({});
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request("http://localhost/api/cards"));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/cards/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("creates a line card", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      cards: cardRow(CARD_ID, PROJECT_ID),
    });

    // Mock existing card query returning null
    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "cards") {
        const origThen = q.then;
        (q as { then: unknown }).then = (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => {
          const isCheck = callsOf(q, "select").length > 0 && callsOf(q, "insert").length === 0;
          if (isCheck && callsOf(q, "eq").some((c) => c[0] === "id")) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "line",
      script_line: "Opening hook line",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.id).toBe(CARD_ID);
  });

  it("creates a quote card with source validation", async () => {
    const folders = [
      { id: PROJECT_ID, parent_id: null, name: "Project" },
      { id: GROUP_ID, parent_id: PROJECT_ID, name: "Group" },
    ];
    const item = { id: ITEM_ID, folder_id: GROUP_ID };

    const fake = createFakeDb({
      folders,
      items: item,
      cards: { ...cardRow(CARD_ID, PROJECT_ID), kind: "quote", item_id: ITEM_ID, quote: "A quote" },
    });

    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "cards") {
        const origThen = q.then;
        (q as { then: unknown }).then = (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => {
          const isCheck = callsOf(q, "select").length > 0 && callsOf(q, "insert").length === 0;
          if (isCheck && callsOf(q, "eq").some((c) => c[0] === "id")) {
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "quote",
      item_id: ITEM_ID,
      quote: "A quote",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(200);
  });

  it("404s when item is soft-deleted", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      items: null,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "quote",
      item_id: ITEM_ID,
      quote: "A quote",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(404);
  });

  it("404s when item sits in a soft-deleted group", async () => {
    const DELETED_GROUP_ID = "00000000-0000-4000-8000-0000000000ee";
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      items: { id: ITEM_ID, folder_id: DELETED_GROUP_ID },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "quote",
      item_id: ITEM_ID,
      quote: "A quote",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(404);
  });

  it("refuses quote card without item_id", async () => {
    const fake = createFakeDb({});
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "quote",
      quote: "No source",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(400);
  });

  it("404s when card belongs to another user", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      cards: { id: CARD_ID, user_id: OTHER_USER },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: CARD_ID,
      project_id: PROJECT_ID,
      kind: "line",
      script_line: "Line",
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/cards/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("updates position and script_line", async () => {
    const existing = cardRow(CARD_ID, PROJECT_ID);
    const fake = createFakeDb({
      cards: { ...existing, script_line: "Updated line", position: 5 },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await PATCH(
      jsonRequest("PATCH", { script_line: "Updated line", position: 5 }),
      params(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.script_line).toBe("Updated line");
  });

  it("404s when card item is soft-deleted", async () => {
    const existing = {
      ...cardRow(CARD_ID, PROJECT_ID),
      kind: "quote",
      item_id: ITEM_ID,
      quote: "q",
    };
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      cards: existing,
      items: null,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await PATCH(jsonRequest("PATCH", { quote: "new quote" }), params());
    expect(res.status).toBe(404);
  });

  it("404s when card item is in a soft-deleted group", async () => {
    const DELETED_GROUP_ID = "00000000-0000-4000-8000-0000000000ee";
    const existing = {
      ...cardRow(CARD_ID, PROJECT_ID),
      kind: "quote",
      item_id: ITEM_ID,
      quote: "q",
    };
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      cards: existing,
      items: { id: ITEM_ID, folder_id: DELETED_GROUP_ID },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await PATCH(jsonRequest("PATCH", { quote: "new quote" }), params());
    expect(res.status).toBe(404);
  });

  it("refuses patch that breaks card validation", async () => {
    const existing = cardRow(CARD_ID, PROJECT_ID); // line card
    const fake = createFakeDb({
      cards: existing,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    // A line card cannot have a quote
    const res = await PATCH(jsonRequest("PATCH", { quote: "cannot have quote" }), params());
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/cards/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("deletes a card", async () => {
    const fake = createFakeDb({
      cards: { id: CARD_ID },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await DELETE(
      new Request("http://localhost/api/cards", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: CARD_ID });
  });

  it("404s when card not found", async () => {
    const fake = createFakeDb({
      cards: null,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await DELETE(
      new Request("http://localhost/api/cards", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(404);
  });
});
