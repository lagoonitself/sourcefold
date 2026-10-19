import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const GROUP_ID_1 = "00000000-0000-4000-8000-0000000000c1";
const GROUP_ID_2 = "00000000-0000-4000-8000-0000000000c2";

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/items/check", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

describe("POST /api/items/check", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("returns exists: true and elsewhere: null when already saved in the same group", async () => {
    const fake = createFakeDb({
      items: {
        id: "item-1",
        folder_id: GROUP_ID_1,
        folders: { name: "Current Group", deleted_at: null },
      },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(
      jsonRequest({
        url: "https://example.com/article",
        folder_id: GROUP_ID_1,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      exists: true,
      item_id: "item-1",
      folder_id: GROUP_ID_1,
      folder_name: "Current Group",
      elsewhere: null,
    });
  });

  it("returns exists: false and elsewhere info when saved in another group of the same project", async () => {
    const folders = [
      { id: PROJECT_ID, parent_id: null, name: "Cars" },
      { id: GROUP_ID_1, parent_id: PROJECT_ID, name: "Engines" },
      { id: GROUP_ID_2, parent_id: PROJECT_ID, name: "Chassis" },
    ];

    // First query is findExistingItemByCanonicalUrl for GROUP_ID_1 (returns null)
    // Second query is findDuplicateElsewhere for canonical_url (returns copy in GROUP_ID_2)
    // Third query is loadLiveFolders (returns folders)
    const fake = createFakeDb({
      folders,
      items: [
        {
          id: "item-elsewhere",
          folder_id: GROUP_ID_2,
          created_at: "2026-10-18T00:00:00Z",
        },
      ],
    });

    let queryCount = 0;
    const origFrom = fake.db.from;
    fake.db.from = (table: string) => {
      const q = origFrom(table);
      if (table === "items") {
        queryCount++;
        const origThen = q.then;
        q.then = (resolve: any) => {
          if (queryCount === 1) {
            // Check in current folder -> not found
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return origThen(resolve);
        };
      }
      return q;
    };

    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(
      jsonRequest({
        url: "https://example.com/article",
        folder_id: GROUP_ID_1,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.exists).toBe(false);
    expect(json.data.elsewhere).toEqual({
      item_id: "item-elsewhere",
      folder_id: GROUP_ID_2,
      folder_path: "Chassis",
    });
  });

  it("returns exists: false and elsewhere: null when not found anywhere", async () => {
    const fake = createFakeDb({
      items: null,
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await POST(
      jsonRequest({
        url: "https://example.com/article",
        folder_id: GROUP_ID_1,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      exists: false,
      elsewhere: null,
    });
  });

  it("returns 400 on bad url or missing folder_id", async () => {
    const fake = createFakeDb({});
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    expect((await POST(jsonRequest({ url: "", folder_id: GROUP_ID_1 }))).status).toBe(400);
    expect(
      (await POST(jsonRequest({ url: "https://x.com", folder_id: "not-a-uuid" }))).status,
    ).toBe(400);
  });
});
