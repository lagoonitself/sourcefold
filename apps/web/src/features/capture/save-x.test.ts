import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { callsOf, createFakeDb } from "@/test/fake-db";
import { rerenderXItem, saveXThread } from "./save-x";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-0000000000aa";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000ff";

vi.mock("./find-duplicate", () => ({
  findDuplicate: vi.fn().mockResolvedValue(null),
  findDuplicateElsewhere: vi.fn().mockResolvedValue(null),
  formatDuplicateMessage: (name: string) => `Already in ${name}`,
  invalidFolderMessage: (msg: string) => msg,
  elsewhereError: () => ({ code: "duplicate", message: "elsewhere" }),
  nextPosition: vi.fn().mockResolvedValue(0),
}));

describe("rerenderXItem", () => {
  it("re-renders stored rows with media into Markdown containing ![Image](https://pbs.twimg.com/media/...?name=orig)", async () => {
    const postRow = {
      id: "post-1",
      user_id: USER_ID,
      item_id: ITEM_ID,
      parent_id: null,
      position: 0,
      post_url: "https://x.com/alice/status/100",
      canonical_url: "https://x.com/alice/status/100",
      author_name: "Alice",
      handle: "alice",
      author_url: "https://x.com/alice",
      posted_at: "2026-10-21T10:00:00Z",
      text: "Look at this picture and GIF",
      media: [
        { type: "photo", url: "https://pbs.twimg.com/media/xyz789.jpg?name=orig", alt: null },
        {
          type: "gif",
          url: "https://video.twimg.com/tweet_video/gif123.mp4",
          alt: "Funny animation",
        },
      ],
    };

    const itemRow = {
      id: ITEM_ID,
      user_id: USER_ID,
      title: "Post by Alice (@alice)",
    };

    const fake = createFakeDb({
      x_posts: [postRow],
      items: itemRow,
    });
    const db = fake.db as unknown as SupabaseClient<Database>;

    const result = await rerenderXItem(db, USER_ID, ITEM_ID);

    expect(result.markdown).toContain("![Image](https://pbs.twimg.com/media/xyz789.jpg?name=orig)");
    expect(result.markdown).toContain(
      "![Funny animation](https://video.twimg.com/tweet_video/gif123.mp4)",
    );

    const updateQuery = fake.queries.find(
      (q) => q.table === "items" && callsOf(q, "update").length > 0,
    );
    expect(updateQuery).toBeDefined();
    const updateArgs = callsOf(updateQuery!, "update")[0]![0] as Record<string, unknown>;
    expect(updateArgs.markdown).toContain(
      "![Image](https://pbs.twimg.com/media/xyz789.jpg?name=orig)",
    );
  });
});

describe("saveXThread", () => {
  it("stores normalized media in x_posts and renders media into Markdown", async () => {
    const itemRow = {
      id: ITEM_ID,
      folder_id: FOLDER_ID,
      kind: "x",
      title: "Post by Alice (@alice)",
      source_url: "https://x.com/alice/status/100",
      status: "saved",
      created_at: "2026-10-21T10:00:00Z",
    };

    const fake = createFakeDb({
      items: itemRow,
      x_posts: [],
    });
    const db = fake.db as unknown as SupabaseClient<Database>;

    const result = await saveXThread(db, USER_ID, FOLDER_ID, [
      {
        postUrl: "https://x.com/alice/status/100",
        authorName: "Alice",
        handle: "alice",
        authorUrl: "https://x.com/alice",
        postedAt: "2026-10-21T10:00:00Z",
        text: "Here is a cool photo",
        media: [
          {
            type: "photo",
            url: "https://pbs.twimg.com/media/snapshot.jpg?name=orig",
            alt: "Sunset",
          },
          { type: "photo", url: "https://not-allowed.com/sunset.jpg" },
        ],
      },
    ]);

    expect(result.success).toBe(true);

    const itemInsert = fake.queries.find(
      (q) => q.table === "items" && callsOf(q, "insert").length > 0,
    );
    expect(itemInsert).toBeDefined();
    const itemPayload = callsOf(itemInsert!, "insert")[0]![0] as Record<string, unknown>;
    expect(itemPayload.markdown).toContain(
      "![Sunset](https://pbs.twimg.com/media/snapshot.jpg?name=orig)",
    );
    expect(itemPayload.markdown).not.toContain("not-allowed.com");

    const postsInsert = fake.queries.find(
      (q) => q.table === "x_posts" && callsOf(q, "insert").length > 0,
    );
    expect(postsInsert).toBeDefined();
    const insertedRows = callsOf(postsInsert!, "insert")[0]![0] as Array<Record<string, unknown>>;
    expect(insertedRows[0]!.media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/snapshot.jpg?name=orig", alt: "Sunset" },
    ]);
  });
});
