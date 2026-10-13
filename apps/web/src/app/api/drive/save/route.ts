import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { jsonData, requireUser } from "@/lib/api";
import { DriveAuthError, getGoogleAccessToken } from "@/lib/google/oauth";
import { runSaveBatch } from "@/features/drive/run-save-batch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) {
    return auth.response;
  }
  const { supabase, user } = auth;

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(user.id);
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: { message: "The server is missing its Google client settings." } },
        { status: 500 },
      );
    }
    return NextResponse.json(
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
    const result = await runSaveBatch(supabase, user.id, accessToken, budget);
    return jsonData(result);
  } catch (err) {
    if (err instanceof DriveAuthError) {
      return NextResponse.json(
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
      return NextResponse.json(
        { error: { message: "The server is missing its Google client settings." } },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: { message: "Couldn't reach Google Drive. Try again." } },
      { status: 502 },
    );
  }
}
