import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000aa";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000bb";
const GROUP_ID_1 = "00000000-0000-4000-8000-0000000000c1";
const GROUP_ID_2 = "00000000-0000-4000-8000-0000000000c2";

describe("GET /api/items", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    fake = createFakeDb({ items: [{ id: "i1", note: "n", canonical_url: "https://x.com/a" }] });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
  });

  function selectedColumns(queryIndex = 0) {
    const [args] = callsOf(fake.queries[queryIndex]!, "select");
    return String(args![0])
      .split(",")
      .map((c) => c.trim());
  }

  it("lists a group's items with note, canonical_url and research fields", async () => {
    const response = await GET(new Request(`http://localhost/api/items?folder=${FOLDER_ID}`));

    expect(response.status).toBe(200);
    expect(selectedColumns()).toEqual(
      expect.arrayContaining([
        "note",
        "canonical_url",
        "triage",
        "tags",
        "summary",
        "author",
        "author_type",
      ]),
    );
    expect(selectedColumns()).not.toContain("markdown");
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
  });

  it("returns note, canonical_url and research fields from title search too", async () => {
    const response = await GET(new Request("http://localhost/api/items?q=engine"));

    expect(response.status).toBe(200);
    expect(selectedColumns()).toEqual(
      expect.arrayContaining([
        "note",
        "canonical_url",
        "triage",
        "tags",
        "summary",
        "author",
        "author_type",
      ]),
    );
    expect(selectedColumns()).not.toContain("markdown");
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
  });

  it("lists every live item across all groups of a project", async () => {
    fake = createFakeDb({
      folders: [
        { id: PROJECT_ID, parent_id: null, name: "Cars" },
        { id: GROUP_ID_1, parent_id: PROJECT_ID, name: "Engines" },
        { id: GROUP_ID_2, parent_id: GROUP_ID_1, name: "Diesel" },
      ],
      items: [
        { id: "i2", created_at: "2026-10-18T00:00:00Z", folder_id: GROUP_ID_2 },
        { id: "i1", created_at: "2026-10-17T00:00:00Z", folder_id: GROUP_ID_1 },
      ],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const response = await GET(new Request(`http://localhost/api/items?project=${PROJECT_ID}`));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.map((item: { id: string }) => item.id)).toEqual(["i1", "i2"]);

    // Items query checked user_id and group ids
    const itemsQuery = fake.queries.find((q) => q.table === "items")!;
    expect(callsOf(itemsQuery, "eq")).toContainEqual(["user_id", USER_ID]);
    expect(callsOf(itemsQuery, "in")).toContainEqual(["folder_id", [GROUP_ID_1, GROUP_ID_2]]);
  });

  it("404s when the project does not exist", async () => {
    fake = createFakeDb({
      folders: [{ id: "other-id", parent_id: null, name: "Other" }],
      items: [],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const response = await GET(new Request(`http://localhost/api/items?project=${PROJECT_ID}`));
    expect(response.status).toBe(404);
  });

  it("returns empty array when project has no groups", async () => {
    fake = createFakeDb({
      folders: [{ id: PROJECT_ID, parent_id: null, name: "Empty Project" }],
      items: [],
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const response = await GET(new Request(`http://localhost/api/items?project=${PROJECT_ID}`));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toEqual([]);
  });
});
