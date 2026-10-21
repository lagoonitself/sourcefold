import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_PROJECT_ID = "00000000-0000-4000-8000-0000000000bb";
const GROUP_ID_1 = "00000000-0000-4000-8000-0000000000c1";
const GROUP_ID_2 = "00000000-0000-4000-8000-0000000000c2";
const OTHER_GROUP_ID = "00000000-0000-4000-8000-0000000000d1";

const KEEP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID_1 = "22222222-2222-4222-8222-222222222222";
const OTHER_ID_2 = "33333333-3333-4333-8333-333333333333";

function jsonRequest(payload: unknown) {
  return new Request(`http://localhost/api/items/${KEEP_ID}/merge`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

const params = (id = KEEP_ID) => ({ params: Promise.resolve({ id }) });

describe("POST /api/items/[id]/merge", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("merges items, moves highlights and cards, unions tags, joins notes, and deletes others", async () => {
    const folders = [
      { id: PROJECT_ID, parent_id: null, name: "Project A" },
      { id: GROUP_ID_1, parent_id: PROJECT_ID, name: "Group 1" },
      { id: GROUP_ID_2, parent_id: PROJECT_ID, name: "Group 2" },
    ];

    const keepItem = {
      id: KEEP_ID,
      folder_id: GROUP_ID_1,
      tags: ["Alpha"],
      triage: null,
      summary: null,
      author: null,
      author_type: null,
      note: "Keep note",
    };

    const other1 = {
      id: OTHER_ID_1,
      folder_id: GROUP_ID_2,
      tags: ["Beta", "alpha"],
      triage: "keep",
      summary: "First summary",
      author: "Jane Doe",
      author_type: "researcher",
      note: "Other note",
      created_at: "2026-10-18T00:00:00Z",
    };

    const other2 = {
      id: OTHER_ID_2,
      folder_id: GROUP_ID_1,
      tags: ["Gamma"],
      triage: "cut",
      summary: "Second summary",
      author: "John Smith",
      author_type: "journalist",
      note: "Third note",
      created_at: "2026-10-19T00:00:00Z",
    };

    const fake = createFakeDb({
      folders,
      items: [other1, other2], // for the in("id", ids) query
      highlights: [{ id: "h1" }, { id: "h2" }],
      cards: [{ id: "c1" }],
    });

    // Provide keep item when queried by id = KEEP_ID
    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "items") {
        const origThen = q.then;
        (q as { then: unknown }).then = (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => {
          const eqCalls = callsOf(q, "eq");
          const isKeepQuery = eqCalls.some((c) => c[0] === "id" && c[1] === KEEP_ID);
          if (isKeepQuery) {
            return Promise.resolve({ data: keepItem, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(jsonRequest({ ids: [OTHER_ID_1, OTHER_ID_2] }), params());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.moved_highlights).toBe(2);
    expect(json.data.moved_cards).toBe(1);

    // Verify highlights moved to KEEP_ID
    const hlQuery = fake.queries.find(
      (q) => q.table === "highlights" && callsOf(q, "update").length > 0,
    )!;
    expect(callsOf(hlQuery, "update")[0]![0]).toEqual({ item_id: KEEP_ID });

    // Verify cards moved to KEEP_ID
    const cardQuery = fake.queries.find(
      (q) => q.table === "cards" && callsOf(q, "update").length > 0,
    )!;
    expect(callsOf(cardQuery, "update")[0]![0]).toEqual({ item_id: KEEP_ID });

    // Verify keep item updated with merged fields
    const keepUpdateQuery = fake.queries.find(
      (q) =>
        q.table === "items" &&
        callsOf(q, "eq").some((c) => c[0] === "id" && c[1] === KEEP_ID) &&
        callsOf(q, "update").length > 0,
    )!;
    const updateArg = callsOf(keepUpdateQuery, "update")[0]![0] as Record<string, unknown>;
    expect(updateArg.tags).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(updateArg.triage).toBe("keep"); // from other1
    expect(updateArg.summary).toBe("First summary"); // from other1
    expect(updateArg.author).toBe("Jane Doe"); // from other1
    expect(updateArg.author_type).toBe("researcher"); // from other1
    expect(updateArg.note).toBe("Keep note\n\nOther note"); // joined because both had notes and differed

    // Verify others soft deleted
    const deleteQuery = fake.queries.find(
      (q) =>
        q.table === "items" &&
        callsOf(q, "in").length > 0 &&
        callsOf(q, "update").some(
          (u) => (u[0] as Record<string, unknown> | undefined)?.deleted_at !== undefined,
        ),
    )!;
    expect(deleteQuery).toBeDefined();
  });

  it("refuses if keep id is in ids", async () => {
    const fake = createFakeDb({});
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(jsonRequest({ ids: [KEEP_ID] }), params());
    expect(res.status).toBe(400);
  });

  it("404s if items belong to different projects", async () => {
    const folders = [
      { id: PROJECT_ID, parent_id: null, name: "Project A" },
      { id: GROUP_ID_1, parent_id: PROJECT_ID, name: "Group 1" },
      { id: OTHER_PROJECT_ID, parent_id: null, name: "Project B" },
      { id: OTHER_GROUP_ID, parent_id: OTHER_PROJECT_ID, name: "Group Other" },
    ];

    const keepItem = {
      id: KEEP_ID,
      folder_id: GROUP_ID_1,
      tags: [],
    };

    const otherItem = {
      id: OTHER_ID_1,
      folder_id: OTHER_GROUP_ID,
      tags: [],
    };

    const fake = createFakeDb({
      folders,
      items: [otherItem],
    });

    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "items") {
        const origThen = q.then;
        (q as { then: unknown }).then = (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => {
          const eqCalls = callsOf(q, "eq");
          if (eqCalls.some((c) => c[0] === "id" && c[1] === KEEP_ID)) {
            return Promise.resolve({ data: keepItem, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(jsonRequest({ ids: [OTHER_ID_1] }), params());
    expect(res.status).toBe(404);
  });
});
