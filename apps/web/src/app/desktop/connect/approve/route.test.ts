import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api", () => ({ requireUser: vi.fn() }));

import { requireUser } from "@/lib/api";

const ORIGIN = "https://app.example.com";
const CALLBACK = "http://127.0.0.1:4821/auth/callback";
const STATE = "0f8fad5b-d9cb-469f-a165-70867728950e";

const insert = vi.fn();

function signedIn(result: { data: unknown; error: unknown } = { data: { id: "t1" }, error: null }) {
  const query = {
    insert: (...args: unknown[]) => {
      insert(...args);
      return query;
    },
    select: () => query,
    single: () => Promise.resolve(result),
  };
  vi.mocked(requireUser).mockResolvedValue({
    supabase: { from: () => query },
    user: { id: "u1", email: "me@example.com" },
  } as never);
}

function approve(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return POST(
    new Request(`${ORIGIN}/desktop/connect/approve`, {
      method: "POST",
      headers: { origin: ORIGIN, ...headers },
      body: new URLSearchParams(fields),
    }),
  );
}

describe("POST /desktop/connect/approve", () => {
  beforeEach(() => {
    insert.mockReset();
    vi.mocked(requireUser).mockReset();
  });

  it("rejects a cross-origin POST before touching auth or the database", async () => {
    const res = await approve(
      { callback: CALLBACK, state: STATE },
      { origin: "https://evil.example" },
    );
    expect(res.status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("sends signed-out users to /login", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      response: new Response(null, { status: 401 }),
    } as never);
    const res = await approve({ callback: CALLBACK, state: STATE });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
    expect(insert).not.toHaveBeenCalled();
  });

  it("goes back to the connect page when the link is invalid", async () => {
    signedIn();
    const res = await approve({ callback: "https://evil.example/auth/callback", state: STATE });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/desktop/connect`);
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates a token and 303-redirects to the loopback callback", async () => {
    signedIn();
    const res = await approve({ callback: CALLBACK, state: STATE });

    expect(res.status).toBe(303);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("http://127.0.0.1:4821");
    expect(location.pathname).toBe("/auth/callback");
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.get("email")).toBe("me@example.com");

    const token = location.searchParams.get("token")!;
    expect(token).toMatch(/^sf_/);

    const row = insert.mock.calls[0]![0] as Record<string, string>;
    expect(row).toMatchObject({ name: "Sourcefold Desktop", user_id: "u1" });
    expect(row.token_hash).toBeTruthy();
    expect(row.token_hash).not.toBe(token);
  });

  it("returns to the connect page with an error when the token can't be saved", async () => {
    signedIn({ data: null, error: { message: "boom" } });
    const res = await approve({ callback: CALLBACK, state: STATE });
    expect(res.status).toBe(303);

    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe("/desktop/connect");
    expect(location.searchParams.get("error")).toBe("failed");
    expect(location.searchParams.get("callback")).toBe(CALLBACK);
    expect(location.searchParams.get("state")).toBe(STATE);
    expect(location.searchParams.has("token")).toBe(false);
  });
});
