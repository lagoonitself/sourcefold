"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/api";
import { generateApiToken, hashApiToken } from "@/lib/api-tokens";
import { validateConnectParams } from "@/features/desktop-connect/validation";

export async function connectDesktopAction(formData: FormData) {
  const auth = await requireUser();
  if ("response" in auth) {
    redirect("/login");
  }

  const callback = formData.get("callback") as string | null;
  const state = formData.get("state") as string | null;

  const validation = validateConnectParams(callback, state);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const rawToken = generateApiToken();
  const tokenHash = hashApiToken(rawToken);

  const { data, error } = await auth.supabase
    .from("api_tokens")
    .insert({
      name: "Sourcefold Desktop",
      token_hash: tokenHash,
      user_id: auth.user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("Failed to create desktop API token. Please try again.");
  }

  const target = new URL(validation.callbackUrl);
  target.searchParams.set("state", validation.state);
  target.searchParams.set("token", rawToken);
  if (auth.user.email) {
    target.searchParams.set("email", auth.user.email);
  }

  redirect(target.toString());
}
