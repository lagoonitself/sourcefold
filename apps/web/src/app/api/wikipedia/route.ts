import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api";
import { saveWikipediaLink } from "@/features/capture/save-wikipedia";
import { webHost } from "@/lib/web-host";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INVALID_URL = "That isn't a Wikipedia article link.";
const INVALID_FOLDER = "That group no longer exists.";

const saveWikipediaSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  folder_id: z.string().uuid("Invalid folder ID"),
  // Save the link even though it is already in another group of the project.
  allow_duplicate: z.boolean().optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_url", message: INVALID_URL } },
      { status: 400 },
    );
  }

  const parsed = saveWikipediaSchema.safeParse(body);
  if (!parsed.success) {
    const isFolderError = parsed.error.issues.some((issue) => issue.path.includes("folder_id"));
    return NextResponse.json(
      {
        error: {
          code: isFolderError ? "invalid_folder" : "invalid_url",
          message: isFolderError ? INVALID_FOLDER : INVALID_URL,
        },
      },
      { status: 400 },
    );
  }

  const result = await saveWikipediaLink(
    auth.db,
    auth.userId,
    {
      url: parsed.data.url,
      folderId: parsed.data.folder_id,
      allowDuplicate: parsed.data.allow_duplicate,
    },
    webHost,
  );

  if (result.success) {
    pushToDriveSoon(auth.userId);
    return NextResponse.json({ data: { item: result.item } }, { status: 201 });
  }

  return NextResponse.json({ error: result.error }, { status: result.status });
}
