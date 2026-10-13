import { jsonData, jsonError, requireApiUser } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { data: items, error } = await auth.db
    .from("items")
    .select("id, title, folder_id, created_at")
    .eq("user_id", auth.userId)
    .eq("kind", "x")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return jsonError(500, error.message);
  }

  return jsonData(items ?? []);
}
