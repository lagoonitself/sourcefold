import { z } from "zod";
import { saveGrokipediaLink } from "../features/grokipedia/save-grokipedia";
import { GROKIPEDIA_ERROR_MESSAGES } from "../features/grokipedia/grokipedia-errors";
import type { RouteContext } from "../context";

const saveGrokipediaSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  folder_id: z.string().uuid("Invalid folder ID"),
  // Save the link even though it is already in another group of the project.
  allow_duplicate: z.boolean().optional(),
});

export async function POST(auth: RouteContext, request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
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
    return Response.json(
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

  const result = await saveGrokipediaLink(
    auth.db,
    auth.userId,
    {
      url: parsed.data.url,
      folderId: parsed.data.folder_id,
      allowDuplicate: parsed.data.allow_duplicate,
    },
    auth.host,
  );

  if (result.success) {
    auth.host.scheduleDrivePush(auth.userId);
    return Response.json({ data: { item: result.item } }, { status: 201 });
  }

  return Response.json({ error: result.error }, { status: result.status });
}
