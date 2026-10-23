import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();
const pushToDriveSoon = vi.fn();
const findDuplicate = vi.fn();
const nextPosition = vi.fn();
const fetchSourceCapture = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
}));
vi.mock("@/features/drive/push-to-drive-soon", () => ({
  pushToDriveSoon: (userId: string) => pushToDriveSoon(userId),
}));
vi.mock("@sourcefold/client/features/capture/find-duplicate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/capture/find-duplicate")>()),
  findDuplicate: (...args: unknown[]) => findDuplicate(...args),
  nextPosition: (...args: unknown[]) => nextPosition(...args),
}));
vi.mock("@sourcefold/core/server", () => ({
  fetchSourceCapture: (...args: unknown[]) => fetchSourceCapture(...args),
  parseHtmlOnServer: vi.fn(),
  sourceFetchFromGlobalFetch: () => vi.fn(),
}));

import { SourceError } from "@sourcefold/core";
import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000aa";
const URL_ = "https://example.com/story";
const ITEM_ROW = {
  id: "item-1",
  folder_id: FOLDER_ID,
  kind: "web",
  title: "A story",
  source_url: URL_,
  status: "saved",
  created_at: "2026-10-16T10:00:00Z",
};
const OK_RESULT = {
  status: "ok",
  kind: "web",
  capture: { url: URL_, title: "A story", meta: { site: "Example" }, markdown: "Body.\n" },
};

function insertedRows(fake: ReturnType<typeof createFakeDb>) {
  const insert = fake.queries.find((q) => callsOf(q, "insert").length > 0)!;
  return callsOf(insert, "insert").map((args) => args[0]);
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/source", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/source", () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = createFakeDb({ items: ITEM_ROW });
    requireApiUser.mockResolvedValue({ db: fake.db, userId: USER_ID, via: "token" });
    findDuplicate.mockResolvedValue(null);
    nextPosition.mockResolvedValue(2);
    fetchSourceCapture.mockResolvedValue(OK_RESULT);
  });

  it("returns the auth response when the caller isn't signed in", async () => {
    requireApiUser.mockResolvedValue({ response: Response.json({}, { status: 401 }) });
    expect((await post({ url: URL_, folder_id: FOLDER_ID })).status).toBe(401);
    expect(fetchSourceCapture).not.toHaveBeenCalled();
  });

  it("rejects bad bodies and links that aren't http(s)", async () => {
    expect((await post("not json")).status).toBe(400);
    const badFolder = await post({ url: URL_, folder_id: "nope" });
    expect(badFolder.status).toBe(400);
    expect((await badFolder.json()).error.code).toBe("invalid_folder");
    expect((await post({ url: "ftp://example.com/a", folder_id: FOLDER_ID })).status).toBe(400);
    expect(fetchSourceCapture).not.toHaveBeenCalled();
  });

  it("sends YouTube links to the desktop app without fetching", async () => {
    const response = await post({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      folder_id: FOLDER_ID,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe(
      "Save YouTube videos with the desktop app or the Sourcefold extension. YouTube blocks requests from servers.",
    );
    expect(fetchSourceCapture).not.toHaveBeenCalled();
  });

  it("answers 409 for a duplicate before fetching", async () => {
    findDuplicate.mockResolvedValue({ item_id: "old", folder_id: FOLDER_ID, folder_name: "Cars" });
    const response = await post({ url: `${URL_}?utm_source=x`, folder_id: FOLDER_ID });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatchObject({ code: "duplicate", item_id: "old" });
    expect(findDuplicate).toHaveBeenCalledWith(fake.db, USER_ID, URL_, FOLDER_ID);
    expect(fetchSourceCapture).not.toHaveBeenCalled();
  });

  it("fetches, saves the item for the signed-in user and pushes to Drive", async () => {
    const response = await post({ url: URL_, folder_id: FOLDER_ID });
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.item).toMatchObject({ id: "item-1", kind: "web" });
    expect(json.data.unavailable).toBeUndefined();
    expect(fetchSourceCapture).toHaveBeenCalledWith(URL_, expect.anything());
    expect(insertedRows(fake)[0]).toMatchObject({
      user_id: USER_ID,
      folder_id: FOLDER_ID,
      kind: "web",
      status: "saved",
      meta: { site: "Example" },
    });
    expect(pushToDriveSoon).toHaveBeenCalledWith(USER_ID);
  });

  it("saves an unavailable item with its reason", async () => {
    fetchSourceCapture.mockResolvedValue({
      status: "unavailable",
      kind: "web",
      url: URL_,
      title: "A story",
      reason: "Needs a login",
    });
    const response = await post({ url: URL_, folder_id: FOLDER_ID });
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data.unavailable).toBe(true);
    expect(json.data.reason).toBe("Needs a login");
    expect(insertedRows(fake)[0]).toMatchObject({
      status: "unavailable",
      error: "Needs a login",
    });
  });

  it("maps source errors to statuses and keeps the message", async () => {
    const cases = [
      ["invalid_url", 400],
      ["not_found", 404],
      ["blocked", 422],
      ["too_large", 413],
      ["parse_failed", 422],
      ["fetch_failed", 502],
    ] as const;
    for (const [code, status] of cases) {
      fetchSourceCapture.mockRejectedValue(new SourceError(code, `Message for ${code}.`));
      const response = await post({ url: URL_, folder_id: FOLDER_ID });
      expect(response.status).toBe(status);
      expect((await response.json()).error).toMatchObject({
        code,
        message: `Message for ${code}.`,
      });
    }
    expect(pushToDriveSoon).not.toHaveBeenCalled();
  });

  it("points blocked Reddit links to the desktop app", async () => {
    fetchSourceCapture.mockRejectedValue(new SourceError("blocked", "Reddit refused the request."));
    const response = await post({
      url: "https://www.reddit.com/r/cars/comments/1abc2d/title/",
      folder_id: FOLDER_ID,
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toBe(
      "Reddit refused the request. Try the desktop app or the Sourcefold extension.",
    );
  });

  it("answers 502 when the fetch fails in an unexpected way", async () => {
    fetchSourceCapture.mockRejectedValue(new Error("boom"));
    expect((await post({ url: URL_, folder_id: FOLDER_ID })).status).toBe(502);
  });
});
