import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

vi.mock("server-only", () => ({}));

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

import { GET, PATCH } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-0000000000aa";
const params = { params: Promise.resolve({ id: ITEM_ID }) };

function patch(body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/items/${ITEM_ID}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    params,
  );
}

function setup(kind: string) {
  const fake = createFakeDb({ items: { id: ITEM_ID, kind, folder_id: "g" } });
  requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
  return fake;
}

function updatesOf(fake: ReturnType<typeof createFakeDb>) {
  return fake.queries.flatMap((q) => callsOf(q, "update"));
}

describe("GET /api/items/[id]", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
  });

  it("selects research columns on GET", async () => {
    const fake = createFakeDb({
      items: {
        id: ITEM_ID,
        kind: "web",
        title: "Test",
        note: null,
        markdown: "body",
        folder_id: "g",
        triage: "keep",
        tags: ["tag1"],
        summary: "short",
        author: "someone",
        author_type: "journalist",
      },
    });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });

    const res = await GET(new Request(`http://localhost/api/items/${ITEM_ID}`), params);
    expect(res.status).toBe(200);

    const [args] = callsOf(fake.queries[0]!, "select");
    const cols = String(args![0])
      .split(",")
      .map((c) => c.trim());
    expect(cols).toEqual(
      expect.arrayContaining(["triage", "tags", "summary", "author", "author_type"]),
    );
  });
});

describe("PATCH /api/items/[id] with text", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
    pushToDriveSoon.mockReset();
  });

  it.each(["grokipedia", "wikipedia", "substack", "youtube", "web", "reddit", "pdf"])(
    "replaces the text of a %s source and starts a Drive push",
    async (kind) => {
      const fake = setup(kind);
      const res = await patch({ markdown: "Cleaned body." });
      expect(res.status).toBe(200);
      expect(updatesOf(fake)).toEqual([[{ markdown: "Cleaned body." }]]);
      expect(pushToDriveSoon).toHaveBeenCalledWith(USER_ID);
    },
  );

  it("takes text of a few hundred kilobytes", async () => {
    const fake = setup("youtube");
    const res = await patch({ markdown: "word ".repeat(100_000) });
    expect(res.status).toBe(200);
    expect(updatesOf(fake)).toHaveLength(1);
  });

  it("allows emptying a source's text", async () => {
    const fake = setup("web");
    const res = await patch({ markdown: "" });
    expect(res.status).toBe(200);
    expect(updatesOf(fake)).toEqual([[{ markdown: "" }]]);
  });

  it("refuses text for kinds whose text is built elsewhere", async () => {
    for (const kind of ["x", "image"]) {
      const fake = setup(kind);
      const res = await patch({ markdown: "New text." });
      expect(res.status).toBe(400);
      expect(updatesOf(fake)).toEqual([]);
    }
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });

  it("keeps the note limit and does not push for notes", async () => {
    const tooLong = setup("note");
    expect((await patch({ markdown: "x".repeat(200_001) })).status).toBe(400);
    expect(updatesOf(tooLong)).toEqual([]);

    const fine = setup("note");
    expect((await patch({ markdown: "A note." })).status).toBe(200);
    expect(updatesOf(fine)).toEqual([[{ markdown: "A note." }]]);
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });

  it("does not start a push for a rename", async () => {
    setup("youtube");
    expect((await patch({ title: "New title" })).status).toBe(200);
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/items/[id] with research fields", () => {
  beforeEach(() => {
    requireApiUser.mockReset();
    pushToDriveSoon.mockReset();
  });

  it("updates triage, tags, summary, author and author_type", async () => {
    const fake = setup("web");
    const res = await patch({
      triage: "keep",
      tags: [" Compute ", "Ending", "compute"],
      summary: " A brief overview. ",
      author: " Dario Amodei ",
      author_type: "researcher",
    });

    expect(res.status).toBe(200);
    expect(updatesOf(fake)).toEqual([
      [
        {
          triage: "keep",
          tags: ["Compute", "Ending"],
          summary: "A brief overview.",
          author: "Dario Amodei",
          author_type: "researcher",
        },
      ],
    ]);
  });

  it("clears summary and author when passed empty strings", async () => {
    const fake = setup("web");
    const res = await patch({
      summary: "   ",
      author: "",
    });

    expect(res.status).toBe(200);
    expect(updatesOf(fake)).toEqual([
      [
        {
          summary: null,
          author: null,
        },
      ],
    ]);
  });

  it("refuses more than 20 tags with 400", async () => {
    setup("web");
    const tags = Array.from({ length: 21 }, (_, i) => `Tag ${i + 1}`);
    const res = await patch({ tags });
    expect(res.status).toBe(400);
  });

  it("refuses invalid triage or author_type with 400", async () => {
    setup("web");
    expect((await patch({ triage: "invalid" })).status).toBe(400);
    expect((await patch({ author_type: "invalid" })).status).toBe(400);
  });
});
