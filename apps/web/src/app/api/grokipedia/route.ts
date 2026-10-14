import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api";
import { saveGrokipediaLink } from "@/features/grokipedia/save-grokipedia";
import { GROKIPEDIA_ERROR_MESSAGES } from "@/features/grokipedia/grokipedia-errors";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const saveGrokipediaSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  folder_id: z.string().uuid("Invalid folder ID"),
});

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_url",
          message: GROKIPEDIA_ERROR_MESSAGES.invalid_url,
        },
      },
      { status: 400 },
    );
  }

  const parsed = saveGrokipediaSchema.safeParse(body);
  if (!parsed.success) {
    const isFolderError = parsed.error.issues.some((issue) => issue.path.includes("folder_id"));
    return NextResponse.json(
      {
        error: {
          code: isFolderError ? "invalid_folder" : "invalid_url",
          message: isFolderError
            ? GROKIPEDIA_ERROR_MESSAGES.invalid_folder
            : GROKIPEDIA_ERROR_MESSAGES.invalid_url,
        },
      },
      { status: 400 },
    );
  }

  const result = await saveGrokipediaLink(auth.db, auth.userId, {
    url: parsed.data.url,
    folderId: parsed.data.folder_id,
  });

  if (result.success) {
    pushToDriveSoon(auth.userId);
    return NextResponse.json({ data: { item: result.item } }, { status: 201 });
  }

  return NextResponse.json({ error: result.error }, { status: result.status });
}
