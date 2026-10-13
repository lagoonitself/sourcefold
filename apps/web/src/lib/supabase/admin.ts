import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getPublicEnv } from "@/lib/env";
import { getSupabaseSecretKey } from "@/lib/server-env";

// Bypasses row-level security. Every query made with this client must filter by user_id itself.
export function createAdminClient() {
  return createClient<Database>(getPublicEnv().NEXT_PUBLIC_SUPABASE_URL, getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
