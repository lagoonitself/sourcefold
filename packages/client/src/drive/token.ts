// Drive access for the desktop app and the extension: Google access tokens come from the
// `google-access-token` Edge Function (supabase/functions/google-access-token), because refreshing
// one needs the OAuth client secret. Contract: docs/dev/handoff-no-website.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { DriveAuthError, DriveClientMismatchError } from "../google/errors";
import type { DriveAccess } from "../host";

export const DRIVE_TOKEN_FUNCTION = "google-access-token";

/** Reuse a token until 5 minutes before it expires, as the website does. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface FunctionAnswer {
  data?: { access_token?: string; expires_in?: number };
  error?: { code?: string; message?: string };
}

async function readAnswer(value: unknown): Promise<FunctionAnswer | null> {
  try {
    if (value instanceof Response) return (await value.clone().json()) as FunctionAnswer;
    if (typeof value === "string") return JSON.parse(value) as FunctionAnswer;
    if (value && typeof value === "object") return value as FunctionAnswer;
  } catch {
    // Not JSON; handled by the caller.
  }
  return null;
}

export function createDriveAccess(
  supabase: SupabaseClient<Database>,
  now: () => number = Date.now,
): DriveAccess {
  const cache = new Map<string, CachedToken>();
  const pending = new Map<string, Promise<string>>();

  async function request(userId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke(DRIVE_TOKEN_FUNCTION, {
      method: "POST",
    });
    // supabase-js hands back the error answer's Response as `error.context`.
    const answer = await readAnswer(
      error ? (error as { context?: unknown }).context : (data as unknown),
    );
    if (error || !answer?.data?.access_token) {
      const code = answer?.error?.code;
      const message = answer?.error?.message;
      if (code === "drive_reconnect") throw new DriveAuthError(message);
      if (code === "drive_client_mismatch") throw new DriveClientMismatchError();
      throw new Error(
        message || (error instanceof Error ? error.message : "Couldn't reach Google Drive."),
      );
    }
    const expiresIn = answer.data.expires_in ?? 3600;
    cache.set(userId, { token: answer.data.access_token, expiresAt: now() + expiresIn * 1000 });
    return answer.data.access_token;
  }

  const access: DriveAccess = {
    async getAccessToken(userId) {
      const cached = cache.get(userId);
      if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.token;
      // Several Drive calls at once share one request.
      let inFlight = pending.get(userId);
      if (!inFlight) {
        inFlight = request(userId).finally(() => pending.delete(userId));
        pending.set(userId, inFlight);
      }
      return inFlight;
    },
    clearAccessToken(userId) {
      cache.delete(userId);
    },
    async isConnected(userId) {
      try {
        await access.getAccessToken(userId);
        return true;
      } catch {
        return false;
      }
    },
  };
  return access;
}
