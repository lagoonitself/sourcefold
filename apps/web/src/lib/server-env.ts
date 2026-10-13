import "server-only";
import { z } from "zod";

const secretKeySchema = z.string().min(1, "SUPABASE_SECRET_KEY is not set");
const googleSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is not set"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is not set"),
});

export function getSupabaseSecretKey(): string {
  return secretKeySchema.parse(process.env.SUPABASE_SECRET_KEY);
}

export function getGoogleClientEnv() {
  return googleSchema.parse({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  });
}
