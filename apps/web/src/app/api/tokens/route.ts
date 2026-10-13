import { z } from "zod";
import { jsonData, jsonError, requireUser } from "@/lib/api";
import { generateApiToken, hashApiToken } from "@/lib/api-tokens";

export const dynamic = "force-dynamic";

const createTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Token name is required.")
    .max(100, "Token name must be 100 characters or fewer."),
});

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: tokens, error } = await auth.supabase
    .from("api_tokens")
    .select("id, name, created_at, last_used_at")
    .eq("user_id", auth.user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return jsonError(500, error.message);
  }

  return jsonData(tokens ?? []);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid token name.");
  }

  const rawToken = generateApiToken();
  const tokenHash = hashApiToken(rawToken);

  const { data, error } = await auth.supabase
    .from("api_tokens")
    .insert({
      name: parsed.data.name,
      token_hash: tokenHash,
      user_id: auth.user.id,
    })
    .select("id, name, created_at")
    .single();

  if (error || !data) {
    return jsonError(500, "Couldn't create the token. Try again.");
  }

  return jsonData(
    {
      id: data.id,
      name: data.name,
      created_at: data.created_at,
      token: rawToken,
    },
    201,
  );
}
