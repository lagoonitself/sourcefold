import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));
vi.mock("@sourcefold/client/features/capture/save-x", () => ({ rerenderXItem: vi.fn() }));
vi.mock("@/features/drive/push-to-drive-soon", () => ({ pushToDriveSoon: vi.fn() }));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-0000000000bb";

function request(postOverrides: Record<string, unknown> = {}) {
  return new Request(`http://localhost/api/x/${ITEM_ID}/posts`, {
    method: "POST",
    body: JSON.stringify({
      post: {
        postUrl: "https://x.com/carol/status/2002",
        authorName: "Carol",
        handle: "carol",
        authorUrl: "https://x.com/carol",
        text: "Reply",
        ...postOverrides,
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

  it("keeps valid media, drops invalid silently, and stores normalized media in x_posts", async () => {
    // For successful insert:
    // 1st query: items (found)
    // 2nd query: x_posts (duplicate check -> null)
    // 3rd query: x_posts (existingPosts list -> [rootPost])
    // 4th query: x_posts (insert -> returns { id: "new-post-123" })
    let duplicateChecked = false;
    const fakeDb = {
      from(table: string) {
        const calls: { method: string; args: unknown[] }[] = [];
        const query = {
          table,
          calls,
          then(resolve: (value: { data: unknown; error: null }) => unknown) {
            if (table === "items") {
              return Promise.resolve({ data: { id: ITEM_ID }, error: null }).then(resolve);
            }
            if (table === "x_posts") {
              const hasInsert = calls.some((c) => c.method === "insert");
              if (hasInsert) {
                return Promise.resolve({ data: { id: "new-post-123" }, error: null }).then(resolve);
              }
              if (!duplicateChecked) {
                duplicateChecked = true;
                return Promise.resolve({ data: null, error: null }).then(resolve);
              }
              return Promise.resolve({
                data: [
                  {
                    id: "root-post",
                    parent_id: null,
                    canonical_url: "https://x.com/carol/status/1000",
                    position: 0,
                  },
                ],
                error: null,
              }).then(resolve);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        for (const method of [
          "select",
          "insert",
          "update",
          "delete",
          "upsert",
          "eq",
          "in",
          "is",
          "ilike",
          "order",
          "limit",
          "range",
          "single",
          "maybeSingle",
        ]) {
          (query as Record<string, unknown>)[method] = (...args: unknown[]) => {
            calls.push({ method, args });
            return query;
          };
        }
        queries.push(query);
        return query;
      },
    };
    const queries: { table: string; calls: { method: string; args: unknown[] }[] }[] = [];
    requireApiUser.mockResolvedValue({ db: fakeDb, userId: USER_ID, via: "token" });

    const mediaInput = [
      { type: "photo", url: "https://pbs.twimg.com/media/validPhoto.jpg", alt: "A valid photo" },
      { type: "photo", url: "https://evil.com/pic.jpg", alt: "Evil host" },
      { type: "photo", url: "javascript:alert(1)" },
      { type: "gif", url: "https://video.twimg.com/tweet_video/validGif.mp4", alt: "A GIF" },
      { type: "video", durationSeconds: 15 },
      { type: "invalid_type", foo: "bar" },
    ];

    const response = await POST(request({ media: mediaInput }), {
      params: Promise.resolve({ itemId: ITEM_ID }),
    });

    expect(response.status).toBe(201);
    const insertQuery = queries.find(
      (q) => q.table === "x_posts" && q.calls.some((c) => c.method === "insert"),
    );
    expect(insertQuery).toBeDefined();
    const insertCall = insertQuery!.calls.find((c) => c.method === "insert")!;
    const insertedRow = insertCall.args[0] as Record<string, unknown>;

    expect(insertedRow.media).toEqual([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/validPhoto.jpg?name=orig",
        alt: "A valid photo",
      },
      { type: "gif", url: "https://video.twimg.com/tweet_video/validGif.mp4", alt: "A GIF" },
      { type: "video", durationSeconds: 15 },
    ]);
  });

  it("returns 400 when media array has more than 20 elements", async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({
      type: "photo",
      url: `https://pbs.twimg.com/media/photo_${i}.jpg`,
    }));

    const response = await POST(request({ media: tooMany }), {
      params: Promise.resolve({ itemId: ITEM_ID }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("invalid_request");
  });
});
