import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Row } from "@/features/project-file/memory-db";

const requireApiUser = vi.fn();
const pushToDriveSoon = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));
vi.mock("@/features/drive/push-to-drive-soon", () => ({
  pushToDriveSoon: (userId: string) => pushToDriveSoon(userId),
}));

import { POST } from "./route";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a2";
const OTHER_GROUP = "00000000-0000-4000-8000-0000000000b9";
const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const G1 = uuid(1);
const G2 = uuid(2);
const S1 = uuid(11);
const S2 = uuid(12);
const IMG = uuid(13);
const P1 = uuid(21);
const P2 = uuid(22);
const H1 = uuid(31);
const SEC = uuid(41);
const C1 = uuid(51);

const NOW = "2026-10-02T10:00:00.000Z";

const group = (id: string, parent_id: string | null, name = "Group") => ({
  id,
  parent_id,
  name,
  position: 1,
  created_at: NOW,
});
const source = (id: string, group_id: string, extra: Row = {}) => ({
  id,
  group_id,
  kind: "web",
  title: "A source",
  source_url: "https://example.com/a",
  canonical_url: "https://example.com/a",
  meta: { site: "example.com" },
  note: "my note",
  position: 3,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: NOW,
  triage: "keep",
  tags: ["Cars", " cars ", "Engines"],
  summary: "short",
  author: "Ada",
  author_type: "journalist",
  markdown: "# Body",
  storage_path: null,
  ...extra,
});
const xPost = (id: string, source_id: string, parent_id: string | null, extra: Row = {}) => ({
  id,
  source_id,
  parent_id,
  post_url: `https://x.com/a/status/${id}`,
  canonical_url: `https://x.com/a/status/${id}`,
  author_name: "Ada",
  handle: "@ada",
  author_url: "https://x.com/ada",
  posted_at: NOW,
  text: "hello",
  media: [],
  position: 0,
  created_at: NOW,
  ...extra,
});
const highlight = (id: string, source_id: string, extra: Row = {}) => ({
  id,
  source_id,
  kind: "text",
  quote: "quote",
  prefix: "",
  suffix: "",
  start_offset: 0,
  end_offset: 5,
  image_src: null,
  note: null,
  seconds: null,
  cited: [],
  created_at: NOW,
  ...extra,
});
const card = (id: string, extra: Row = {}) => ({
  id,
  kind: "quote",
  source_id: S1,
  highlight_id: H1,
  quote: "quote",
  seconds: null,
  end_seconds: null,
  url: null,
  note: null,
  script_line: null,
  section_id: SEC,
  position: 1,
  created_at: NOW,
  ...extra,
});

function setup(tables: Record<string, Row[]> = {}, storage: Record<string, string[]> = {}) {
  const memory = createMemoryDb(
    {
      folders: [
        {
          id: OTHER_PROJECT,
          user_id: OTHER,
          parent_id: null,
          name: "Theirs",
          position: 0,
          deleted_at: null,
        },
        {
          id: OTHER_GROUP,
          user_id: OTHER,
          parent_id: OTHER_PROJECT,
          name: "G",
          position: 0,
          deleted_at: null,
        },
      ],
      ...tables,
    },
    storage,
  );
  requireApiUser.mockResolvedValue({ db: memory.db, userId: USER, via: "token" });
  return memory;
}

function post(body: unknown, id = PROJECT, raw?: string) {
  return POST(
    new Request(`http://localhost/api/projects/${id}/import`, {
      method: "POST",
      body: raw ?? JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function messageOf(res: Response) {
  return ((await res.json()) as { error: { message: string } }).error.message;
}

async function create(extra: Record<string, unknown> = {}, name = "Cars") {
  return post({ project: { name }, groups: [group(G1, null, "Engines")], ...extra });
}

describe("POST /api/projects/[id]/import", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
    pushToDriveSoon.mockReset();
  });

  it("passes on a failed sign-in", async () => {
    requireApiUser.mockResolvedValue({
      response: Response.json({ error: { message: "Sign in to continue." } }, { status: 401 }),
    });
    expect((await create()).status).toBe(401);
  });

  it("creates the project after the user's other projects and answers its name", async () => {
    const memory = setup({
      folders: [
        {
          id: uuid(90),
          user_id: USER,
          parent_id: null,
          name: "Cars",
          position: 4,
          deleted_at: null,
        },
      ],
    });
    const res = await create({ groups: [group(G1, null, "Engines"), group(G2, G1, "Diesel")] });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ name: "Cars (2)" });

    const folders = memory.tables.folders!;
    expect(folders.find((f) => f.id === PROJECT)).toMatchObject({
      user_id: USER,
      parent_id: null,
      name: "Cars (2)",
      position: 5,
    });
    // A group directly in the project is saved under the project; the other under its parent.
    expect(folders.find((f) => f.id === G1)).toMatchObject({ parent_id: PROJECT, user_id: USER });
    expect(folders.find((f) => f.id === G2)).toMatchObject({ parent_id: G1, user_id: USER });
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });

  it("refuses a project id that is taken, and a later call for a project that isn't there", async () => {
    setup({
      folders: [{ id: PROJECT, user_id: OTHER, parent_id: null, name: "X", deleted_at: null }],
    });
    // The id exists (even if it's someone else's): refused without touching it.
    expect((await create()).status).toBe(409);

    setup();
    expect((await post({ sources: [] }, uuid(77))).status).toBe(404);
    // Another user's project is a 404 too.
    expect((await post({ groups: [] }, OTHER_PROJECT)).status).toBe(404);
  });

  it("returns the current name on a later call", async () => {
    setup();
    await create();
    const res = await post({ done: true });
    expect((await res.json()).data).toEqual({ name: "Cars" });
    expect(pushToDriveSoon).toHaveBeenCalledWith(USER);
  });

  it("saves sources with their given ids, dates and research fields, as a fresh capture", async () => {
    const memory = setup();
    await create();
    const res = await post(
      {
        sources: [
          source(S1, G1),
          source(S2, G1, {
            kind: "x",
            canonical_url: "https://x.com/a/status/1",
            triage: "bogus",
            author_type: "nope",
            tags: [],
            created_at: "not a date",
          }),
        ],
      },
      PROJECT,
    );
    expect(res.status).toBe(200);
    const items = memory.tables.items!;
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === S1)).toMatchObject({
      user_id: USER,
      folder_id: G1,
      kind: "web",
      status: "saved",
      markdown: "# Body",
      position: 3,
      created_at: "2026-09-01T10:00:00.000Z",
      note: "my note",
      triage: "keep",
      tags: ["Cars", "Engines"],
      author_type: "journalist",
      meta: { site: "example.com" },
    });
    expect(items.find((i) => i.id === S2)).toMatchObject({
      kind: "x",
      triage: null,
      author_type: null,
    });
  });

  it("rejects a source in a group that isn't in this project", async () => {
    const memory = setup({
      folders: [
        { id: G2, user_id: USER, parent_id: uuid(80), name: "Elsewhere", deleted_at: null },
      ],
    });
    await create();
    for (const group_id of [OTHER_GROUP, G2, PROJECT, uuid(99)]) {
      const res = await post({ sources: [source(S1, group_id)] });
      expect(res.status).toBe(400);
      expect(await messageOf(res)).toContain("group that isn't in this project");
    }
    expect(memory.tables.items ?? []).toHaveLength(0);
  });

  it("rejects a group whose parent is not in the project, or whose id is taken", async () => {
    setup();
    await create();
    const lost = await post({ groups: [group(G2, uuid(81))] });
    expect(lost.status).toBe(400);
    expect(await messageOf(lost)).toContain("isn't in this project");

    const taken = await post({ groups: [group(G1, null)] });
    expect(taken.status).toBe(400);
    expect(await messageOf(taken)).toContain("already imported");
  });

  it("checks an image's storage path and that the object was uploaded", async () => {
    const memory = setup({}, { [`${USER}/${IMG}`]: ["photo.png"] });
    await create();
    const image = (storage_path: string | null) =>
      source(IMG, G1, { kind: "image", markdown: null, storage_path, canonical_url: null });

    for (const path of [
      `${OTHER}/${IMG}/photo.png`,
      `${USER}/${uuid(14)}/photo.png`,
      `${USER}/${IMG}/../photo.png`,
      `${USER}/${IMG}/a/photo.png`,
    ]) {
      expect((await post({ sources: [image(path)] })).status).toBe(400);
    }
    const missing = await post({ sources: [image(`${USER}/${IMG}/other.png`)] });
    expect(missing.status).toBe(400);
    expect(await messageOf(missing)).toContain("wasn't uploaded");

    const text = await post({ sources: [source(S1, G1, { storage_path: `${USER}/${S1}/a.png` })] });
    expect(text.status).toBe(400);

    const ok = await post({ sources: [image(`${USER}/${IMG}/photo.png`)] });
    expect(ok.status).toBe(200);
    expect(memory.tables.items![0]).toMatchObject({
      kind: "image",
      status: "saved",
      markdown: null,
      storage_path: `${USER}/${IMG}/photo.png`,
    });
  });

  it("saves X posts as a thread, checking the source and the parent", async () => {
    const memory = setup();
    await create();
    await post({ sources: [source(S1, G1, { kind: "x" }), source(S2, G1)] });

    const orphan = await post({ x_posts: [xPost(P1, uuid(95), null)] });
    expect(orphan.status).toBe(400);
    expect(await messageOf(orphan)).toContain("source that isn't in this project");

    const wrongParent = await post({ x_posts: [xPost(P1, S1, uuid(96))] });
    expect(wrongParent.status).toBe(400);

    const ok = await post({ x_posts: [xPost(P1, S1, null), xPost(P2, S1, P1)] });
    expect(ok.status).toBe(200);
    expect(memory.tables.x_posts!.map((p) => [p.id, p.item_id, p.parent_id, p.user_id])).toEqual([
      [P1, S1, null, USER],
      [P2, S1, P1, USER],
    ]);
    expect(memory.tables.x_posts![0]!.handle).toBe("ada");

    // A reply to a post of another thread is refused.
    const cross = await post({ x_posts: [xPost(uuid(23), S2, P1)] });
    expect(cross.status).toBe(400);
  });

  it("rejects highlights and cards that point outside the project", async () => {
    const memory = setup({
      items: [
        {
          id: uuid(70),
          user_id: OTHER,
          folder_id: OTHER_GROUP,
          deleted_at: null,
        },
      ],
      highlights: [{ id: uuid(71), user_id: OTHER, item_id: uuid(70) }],
      outline_sections: [{ id: uuid(72), user_id: OTHER, project_id: OTHER_PROJECT, title: "x" }],
    });
    await create();
    await post({ sources: [source(S1, G1)] });

    const foreignSource = await post({ highlights: [highlight(H1, uuid(70))] });
    expect(foreignSource.status).toBe(400);

    expect((await post({ highlights: [highlight(H1, S1)] })).status).toBe(200);
    expect(memory.tables.highlights!.filter((h) => h.user_id === USER)).toHaveLength(1);
    const backwards = await post({
      highlights: [highlight(uuid(32), S1, { start_offset: 9, end_offset: 2 })],
    });
    expect(backwards.status).toBe(400);

    await post({ outline_sections: [{ id: SEC, title: "Intro", position: 1, created_at: NOW }] });

    for (const bad of [
      card(C1, { source_id: uuid(70) }),
      card(C1, { highlight_id: uuid(71) }),
      card(C1, { section_id: uuid(72) }),
      card(C1, { section_id: uuid(97) }),
      card(C1, { highlight_id: uuid(98) }),
    ]) {
      expect((await post({ cards: [bad] })).status).toBe(400);
    }
    expect(memory.tables.cards ?? []).toHaveLength(0);

    expect((await post({ cards: [card(C1)] })).status).toBe(200);
    expect(memory.tables.cards![0]).toMatchObject({
      project_id: PROJECT,
      user_id: USER,
      item_id: S1,
      highlight_id: H1,
      section_id: SEC,
    });
    expect(memory.tables.outline_sections!.find((r) => r.id === SEC)).toMatchObject({
      project_id: PROJECT,
      user_id: USER,
    });
  });

  it("refuses ids that aren't uuids, too many rows and a body that is too big", async () => {
    setup();
    await create();
    expect((await post({ sources: [source("nope", G1)] })).status).toBe(400);
    const many = Array.from({ length: 1001 }, (_, i) => group(uuid(1000 + i), null));
    expect((await post({ groups: many })).status).toBe(400);
    expect((await post({ markdown: "x" }, PROJECT, "{not json")).status).toBe(400);
    expect((await post({}, "nope")).status).toBe(400);

    const huge = await post({ sources: [source(S1, G1, { markdown: "x".repeat(4_200_000) })] });
    expect(huge.status).toBe(413);
  });
});
