import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-db";

const requireApiUser = vi.fn();

vi.mock("@/lib/api", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
  jsonData: (data: unknown, status = 200) => Response.json({ data }, { status }),
  jsonError: (status: number, message: string) => Response.json({ error: { message } }, { status }),
}));

import { GET } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const params = { params: Promise.resolve({ id: "item-1" }) };

describe("GET /api/items/[id]/file", () => {
  function setup(item: unknown) {
    const fake = createFakeDb({ items: item });
    const db = {
      ...fake.db,
      storage: {
        from: () => ({
          createSignedUrl: async () => ({
            data: { signedUrl: "https://example.supabase.co/signed?token=t" },
            error: null,
          }),
        }),
      },
    };
    requireApiUser.mockResolvedValue({ db, userId: USER_ID, via: "token" });
    return fake;
  }

  beforeEach(() => {
    setup({ id: "item-1", kind: "image", storage_path: "u/i/a.png", drive_file_id: null });
  });

  it("redirects by default", async () => {
    const response = await GET(new Request("http://localhost/api/items/item-1/file"), params);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.supabase.co/signed?token=t");
  });

  it("returns the signed URL as JSON with ?format=json", async () => {
    const response = await GET(
      new Request("http://localhost/api/items/item-1/file?format=json"),
      params,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { url: "https://example.supabase.co/signed?token=t" },
    });
  });

  it("returns the Drive view URL as JSON once the image has moved to Drive", async () => {
    setup({ id: "item-1", kind: "image", storage_path: null, drive_file_id: "drive 1" });
    const response = await GET(
      new Request("http://localhost/api/items/item-1/file", {
        headers: { accept: "application/json" },
      }),
      params,
    );

    expect(await response.json()).toEqual({
      data: { url: "https://drive.google.com/file/d/drive%201/view" },
    });
  });

  it("answers 404 for anything that isn't an image of the user's", async () => {
    setup(null);
    const response = await GET(
      new Request("http://localhost/api/items/item-1/file?format=json"),
      params,
    );

    expect(response.status).toBe(404);
  });
});
