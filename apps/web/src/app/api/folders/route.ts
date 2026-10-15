import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { loadFolders } from "@/features/folders/load-folders";
import { nextPosition } from "@/features/capture/find-duplicate";

export const dynamic = "force-dynamic";

const createFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(200, "Folder name must be at most 200 characters"),
  parent_id: z.string().uuid("Invalid parent folder ID").nullable().optional(),
});

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";

  try {
    const folders = await loadFolders(auth.db, auth.userId, { includeArchived });
    return jsonData(folders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load folders";
    return jsonError(500, message);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const name = parsed.data.name;
  const parentId = parsed.data.parent_id ?? null;

  const position = await nextPosition(auth.db, auth.userId, parentId, "folders");

  const { data: newFolder, error: insertError } = await auth.db
    .from("folders")
    .insert({
      name,
      parent_id: parentId,
      position,
      user_id: auth.userId,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.message.includes("invalid parent folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    if (insertError.code === "23514") {
      return jsonError(400, "Folder name is invalid.");
    }
    if (insertError.code === "23503") {
      return jsonError(400, "That folder no longer exists.");
    }
    if (insertError.code === "22P02") {
      return jsonError(400, "Invalid folder ID format.");
    }
    console.error("Failed to insert folder:", insertError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return jsonData(newFolder, 201);
}
