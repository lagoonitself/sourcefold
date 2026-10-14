import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return jsonError(400, "Invalid token ID.");
  }

  const { data, error } = await auth.supabase
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsedId.data)
    .eq("user_id", auth.user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return jsonError(500, error.message);
  }

  if (!data) {
    return jsonError(404, "Token not found.");
  }

  return jsonData({ id: data.id });
}
