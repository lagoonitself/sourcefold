import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Row } from "@/features/project-file/memory-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const GROUP = "00000000-0000-4000-8000-0000000000b1";
const SUBGROUP = "00000000-0000-4000-8000-0000000000b2";
const DELETED_GROUP = "00000000-0000-4000-8000-0000000000b3";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a2";
const OTHER_GROUP = "00000000-0000-4000-8000-0000000000b9";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const params = (id = PROJECT) => ({ params: Promise.resolve({ id }) });
const folder = (id: string, parent_id: string | null, extra: Row = {}): Row => ({
  id,
  user_id: USER,
  parent_id,
  name: id,
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
  deleted_at: null,
  ...extra,
});
function item(n: number, extra: Row = {}): Row {
  return {
    id: uuid(n),
    user_id: USER,
    folder_id: GROUP,
    kind: "web",
    title: `Source ${n}`,
    source_url: null,
    canonical_url: null,
    status: "saved",
    meta: {},
    note: null,
    position: n,
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    triage: null,
    tags: [],
    summary: null,
    author: null,
    author_type: null,
    storage_path: null,
    drive_file_id: null,
    markdown: "text",
    deleted_at: null,
    ...extra,
  };
}

function get(table: string | null, from?: number, id = PROJECT) {
  const query = new URLSearchParams();
  if (table) query.set("table", table);
  if (from !== undefined) query.set("from", String(from));
  return GET(new Request(`http://localhost/api/projects/${id}/export?${query}`), params(id));
}

function setup(tables: Record<string, Row[]> = {}) {
  const memory = createMemoryDb({
    folders: [
      folder(PROJECT, null, { name: "Cars" }),
      folder(GROUP, PROJECT, { name: "Engines", position: 2 }),
      folder(SUBGROUP, GROUP, { name: "Diesel", position: 1 }),
      folder(DELETED_GROUP, PROJECT, { deleted_at: "2026-10-03T00:00:00Z" }),
      folder(OTHER_PROJECT, null, { user_id: OTHER }),
      folder(OTHER_GROUP, OTHER_PROJECT, { user_id: OTHER }),
    ],
    items: [],
    ...tables,
  });
  requireApiUser.mockResolvedValue({ db: memory.db, userId: USER, via: "token" });
  return memory;
}

const xPost = (n: number, itemId: string): Row => ({
  id: uuid(n),
  user_id: USER,
  item_id: itemId,
  parent_id: null,
  media: [{ type: "gif" }],
  position: 0,
  created_at: "2026-10-02T00:00:00Z",
  post_url: "u",
  canonical_url: "c",
  author_name: "a",
  handle: "h",
  author_url: "au",
  posted_at: null,
  text: "t",
});

const highlight = (n: number, itemId: string): Row => ({
  id: uuid(n),
  user_id: USER,
  item_id: itemId,
  kind: "text",
  quote: "q",
  prefix: "",
  suffix: "",
  start_offset: 0,
  end_offset: 1,
  image_src: null,
  note: null,
  seconds: null,
  cited: [],
  created_at: "2026-10-02T00:00:00Z",
});

const card = (n: number, extra: Row): Row => ({
  id: uuid(n),
  user_id: USER,
  project_id: PROJECT,
  kind: "line",
  item_id: null,
  highlight_id: null,
  quote: "",
  seconds: null,
  end_seconds: null,
  url: null,
  note: null,
  script_line: "x",
  section_id: null,
  position: n,
  created_at: "2026-10-02T00:00:00Z",
  ...extra,
});

describe("GET /api/projects/[id]/export", () => {
  beforeEach(() => requireApiUser.mockReset());

  it("passes on a failed sign-in", async () => {
    requireApiUser.mockResolvedValue({
      response: Response.json({ error: { message: "Sign in to continue." } }, { status: 401 }),
    });
    expect((await get("groups")).status).toBe(401);
  });

  it("answers 404 for another user's project, a group, or a missing id", async () => {
    setup();
    expect((await get("groups", 0, OTHER_PROJECT)).status).toBe(404);
    expect((await get("groups", 0, GROUP)).status).toBe(404);
    expect((await get("groups", 0, DELETED_GROUP)).status).toBe(404);
    expect((await get("groups", 0, uuid(99))).status).toBe(404);
  });

  it("refuses a bad project id, table or offset", async () => {
    setup();
    expect((await get("groups", 0, "nope")).status).toBe(400);
    expect((await get("users")).status).toBe(400);
    expect((await get(null)).status).toBe(400);
    expect((await get("groups", -1)).status).toBe(400);
  });

  it("lists live groups with the project as no parent, in position order", async () => {
    setup();
    const body = await (await get("groups")).json();
    expect(body.data.project).toEqual({
      id: PROJECT,
      name: "Cars",
      created_at: "2026-10-01T00:00:00Z",
    });
    expect(body.data.next).toBeNull();
    expect(body.data.rows.map((g: Row) => [g.id, g.parent_id])).toEqual([
      [SUBGROUP, GROUP],
      [GROUP, null],
    ]);
  });

  it("maps sources to the manifest shape and leaves out deleted and other users' items", async () => {
    setup({
      items: [
        item(1, { kind: "image", storage_path: `${USER}/${uuid(1)}/photo.JPG`, markdown: null }),
        item(2, { folder_id: SUBGROUP, markdown: null, drive_file_id: "drive-2" }),
        item(3, { status: "failed", markdown: null }),
        item(4, { deleted_at: "2026-10-03T00:00:00Z" }),
        item(5, { user_id: OTHER }),
        item(6, { folder_id: OTHER_GROUP }),
        item(7, { kind: "image", markdown: null, meta: { mime_type: "image/webp" } }),
        item(8, { kind: "note", markdown: null }),
      ],
    });
    const { data } = await (await get("sources")).json();
    const byId = new Map<string, Row>(data.rows.map((r: Row) => [r.id as string, r]));
    expect([...byId.keys()].sort()).toEqual([1, 2, 3, 7, 8].map(uuid));

    expect(byId.get(uuid(1))).toMatchObject({ group_id: GROUP, extension: "jpg", has_file: true });
    expect(byId.get(uuid(2))).toMatchObject({
      group_id: SUBGROUP,
      extension: "md",
      has_file: true,
    });
    expect(byId.get(uuid(3))).toMatchObject({ has_file: false });
    // An image with nothing stored has no file; its extension comes from its type.
    expect(byId.get(uuid(7))).toMatchObject({ extension: "webp", has_file: false });
    expect(byId.get(uuid(8))).toMatchObject({ extension: "md", has_file: false });
    expect(byId.get(uuid(1))).not.toHaveProperty("markdown");
    expect(byId.get(uuid(1))).not.toHaveProperty("user_id");
  });

  it("pages sources 500 at a time with a stable order", async () => {
    setup({ items: Array.from({ length: 501 }, (_, i) => item(i + 1, { position: 501 - i })) });
    const first = (await (await get("sources", 0)).json()).data;
    expect(first.rows).toHaveLength(500);
    expect(first.next).toBe(500);
    // Lowest position first: the last item made.
    expect(first.rows[0].id).toBe(uuid(501));

    const second = (await (await get("sources", 500)).json()).data;
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0].id).toBe(uuid(1));
    expect(second.next).toBeNull();

    const past = (await (await get("sources", 900)).json()).data;
    expect(past.rows).toEqual([]);
    expect(past.next).toBeNull();
  });

  it("ends a page exactly full with no next", async () => {
    setup({ items: Array.from({ length: 500 }, (_, i) => item(i + 1)) });
    const page = (await (await get("sources", 0)).json()).data;
    expect(page.rows).toHaveLength(500);
    expect(page.next).toBeNull();
  });

  it("renames item_id to source_id and hides rows of deleted sources", async () => {
    const live = uuid(1);
    const gone = uuid(2);
    setup({
      items: [item(1, { kind: "x" }), item(2, { deleted_at: "2026-10-03T00:00:00Z" })],
      x_posts: [xPost(11, live), xPost(12, gone)],
      highlights: [highlight(21, live), highlight(22, gone)],
    });
    const posts = (await (await get("x_posts")).json()).data.rows;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id: uuid(11), source_id: live, media: [{ type: "gif" }] });
    expect(posts[0]).not.toHaveProperty("item_id");

    const highlights = (await (await get("highlights")).json()).data.rows;
    expect(highlights.map((h: Row) => [h.id, h.source_id])).toEqual([[uuid(21), live]]);
  });

  it("lists this project's outline sections and cards, dropping cards of deleted sources", async () => {
    const live = uuid(1);
    const gone = uuid(2);
    setup({
      items: [item(1), item(2, { deleted_at: "2026-10-03T00:00:00Z" })],
      highlights: [highlight(21, live)],
      outline_sections: [
        {
          id: uuid(31),
          user_id: USER,
          project_id: PROJECT,
          title: "Intro",
          position: 1,
          created_at: "2026-10-02T00:00:00Z",
        },
        {
          id: uuid(32),
          user_id: USER,
          project_id: OTHER_PROJECT,
          title: "No",
          position: 1,
          created_at: "2026-10-02T00:00:00Z",
        },
      ],
      cards: [
        card(41, { kind: "quote", item_id: live, highlight_id: uuid(21) }),
        card(42, { kind: "quote", item_id: gone }),
        card(43, { highlight_id: uuid(77) }),
        card(44, { project_id: OTHER_PROJECT }),
        card(45, { user_id: OTHER }),
      ],
    });
    const sections = (await (await get("outline_sections")).json()).data.rows;
    expect(sections.map((s: Row) => s.id)).toEqual([uuid(31)]);

    const cards = (await (await get("cards")).json()).data.rows;
    expect(cards.map((c: Row) => [c.id, c.source_id, c.highlight_id])).toEqual([
      [uuid(41), live, uuid(21)],
      [uuid(43), null, null],
    ]);
  });
});
