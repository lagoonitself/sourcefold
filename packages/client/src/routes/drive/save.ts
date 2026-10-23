import { ZodError } from "zod";
import { jsonData } from "../../http";
import { DriveAuthError, DriveClientMismatchError } from "../../google/errors";
import { runSaveBatch } from "../../features/drive/run-save-batch";
import type { RouteContext } from "../../context";

export async function POST(auth: RouteContext, request: Request) {
  const { db, userId } = auth;

  const { data: lockAcquired, error: lockError } = await db.rpc("acquire_drive_sync_lock", {
    p_user_id: userId,
  });

  if (lockError || !lockAcquired) {
    return Response.json(
      {
        error: {
          code: "sync_in_progress",
          message: "A save is already running.",
        },
      },
      { status: 409 },
    );
  }

  try {
    let accessToken: string;
    try {
      accessToken = await auth.host.drive.getAccessToken(userId);
    } catch (err) {
      console.error("Drive token refresh failed:", err);
      if (err instanceof DriveClientMismatchError) {
        return Response.json(
          {
            error: {
              code: "drive_client_mismatch",
              message:
                "Drive can't connect: the app's Google client doesn't match the one used to sign in. Reconnecting won't help.",
            },
          },
          { status: 500 },
        );
      }
      if (err instanceof DriveAuthError) {
        auth.host.drive.clearAccessToken(userId);
        return Response.json(
          {
            error: {
              code: "reconnect_drive",
              message: "Reconnect Google Drive to keep saving.",
            },
          },
          { status: 401 },
        );
      }
      if (
        err instanceof ZodError ||
        (err instanceof Error && (err.name === "ZodError" || err.message.includes("GOOGLE_CLIENT")))
      ) {
        return Response.json(
          { error: { message: "The server is missing its Google client settings." } },
          { status: 500 },
        );
      }
      return Response.json(
        { error: { message: "Couldn't reach Google Drive. Try again." } },
        { status: 502 },
      );
    }

    let budget = 20;
    try {
      const body = (await request.json()) as { budget?: unknown };
      if (typeof body?.budget === "number" && body.budget > 0) {
        budget = Math.min(body.budget, 50);
      }
    } catch {
      // Empty or non-JSON body allowed
    }

    try {
      const result = await runSaveBatch(db, userId, accessToken, auth.host, budget);
      return jsonData(result);
    } catch (err) {
      console.error("Drive save failed:", err);
      if (err instanceof DriveAuthError) {
        auth.host.drive.clearAccessToken(userId);
        return Response.json(
          {
            error: {
              code: "reconnect_drive",
              message: "Reconnect Google Drive to keep saving.",
            },
          },
          { status: 401 },
        );
      }
      if (
        err instanceof ZodError ||
        (err instanceof Error && (err.name === "ZodError" || err.message.includes("GOOGLE_CLIENT")))
      ) {
        return Response.json(
          { error: { message: "The server is missing its Google client settings." } },
          { status: 500 },
        );
      }
      return Response.json(
        { error: { message: "Couldn't reach Google Drive. Try again." } },
        { status: 502 },
      );
    }
  } finally {
    try {
      await db.rpc("release_drive_sync_lock", { p_user_id: userId });
    } catch {
      // Ignore lock release errors
    }
  }
}
