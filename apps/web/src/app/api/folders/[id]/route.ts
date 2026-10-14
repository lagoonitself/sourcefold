import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { nextPosition } from "@/features/capture/find-duplicate";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid("Invalid folder ID");

const patchFolderSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Folder name is required")
      .max(200, "Folder name must be at most 200 characters")
      .optional(),
    parent_id: z.string().uuid("Invalid parent folder ID").nullable().optional(),
    position: z.number().int().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined || data.parent_id !== undefined || data.position !== undefined,
    { message: "At least one field must be provided to update" },
  );

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid folder ID");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }

  const parsed = patchFolderSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data: existing, error: existingError } = await auth.supabase
    .from("folders")
    .select("id, parent_id")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to load folder:", existingError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  if (!existing) {
    return jsonError(404, "Folder not found.");
  }

  const updateData: {
    name?: string;
    parent_id?: string | null;
    position?: number;
  } = {};

  if (parsed.data.name !== undefined) {
    updateData.name = parsed.data.name;
  }
  if (parsed.data.parent_id !== undefined) {
    updateData.parent_id = parsed.data.parent_id;
    if (parsed.data.position === undefined && parsed.data.parent_id !== existing.parent_id) {
      updateData.position = await nextPosition(
        auth.supabase,
        auth.user.id,
        parsed.data.parent_id,
        "folders",
      );
    }
  }
  if (parsed.data.position !== undefined) {
    updateData.position = parsed.data.position;
  }

  const { data: updatedFolder, error: updateError } = await auth.supabase
    .from("folders")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .select()
    .maybeSingle();

  if (updateError) {
    if (updateError.message.includes("a folder cannot be moved inside itself")) {
      return jsonError(400, "You can't move a group inside itself.");
    }
    if (updateError.message.includes("a group with sources cannot become a project")) {
      return jsonError(400, "A group with sources can't become a project. Move it to a project.");
    }
    if (updateError.message.includes("invalid parent folder")) {
      return jsonError(400, "That folder no longer exists.");
    }
    if (updateError.code === "23514") {
      return jsonError(400, "Folder name is invalid.");
    }
    if (updateError.code === "23503") {
      return jsonError(400, "That folder no longer exists.");
    }
    if (updateError.code === "22P02") {
      return jsonError(400, "Invalid folder ID format.");
    }
    console.error("Failed to update folder:", updateError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  if (!updatedFolder) {
    return jsonError(404, "Folder not found.");
  }

  return jsonData(updatedFolder);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const idParsed = idSchema.safeParse(id);
  if (!idParsed.success) {
    return jsonError(400, "Invalid folder ID");
  }

  const { data: existing, error: checkError } = await auth.supabase
    .from("folders")
    .select("id")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (checkError) {
    console.error("Failed to load folder for delete:", checkError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  if (!existing) {
    return jsonError(404, "Folder not found.");
  }

  const { error: rpcError } = await auth.supabase.rpc("soft_delete_folder", {
    p_folder_id: id,
    p_user_id: auth.user.id,
  });

  if (rpcError) {
    console.error("Failed to soft delete folder:", rpcError);
    return jsonError(500, "Something went wrong. Try again.");
  }

  return jsonData({ id });
}
