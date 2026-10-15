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

describe("GET /api/items", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    fake = createFakeDb({ items: [{ id: "i1", note: "n", canonical_url: "https://x.com/a" }] });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
  });

  function selectedColumns() {
    const [args] = callsOf(fake.queries[0]!, "select");
    return String(args![0])
      .split(",")
      .map((c) => c.trim());
  }

  it("lists a group's items with note and canonical_url, without article text", async () => {
    const response = await GET(new Request(`http://localhost/api/items?folder=${FOLDER_ID}`));

    expect(response.status).toBe(200);
    expect(selectedColumns()).toEqual(expect.arrayContaining(["note", "canonical_url"]));
    expect(selectedColumns()).not.toContain("markdown");
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
  });

  it("returns note and canonical_url from title search too", async () => {
    const response = await GET(new Request("http://localhost/api/items?q=engine"));

    expect(response.status).toBe(200);
    expect(selectedColumns()).toEqual(expect.arrayContaining(["note", "canonical_url"]));
    expect(selectedColumns()).not.toContain("markdown");
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
  });
});
