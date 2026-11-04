import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
  getPublicEnv: vi.fn(() => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  })),
  isEmailAllowed: vi.fn(),
  getUser: vi.fn(),
  tokenLookup: vi.fn(),
  getUserById: vi.fn(),
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getPublicEnv: mocks.getPublicEnv,
  isEmailAllowed: mocks.isEmailAllowed,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ cookie: true })),
  getSessionUser: mocks.getSessionUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      update: () => chain,
      maybeSingle: mocks.tokenLookup,
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    };
    return {
      from: () => chain,
      auth: { admin: { getUserById: mocks.getUserById } },
    };
  },
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabaseClient }));

import { INVALID_SIGN_IN_MESSAGE, requireApiUser } from "./api";

function request(token?: string) {
  return new Request("https://sourcefold.example/api/folders", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

async function messageOf(result: Awaited<ReturnType<typeof requireApiUser>>) {
  if (!("response" in result)) throw new Error("expected a failure");
  return { status: result.response.status, body: await result.response.json() };
}

describe("requireApiUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEmailAllowed.mockReturnValue(true);
    mocks.createSupabaseClient.mockImplementation((_url, _key, options) =>
      options?.global
        ? { rls: options.global.headers.Authorization }
        : { auth: { getUser: mocks.getUser } },
    );
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "reader@example.com" } },
      error: null,
    });
  });

  // QA 2026-11-04 P0-2: Claude Desktop borrows the desktop app's Supabase access token, and every
  // call failed because only sf_ tokens were accepted.
  it("accepts a Supabase access token and runs under RLS as that user", async () => {
    const result = await requireApiUser(request("eyJhbGciOi.desktop.jwt"));
    expect(result).toEqual({
      db: { rls: "Bearer eyJhbGciOi.desktop.jwt" },
      userId: "user-1",
      via: "session",
    });
    expect(mocks.getUser).toHaveBeenCalledWith("eyJhbGciOi.desktop.jwt");
    expect(mocks.tokenLookup).not.toHaveBeenCalled();
  });

  it("refuses an expired or forged Supabase token with a sign-in message", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("JWT expired") });
    const failure = await messageOf(await requireApiUser(request("eyJ.expired.jwt")));
    expect(failure).toEqual({ status: 401, body: { error: { message: INVALID_SIGN_IN_MESSAGE } } });
    // The MCP server's web API rewrites only 401s about the token into its "sign in again" text.
    expect(INVALID_SIGN_IN_MESSAGE).toMatch(/access token/i);
  });

  it("applies ALLOWED_EMAIL to Supabase tokens", async () => {
    mocks.isEmailAllowed.mockReturnValue(false);
    const failure = await messageOf(await requireApiUser(request("eyJ.other.jwt")));
    expect(failure.status).toBe(403);
  });

  it("still looks sf_ tokens up in api_tokens", async () => {
    mocks.tokenLookup.mockResolvedValue({ data: { id: "t1", user_id: "user-2" }, error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { email: "a@b.c" } }, error: null });
    const result = await requireApiUser(request("sf_abc"));
    expect(result).toMatchObject({ userId: "user-2", via: "token" });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("refuses an unknown sf_ token", async () => {
    mocks.tokenLookup.mockResolvedValue({ data: null, error: null });
    const failure = await messageOf(await requireApiUser(request("sf_unknown")));
    expect(failure.status).toBe(401);
  });

  it("uses the session cookie without a Bearer header", async () => {
    mocks.getSessionUser.mockResolvedValue({ id: "user-3", email: "c@d.e" });
    const result = await requireApiUser(request());
    expect(result).toMatchObject({ userId: "user-3", via: "session" });
  });
});
