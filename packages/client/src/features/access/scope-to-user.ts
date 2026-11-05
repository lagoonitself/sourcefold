import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";

// `sf_` token requests use the admin client, which skips row level security. Session clients are
// held to "your own rows or a project you're in" by the database; a token user is held to "your
// own rows" here, by adding `user_id = <user>` to every read, update and delete.

/** The public tables without a `user_id` column. */
const WITHOUT_USER_ID = new Set(["signup_allow_list", "project_invites"]);

const SCOPED_METHODS = new Set(["select", "update", "delete"]);

type Builder = Record<string | symbol, unknown>;

function scopeBuilder(builder: Builder, userId: string): Builder {
  return new Proxy(builder, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && SCOPED_METHODS.has(prop)) {
        return (...args: unknown[]) => {
          const filtered = (value as (...a: unknown[]) => unknown).apply(target, args);
          return (filtered as { eq(column: string, value: string): unknown }).eq("user_id", userId);
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * Wraps the admin client so every `select`, `update` and `delete` on a table with a `user_id`
 * column also filters by `userId`. `insert`, `upsert`, `rpc`, `storage`, `auth` and the rest pass
 * through unchanged.
 */
export function scopeToUser(
  admin: SupabaseClient<Database>,
  userId: string,
): SupabaseClient<Database> {
  return new Proxy(admin, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "from") {
        return (table: string) => {
          const builder = (target.from as unknown as (t: string) => Builder).call(target, table);
          return WITHOUT_USER_ID.has(table) ? builder : scopeBuilder(builder, userId);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
