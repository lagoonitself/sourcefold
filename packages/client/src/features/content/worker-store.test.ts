import { describe, expect, it, vi } from "vitest";
import { ContentStoreError, createWorkerContentStore } from "./worker-store";

function setup(response: Response | (() => Response), authorization: string | null = "Bearer t") {
  const fetchMock = vi.fn(async () => (typeof response === "function" ? response() : response));
  const store = createWorkerContentStore({
    baseUrl: "https://worker.example/",
    authorization: async () => authorization,
    fetch: fetchMock as unknown as typeof fetch,
  });
  return { store, fetchMock };
}

describe("createWorkerContentStore", () => {
  it("gets text with the caller's authorization", async () => {
    const { store, fetchMock } = setup(new Response("# Hi"));
    expect(await store.getText("abc")).toBe("# Hi");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://worker.example/v1/items/abc/text");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t");
  });

  it("returns null on 404", async () => {
    const { store } = setup(new Response("{}", { status: 404 }));
    expect(await store.getText("abc")).toBeNull();
    expect(await store.getFile("abc")).toBeNull();
  });

  it("puts text and returns the stored hash", async () => {
    const { store, fetchMock } = setup(Response.json({ data: { sha256: "aa", bytes: 3 } }));
    expect(await store.putText("abc", "hey")).toEqual({ sha256: "aa", bytes: 3 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("hey");
  });

  it("puts a file with its type and reads it back", async () => {
    const put = setup(Response.json({ data: { sha256: "bb", bytes: 2 } }));
    await put.store.putFile("abc", new Uint8Array([1, 2]), "image/png");
    const [, init] = put.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("Content-Type")).toBe("image/png");

    const get = setup(
      () => new Response(new Uint8Array([9, 8]), { headers: { "Content-Type": "image/jpeg" } }),
    );
    const file = await get.store.getFile("abc");
    expect(file?.mimeType).toBe("image/jpeg");
    expect([...file!.bytes]).toEqual([9, 8]);
  });

  it("throws a ContentStoreError with the Worker's code", async () => {
    const { store } = setup(
      Response.json({ error: { message: "Full", code: "storage_full" } }, { status: 507 }),
    );
    await expect(store.putText("abc", "x")).rejects.toMatchObject({
      name: "ContentStoreError",
      status: 507,
      code: "storage_full",
      message: "Full",
    });
  });

  it("throws 401 without a token and never calls the Worker", async () => {
    const { store, fetchMock } = setup(new Response("x"), null);
    await expect(store.getText("abc")).rejects.toBeInstanceOf(ContentStoreError);
    await expect(store.getText("abc")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
