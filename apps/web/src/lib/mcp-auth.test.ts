import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  createSupabaseClient: vi.fn(),
  getPublicEnv: vi.fn(() => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  })),
  isEmailAllowed: vi.fn(),
  auth: {
    getClaims: vi.fn(),
    getUser: vi.fn(),
  },
  db: {},
  getOAuthClient: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/env", () => ({
  getPublicEnv: mocks.getPublicEnv,
  isEmailAllowed: mocks.isEmailAllowed,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ auth: { admin: { oauth: { getClient: mocks.getOAuthClient } } } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createSupabaseClient,
}));

import { authenticateMcpRequest } from "./mcp-auth";

function request(token?: string) {
  return new Request("https://sourcefold.example/api/mcp", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

describe("authenticateMcpRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createSupabaseClient.mockReturnValue({ auth: mocks.auth });
    mocks.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", client_id: "oauth-client-1" } },
      error: null,
    });
    mocks.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "reader@example.com" } },
      error: null,
    });
    mocks.isEmailAllowed.mockReturnValue(true);
    mocks.getOAuthClient.mockResolvedValue({ data: { client_name: "Claude" }, error: null });
  });

  it("uses requireApiUser for an existing sf_ token", async () => {
    const result = { db: mocks.db, userId: "user-1", via: "token" as const };
    mocks.requireApiUser.mockResolvedValue(result);

    await expect(authenticateMcpRequest(request("sf_existing-token"))).resolves.toEqual({
      ...result,
      addedBy: "MCP",
      email: null,
    });
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });

  it("names queued links MCP when the OAuth client can't be looked up", async () => {
    mocks.createSupabaseClient
      .mockReturnValueOnce({ auth: mocks.auth })
      .mockReturnValueOnce({ from: vi.fn() });
    mocks.getOAuthClient.mockRejectedValue(new Error("OAuth server off"));

    const result = await authenticateMcpRequest(request("oauth-jwt"));

    expect(result).toMatchObject({ userId: "user-1", addedBy: "MCP" });
  });

  it("rejects a missing Bearer token without falling back to cookies", async () => {
    await expect(authenticateMcpRequest(request())).resolves.toEqual({
      error: { status: 401, message: "A Bearer access token is required." },
    });
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    expect(mocks.createSupabaseClient).not.toHaveBeenCalled();
  });

  it("maps an invalid sf_ token to 401", async () => {
    mocks.requireApiUser.mockResolvedValue({
      response: Response.json(
        { error: { message: "This access token isn't valid." } },
        { status: 401 },
      ),
    });

    await expect(authenticateMcpRequest(request("sf_invalid"))).resolves.toEqual({
      error: { status: 401, message: "This access token isn't valid." },
    });
  });

  it("verifies an OAuth JWT and returns an RLS client carrying that JWT", async () => {
    const rlsDb = { from: vi.fn() };
    mocks.createSupabaseClient.mockReturnValueOnce({ auth: mocks.auth }).mockReturnValueOnce(rlsDb);

    const result = await authenticateMcpRequest(request("oauth-jwt"));

    expect(result).toEqual({
      db: rlsDb,
      userId: "user-1",
      via: "session",
      addedBy: "Claude",
      email: "reader@example.com",
    });
    expect(mocks.getOAuthClient).toHaveBeenCalledWith("oauth-client-1");
    expect(mocks.auth.getClaims).toHaveBeenCalledWith("oauth-jwt");
    expect(mocks.auth.getUser).toHaveBeenCalledWith("oauth-jwt");
    expect(mocks.createSupabaseClient).toHaveBeenNthCalledWith(
      2,
      "https://project.supabase.co",
      "publishable-key",
      {
        global: { headers: { Authorization: "Bearer oauth-jwt" } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
  });

  it("rejects an unverified or non-OAuth JWT", async () => {
    mocks.auth.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: "user-1" } },
      error: null,
    });

    await expect(authenticateMcpRequest(request("ordinary-session-jwt"))).resolves.toEqual({
      error: { status: 401, message: "This OAuth access token isn't valid." },
    });
    expect(mocks.auth.getUser).not.toHaveBeenCalled();
  });

  it("rejects OAuth users outside ALLOWED_EMAIL", async () => {
    mocks.isEmailAllowed.mockReturnValue(false);

    await expect(authenticateMcpRequest(request("oauth-jwt"))).resolves.toEqual({
      error: { status: 403, message: "This account can't use Sourcefold." },
    });
    expect(mocks.createSupabaseClient).toHaveBeenCalledOnce();
  });
});
