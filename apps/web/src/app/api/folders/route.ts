import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { loadFolders } from "@/features/folders/load-folders";

export const dynamic = "force-dynamic";

const createFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(200, "Folder name must be at most 200 characters"),
  parent_id: z.string().uuid("Invalid parent folder ID").nullable().optional(),
});

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const folders = await loadFolders(auth.supabase);
    return jsonData(folders);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load folders";
    return jsonError(500, message);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
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

  // Determine max position among siblings
  let siblingsQuery = auth.supabase.from("folders").select("position").is("deleted_at", null);

  if (parentId === null) {
    siblingsQuery = siblingsQuery.is("parent_id", null);
  } else {
    siblingsQuery = siblingsQuery.eq("parent_id", parentId);
  }

  const { data: siblings, error: sibError } = await siblingsQuery;
  if (sibError) {
    return jsonError(500, sibError.message);
  }

  const maxPosition =
    siblings && siblings.length > 0 ? Math.max(...siblings.map((s) => s.position)) : -1;
  const position = maxPosition + 1;

  const { data: newFolder, error: insertError } = await auth.supabase
    .from("folders")
    .insert({
      name,
      parent_id: parentId,
      position,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.message.includes("invalid parent folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    return jsonError(400, insertError.message);
  }

  return jsonData(newFolder, 201);
}
