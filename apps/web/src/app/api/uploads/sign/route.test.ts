import { beforeEach, describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-0000000000aa";

const validBody = {
  folder_id: FOLDER_ID,
  file_name: "My Photo.PNG",
  mime_type: "image/png",
  size: 1234,
};

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/uploads/sign", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/uploads/sign", () => {
  let fake: ReturnType<typeof createFakeDb>;
  let createSignedUploadUrl: ReturnType<typeof vi.fn>;

  function setup(folder: unknown) {
    fake = createFakeDb({ folders: folder });
    createSignedUploadUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://example.supabase.co/signed", path: "p", token: "tok" },
      error: null,
    });
    const db = { ...fake.db, storage: { from: vi.fn(() => ({ createSignedUploadUrl })) } };
    requireApiUser.mockResolvedValue({ db, userId: USER_ID, via: "token" });
  }

  beforeEach(() => {
    setup({ id: FOLDER_ID, parent_id: "00000000-0000-4000-8000-0000000000bb" });
  });

  it("returns a signed upload URL under the user's own storage prefix", async () => {
    const response = await post(validBody);
    const { data } = await response.json();

    expect(response.status).toBe(200);
    expect(data.signed_url).toBe("https://example.supabase.co/signed");
    expect(data.token).toBe("tok");
    expect(data.storage_path).toBe(`${USER_ID}/${data.item_id}/my-photo.png`);
    expect(createSignedUploadUrl).toHaveBeenCalledWith(data.storage_path);
  });

  it("only looks at the signed-in user's live folders", async () => {
    await post(validBody);

    const [query] = fake.queries;
    expect(query!.table).toBe("folders");
    expect(callsOf(query!, "eq")).toEqual(
      expect.arrayContaining([
        ["id", FOLDER_ID],
        ["user_id", USER_ID],
      ]),
    );
    expect(callsOf(query!, "is")).toContainEqual(["deleted_at", null]);
  });

  it("rejects a folder that doesn't exist or isn't the user's", async () => {
    setup(null);
    const response = await post(validBody);

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("That group no longer exists.");
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a project, since sources live in groups", async () => {
    setup({ id: FOLDER_ID, parent_id: null });
    const response = await post(validBody);

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "Pick a group. Sources can't be saved directly in a project.",
    );
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects other file types and files over 10 MB", async () => {
    const badType = await post({ ...validBody, mime_type: "image/svg+xml" });
    expect(badType.status).toBe(400);
    expect((await badType.json()).error.message).toBe("Upload a PNG, JPEG, GIF or WebP image.");

    const tooBig = await post({ ...validBody, size: 10485761 });
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error.message).toBe("Images can be up to 10 MB.");
  });

  it("answers 500 with a plain message when Storage fails", async () => {
    createSignedUploadUrl.mockResolvedValue({ data: null, error: new Error("boom") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(validBody);

    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe("Couldn't start the upload. Try again.");
  });
});
