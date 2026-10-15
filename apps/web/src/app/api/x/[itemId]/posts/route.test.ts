import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));
vi.mock("@/features/capture/save-x", () => ({ rerenderXItem: vi.fn() }));
vi.mock("@/features/drive/push-to-drive-soon", () => ({ pushToDriveSoon: vi.fn() }));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-0000000000bb";

function request() {
  return new Request(`http://localhost/api/x/${ITEM_ID}/posts`, {
    method: "POST",
    body: JSON.stringify({
      post: {
        postUrl: "https://x.com/carol/status/2002",
        authorName: "Carol",
        handle: "carol",
        authorUrl: "https://x.com/carol",
        text: "Reply",
      },
    }),
  });
}

describe("POST /api/x/:itemId/posts", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    // The item lookup and the duplicate lookup both find a row, so the route answers 409.
    fake = createFakeDb({ items: { id: ITEM_ID }, x_posts: { id: "existing" } });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
  });

  it("scopes every lookup to the signed-in user (the admin client bypasses RLS)", async () => {
    const response = await POST(request(), { params: Promise.resolve({ itemId: ITEM_ID }) });

    expect(response.status).toBe(409);
    expect(fake.queries.map((q) => q.table)).toEqual(["items", "x_posts"]);
    for (const query of fake.queries) {
      expect(callsOf(query, "eq")).toContainEqual(["user_id", USER_ID]);
    }
  });
});
