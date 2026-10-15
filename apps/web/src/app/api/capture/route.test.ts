import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();
const pushToDriveSoon = vi.fn();
const findDuplicate = vi.fn();
const nextPosition = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
}));
vi.mock("@/features/drive/push-to-drive-soon", () => ({
  pushToDriveSoon: (userId: string) => pushToDriveSoon(userId),
}));
vi.mock("@/features/capture/find-duplicate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/capture/find-duplicate")>()),
  findDuplicate: (...args: unknown[]) => findDuplicate(...args),
  nextPosition: (...args: unknown[]) => nextPosition(...args),
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000aa";
const ITEM_ROW = {
  id: "item-1",
  folder_id: FOLDER_ID,
  kind: "wikipedia",
  title: "Turbocharger",
  source_url: "https://en.wikipedia.org/wiki/Turbocharger",
  status: "saved",
  created_at: "2026-10-15T10:00:00Z",
};
const CAPTURE = {
  url: "https://en.wikipedia.org/wiki/Turbocharger",
  title: "Turbocharger",
  summary: "Exhaust-powered forced-induction device for engines",
  language: "en",
  revision: "1376335656",
  lastEdited: "2026-09-23T14:44:34Z",
  markdown: "Lead.\n\n## History\n\nText.\n",
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/capture", { method: "POST", body: JSON.stringify(body) }),
  );
}

describe("POST /api/capture with a Wikipedia article", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeDb({ items: ITEM_ROW });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
    findDuplicate.mockResolvedValue(null);
    nextPosition.mockResolvedValue(0);
  });

  it("saves the extracted article as a wikipedia item and pushes to Drive", async () => {
    const response = await post({ kind: "wikipedia", folder_id: FOLDER_ID, capture: CAPTURE });

    expect(response.status).toBe(201);
    expect((await response.json()).data.item).toMatchObject({ kind: "wikipedia" });
    const insert = fake.queries.find((q) => callsOf(q, "insert").length > 0)!;
    expect(callsOf(insert, "insert")[0]![0]).toMatchObject({
      user_id: USER_ID,
      folder_id: FOLDER_ID,
      kind: "wikipedia",
      canonical_url: "https://en.wikipedia.org/wiki/Turbocharger",
      markdown: "Lead.\n\n## History\n\nText.\n",
      meta: {
        summary: "Exhaust-powered forced-induction device for engines",
        language: "en",
        revision: "1376335656",
        last_edited: "2026-09-23T14:44:34Z",
      },
    });
    expect(pushToDriveSoon).toHaveBeenCalledWith(USER_ID);
  });

  it("canonicalizes the address it was sent", async () => {
    await post({
      kind: "wikipedia",
      folder_id: FOLDER_ID,
      capture: { ...CAPTURE, url: "https://en.m.wikipedia.org/wiki/Turbocharger#History" },
    });
    expect(findDuplicate).toHaveBeenCalledWith(
      fake.db,
      USER_ID,
      "https://en.wikipedia.org/wiki/Turbocharger",
      FOLDER_ID,
    );
  });

  it("answers 409 for an article already in the group", async () => {
    findDuplicate.mockResolvedValue({
      item_id: "old",
      folder_id: FOLDER_ID,
      folder_name: "Engines",
    });
    const response = await post({ kind: "wikipedia", folder_id: FOLDER_ID, capture: CAPTURE });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("duplicate");
    expect(fake.queries).toHaveLength(0);
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });

  it("validates the payload", async () => {
    const bad = [
      { ...CAPTURE, url: "https://example.com/wiki/Turbocharger" },
      { ...CAPTURE, url: "https://en.wikipedia.org/wiki/File:Turbo.jpg" },
      { ...CAPTURE, title: "" },
      { ...CAPTURE, markdown: "" },
      { ...CAPTURE, revision: "12abc" },
    ];
    for (const capture of bad) {
      const response = await post({ kind: "wikipedia", folder_id: FOLDER_ID, capture });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("invalid_request");
    }
    const badFolder = await post({ kind: "wikipedia", folder_id: "nope", capture: CAPTURE });
    expect(badFolder.status).toBe(400);
    expect(fake.queries).toHaveLength(0);
  });
});
