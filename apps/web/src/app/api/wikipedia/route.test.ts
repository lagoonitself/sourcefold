import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();
const pushToDriveSoon = vi.fn();
const findDuplicate = vi.fn();
const findDuplicateElsewhere = vi.fn();
const nextPosition = vi.fn();
const fetchWikipediaCaptureOnServer = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
}));
vi.mock("@/features/drive/push-to-drive-soon", () => ({
  pushToDriveSoon: (userId: string) => pushToDriveSoon(userId),
}));
vi.mock("@/features/capture/find-duplicate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/capture/find-duplicate")>()),
  findDuplicate: (...args: unknown[]) => findDuplicate(...args),
  findDuplicateElsewhere: (...args: unknown[]) => findDuplicateElsewhere(...args),
  nextPosition: (...args: unknown[]) => nextPosition(...args),
}));
vi.mock("@sourcefold/core/server", () => ({
  fetchWikipediaCaptureOnServer: (...args: unknown[]) => fetchWikipediaCaptureOnServer(...args),
}));

import { WikipediaError } from "@sourcefold/core/capture";
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
    new Request("http://localhost/api/wikipedia", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/wikipedia", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeDb({ items: ITEM_ROW });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
    findDuplicate.mockResolvedValue(null);
    findDuplicateElsewhere.mockResolvedValue(null);
    nextPosition.mockResolvedValue(4);
    fetchWikipediaCaptureOnServer.mockResolvedValue(CAPTURE);
  });

  it("returns the auth response when the caller isn't signed in", async () => {
    requireApiUser.mockResolvedValue({ response: Response.json({}, { status: 401 }) });
    const response = await post({ url: CAPTURE.url, folder_id: FOLDER_ID });
    expect(response.status).toBe(401);
    expect(fetchWikipediaCaptureOnServer).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON, a bad group and a missing link", async () => {
    expect((await post("not json")).status).toBe(400);

    const badFolder = await post({ url: CAPTURE.url, folder_id: "nope" });
    expect(badFolder.status).toBe(400);
    expect((await badFolder.json()).error.code).toBe("invalid_folder");

    const noUrl = await post({ url: "  ", folder_id: FOLDER_ID });
    expect(noUrl.status).toBe(400);
    expect((await noUrl.json()).error.code).toBe("invalid_url");
  });

  it("rejects links that aren't Wikipedia articles without fetching", async () => {
    for (const url of [
      "https://example.com/wiki/Car",
      "https://en.wikipedia.org/wiki/Talk:Turbocharger",
      "https://grokipedia.com/page/Turbocharger",
    ]) {
      const response = await post({ url, folder_id: FOLDER_ID });
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe("invalid_url");
    }
    expect(fetchWikipediaCaptureOnServer).not.toHaveBeenCalled();
  });

  it("answers 409 for a link already in the group, before fetching anything", async () => {
    findDuplicate.mockResolvedValue({
      item_id: "old",
      folder_id: FOLDER_ID,
      folder_name: "Engines",
    });
    const response = await post({
      url: "https://en.m.wikipedia.org/wiki/Turbocharger#History",
      folder_id: FOLDER_ID,
    });

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toMatchObject({ code: "duplicate", item_id: "old", folder_name: "Engines" });
    expect(json.error.message).toBe('Already saved in "Engines".');
    // The pasted form was canonicalized, and the check is for this user and group.
    expect(findDuplicate).toHaveBeenCalledWith(
      fake.db,
      USER_ID,
      "https://en.wikipedia.org/wiki/Turbocharger",
      FOLDER_ID,
    );
    expect(fetchWikipediaCaptureOnServer).not.toHaveBeenCalled();
    expect(fake.queries).toHaveLength(0);
  });

  it("fetches, saves a wikipedia item for the signed-in user and pushes to Drive", async () => {
    const response = await post({
      url: "https://en.wikipedia.org/wiki/Turbocharger",
      folder_id: FOLDER_ID,
    });

    expect(response.status).toBe(201);
    expect((await response.json()).data.item).toMatchObject({ id: "item-1", kind: "wikipedia" });
    expect(fetchWikipediaCaptureOnServer).toHaveBeenCalledWith(
      "https://en.wikipedia.org/wiki/Turbocharger",
      expect.anything(),
    );

    const insert = fake.queries.find((q) => callsOf(q, "insert").length > 0)!;
    expect(insert.table).toBe("items");
    expect(callsOf(insert, "insert")[0]![0]).toEqual({
      user_id: USER_ID,
      folder_id: FOLDER_ID,
      kind: "wikipedia",
      status: "saved",
      title: "Turbocharger",
      source_url: "https://en.wikipedia.org/wiki/Turbocharger",
      canonical_url: "https://en.wikipedia.org/wiki/Turbocharger",
      markdown: "Lead.\n\n## History\n\nText.\n",
      meta: {
        summary: "Exhaust-powered forced-induction device for engines",
        language: "en",
        revision: "1376335656",
        last_edited: "2026-09-23T14:44:34Z",
      },
      position: 4,
    });
    expect(pushToDriveSoon).toHaveBeenCalledWith(USER_ID);
  });

  it("saves under the title the link redirected to, and checks that one for duplicates too", async () => {
    fetchWikipediaCaptureOnServer.mockResolvedValue({
      ...CAPTURE,
      url: "https://en.wikipedia.org/wiki/Turbocharger",
    });
    await post({ url: "https://en.wikipedia.org/wiki/Turbo", folder_id: FOLDER_ID });
    const checked = findDuplicate.mock.calls.map((call) => call[2]);
    expect(checked).toEqual([
      "https://en.wikipedia.org/wiki/Turbo",
      "https://en.wikipedia.org/wiki/Turbocharger",
    ]);
  });

  it("maps Wikipedia failures to status codes and saves nothing", async () => {
    const cases = [
      ["not_found", 404],
      ["fetch_failed", 502],
      ["disambiguation", 422],
      ["not_article", 422],
    ] as const;
    for (const [code, status] of cases) {
      fetchWikipediaCaptureOnServer.mockRejectedValueOnce(new WikipediaError(code));
      const response = await post({ url: CAPTURE.url, folder_id: FOLDER_ID });
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    fetchWikipediaCaptureOnServer.mockRejectedValueOnce(new Error("boom"));
    expect((await post({ url: CAPTURE.url, folder_id: FOLDER_ID })).status).toBe(502);

    expect(fake.queries).toHaveLength(0);
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });
});
