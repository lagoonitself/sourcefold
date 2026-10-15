import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";

const FOLDERS = [
  { id: "p1", parent_id: null, name: "Cars", position: 0, archived_at: null },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0, archived_at: null },
  {
    id: "p2",
    parent_id: null,
    name: "Old project",
    position: 1,
    archived_at: "2026-10-01T00:00:00Z",
  },
  { id: "g2", parent_id: "p2", name: "Old group", position: 0, archived_at: null },
];

describe("GET /api/folders", () => {
  beforeEach(() => {
    const { db } = createFakeDb({ folders: FOLDERS }, { folder_item_counts: [] });
    requireApiUser.mockResolvedValue({ db, userId: USER_ID, via: "token" });
  });

  async function ids(url: string) {
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    const body = await response.json();
    return (body.data as { id: string }[]).map((f) => f.id);
  }

  it("hides archived projects and their groups by default", async () => {
    expect(await ids("http://localhost/api/folders")).toEqual(["p1", "g1"]);
  });

  it("keeps hiding them for includeArchived values other than true", async () => {
    expect(await ids("http://localhost/api/folders?includeArchived=false")).toEqual(["p1", "g1"]);
  });

  it("includes archived projects and their groups with includeArchived=true", async () => {
    const all = await ids("http://localhost/api/folders?includeArchived=true");
    expect([...all].sort()).toEqual(["g1", "g2", "p1", "p2"]);
  });
});
