import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export function getPublicEnv() {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

// Server-only: reads ALLOWED_EMAIL from the environment. `*` lets any Google account sign in.
export function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAIL;
  const emails = raw
    ? raw
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0)
    : [];

  if (emails.length === 0) {
    throw new Error("ALLOWED_EMAIL is not set");
  }

  return emails;
}

// Server-only: whether this Google account may use Sourcefold. Throws when ALLOWED_EMAIL is unset.
export function isEmailAllowed(email: string | null | undefined): boolean {
  const allowed = getAllowedEmails();
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return allowed.includes("*") || allowed.includes(normalized);
}
