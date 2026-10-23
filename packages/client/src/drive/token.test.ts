import { describe, expect, it, vi } from "vitest";
import { DriveAuthError, DriveClientMismatchError } from "../google/errors";
import { createDriveAccess, DRIVE_TOKEN_FUNCTION } from "./token";

function supabaseAnswering(...answers: Array<{ data?: unknown; error?: unknown }>) {
  const invoke = vi.fn();
  for (const a of answers)
    invoke.mockResolvedValueOnce({ data: a.data ?? null, error: a.error ?? null });
  return { supabase: { functions: { invoke } } as never, invoke };
}

/** What supabase-js gives back for a non-2xx answer: the Response is the error's context. */
function httpError(status: number, body: unknown) {
  return Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: new Response(JSON.stringify(body), { status }),
  });
}

describe("createDriveAccess", () => {
  it("asks the Edge Function and reuses the token until 5 minutes before it expires", async () => {
    let now = 1_000_000;
    const { supabase, invoke } = supabaseAnswering(
      { data: { data: { access_token: "t1", expires_in: 3600 } } },
      { data: { data: { access_token: "t2", expires_in: 3600 } } },
    );
    const drive = createDriveAccess(supabase, () => now);

    expect(await drive.getAccessToken("u")).toBe("t1");
    expect(invoke).toHaveBeenCalledWith(DRIVE_TOKEN_FUNCTION, { method: "POST" });
    now += 54 * 60 * 1000;
    expect(await drive.getAccessToken("u")).toBe("t1");
    now += 2 * 60 * 1000;
    expect(await drive.getAccessToken("u")).toBe("t2");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("makes one request for several Drive calls at once", async () => {
    const { supabase, invoke } = supabaseAnswering({
      data: { data: { access_token: "t1", expires_in: 3600 } },
    });
    const drive = createDriveAccess(supabase);
    const tokens = await Promise.all([1, 2, 3].map(() => drive.getAccessToken("u")));
    expect(tokens).toEqual(["t1", "t1", "t1"]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("asks again after the token is cleared", async () => {
    const { supabase, invoke } = supabaseAnswering(
      { data: { data: { access_token: "t1", expires_in: 3600 } } },
      { data: { data: { access_token: "t2", expires_in: 3600 } } },
    );
    const drive = createDriveAccess(supabase);
    await drive.getAccessToken("u");
    drive.clearAccessToken("u");
    expect(await drive.getAccessToken("u")).toBe("t2");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("turns drive_reconnect into DriveAuthError and drive_client_mismatch into its own error", async () => {
    const reconnect = {
      error: httpError(401, {
        error: {
          code: "drive_reconnect",
          message: "Reconnect Google Drive: sign out and sign in again.",
        },
      }),
    };
    const mismatch = {
      error: httpError(500, { error: { code: "drive_client_mismatch", message: "…" } }),
    };
    const { supabase } = supabaseAnswering(reconnect, mismatch, reconnect);
    const drive = createDriveAccess(supabase);

    await expect(drive.getAccessToken("u")).rejects.toBeInstanceOf(DriveAuthError);
    await expect(drive.getAccessToken("u")).rejects.toBeInstanceOf(DriveClientMismatchError);
    expect(await drive.isConnected("u")).toBe(false);
  });

  it("passes other failures on with the function's message", async () => {
    const { supabase } = supabaseAnswering({
      error: httpError(403, { error: { message: "This account can't use Sourcefold." } }),
    });
    await expect(createDriveAccess(supabase).getAccessToken("u")).rejects.toThrow(
      "This account can't use Sourcefold.",
    );
  });
});
