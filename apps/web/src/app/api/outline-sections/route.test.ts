import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";
import { DELETE, PUT } from "./[id]/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const GROUP_ID = "00000000-0000-4000-8000-0000000000bb";
const SECTION_ID = "00000000-0000-4000-8000-0000000000cc";

function sectionRow(id: string, projectId: string, title: string, pos = 0) {
  return {
    id,
    user_id: USER_ID,
    project_id: projectId,
    title,
    position: pos,
    created_at: "2026-10-19T00:00:00Z",
    updated_at: "2026-10-19T00:00:00Z",
  };
}

const params = (id = SECTION_ID) => ({ params: Promise.resolve({ id }) });

function jsonRequest(method: string, payload: unknown, id = SECTION_ID) {
  return new Request(`http://localhost/api/outline-sections/${id}`, {
    method,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

describe("GET /api/outline-sections", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("lists sections sorted by sortSections (position, then title, then id)", async () => {
    const fake = createFakeDb({
      outline_sections: [
        sectionRow("s2", PROJECT_ID, "Beta", 2),
        sectionRow("s1", PROJECT_ID, "Alpha", 1),
      ],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(
      new Request(`http://localhost/api/outline-sections?project=${PROJECT_ID}`),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.map((s: { id: string }) => s.id)).toEqual(["s1", "s2"]);
  });

  it("requires project query param", async () => {
    const fake = createFakeDb({});
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request("http://localhost/api/outline-sections"));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/outline-sections/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("creates an outline section", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      outline_sections: sectionRow(SECTION_ID, PROJECT_ID, "Compute", 1),
    });

    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "outline_sections") {
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
      id: SECTION_ID,
      project_id: PROJECT_ID,
      title: "Compute",
      position: 1,
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("Compute");
  });

  it("renames source tags across the project when section title changes", async () => {
    const folders = [
      { id: PROJECT_ID, parent_id: null, name: "Project" },
      { id: GROUP_ID, parent_id: PROJECT_ID, name: "Group" },
    ];
    const existingSection = sectionRow(SECTION_ID, PROJECT_ID, "Old Title", 1);
    const item = {
      id: "item-1",
      folder_id: GROUP_ID,
      tags: ["Old Title", "Keep Tag"],
      created_at: "2026-10-18T00:00:00Z",
    };

    const fake = createFakeDb({
      folders,
      items: [item],
      outline_sections: { ...existingSection, title: "New Title" },
    });

    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "outline_sections") {
        const origThen = q.then;
        (q as { then: unknown }).then = (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => {
          const isCheck = callsOf(q, "select").length > 0 && callsOf(q, "update").length === 0;
          if (isCheck && callsOf(q, "eq").some((c) => c[0] === "id")) {
            return Promise.resolve({ data: existingSection, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: SECTION_ID,
      project_id: PROJECT_ID,
      title: "New Title",
      position: 1,
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(200);

    // Verify item tags were updated to New Title
    const itemUpdateQuery = fake.queries.find(
      (q) =>
        q.table === "items" &&
        callsOf(q, "eq").some((c) => c[0] === "id" && c[1] === "item-1") &&
        callsOf(q, "update").length > 0,
    )!;
    expect(itemUpdateQuery).toBeDefined();
    const updateArg = callsOf(itemUpdateQuery, "update")[0]![0] as Record<string, unknown>;
    expect(updateArg.tags).toEqual(["New Title", "Keep Tag"]);
  });

  it("404s when section belongs to another user", async () => {
    const folders = [{ id: PROJECT_ID, parent_id: null, name: "Project" }];
    const fake = createFakeDb({
      folders,
      outline_sections: { id: SECTION_ID, user_id: OTHER_USER },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const body = {
      id: SECTION_ID,
      project_id: PROJECT_ID,
      title: "Title",
      position: 1,
    };

    const res = await PUT(jsonRequest("PUT", body), params());
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/outline-sections/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("clears card section_id and deletes the section", async () => {
    const fake = createFakeDb({
      cards: [],
      outline_sections: { id: SECTION_ID },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await DELETE(
      new Request("http://localhost/api/outline-sections", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: SECTION_ID });

    // Verify cards update sets section_id = null
    const cardUpdateQuery = fake.queries.find(
      (q) => q.table === "cards" && callsOf(q, "update").length > 0,
    )!;
    expect(callsOf(cardUpdateQuery, "update")[0]![0]).toEqual({ section_id: null });
  });

  it("404s when section does not exist", async () => {
    const fake = createFakeDb({
      cards: [],
      outline_sections: null,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await DELETE(
      new Request("http://localhost/api/outline-sections", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(404);
  });
});
