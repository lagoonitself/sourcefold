import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import { callsOf, createFakeDb } from "../../test/fake-db";
import { scopeToUser } from "./scope-to-user";

const USER = "user-1";

function scoped(results: Record<string, unknown> = {}) {
  const fake = createFakeDb(results, { project_access: [{ project_id: "p" }] });
  const extra = { storage: { from: () => "bucket" }, auth: { admin: "auth" } };
  const admin = Object.assign(fake.db, extra) as unknown as SupabaseClient<Database>;
  return { ...fake, client: scopeToUser(admin, USER) };
}

describe("scopeToUser", () => {
  it("adds the user filter after a select", async () => {
    const { client, queries } = scoped({ items: [{ id: "a" }] });
    const { data } = await client.from("items").select("id").eq("folder_id", "g");
    expect(data).toEqual([{ id: "a" }]);
    expect(callsOf(queries[0]!, "select")).toEqual([["id"]]);
    expect(callsOf(queries[0]!, "eq")).toEqual([
      ["user_id", USER],
      ["folder_id", "g"],
    ]);
  });

  it("scopes a select with count options", async () => {
    const { client, queries } = scoped();
    await client.from("folders").select("*", { count: "exact", head: true }).is("deleted_at", null);
    expect(callsOf(queries[0]!, "select")).toEqual([["*", { count: "exact", head: true }]]);
    expect(callsOf(queries[0]!, "eq")).toEqual([["user_id", USER]]);
    expect(callsOf(queries[0]!, "is")).toEqual([["deleted_at", null]]);
  });

  it("scopes updates and deletes", async () => {
    const { client, queries } = scoped();
    await client.from("highlights").update({ note: "x" }).eq("id", "h");
    await client.from("cards").delete().eq("id", "c");
    expect(callsOf(queries[0]!, "eq")).toEqual([
      ["user_id", USER],
      ["id", "h"],
    ]);
    expect(callsOf(queries[1]!, "eq")).toEqual([
      ["user_id", USER],
      ["id", "c"],
    ]);
  });

  it("leaves insert and upsert alone", async () => {
    const { client, queries } = scoped();
    await client.from("items").insert({ user_id: "u" } as never);
    await client.from("drive_state").upsert({ user_id: "u" } as never, { onConflict: "user_id" });
    expect(callsOf(queries[0]!, "eq")).toEqual([]);
    expect(callsOf(queries[1]!, "eq")).toEqual([]);
    expect(callsOf(queries[0]!, "insert")).toEqual([[{ user_id: "u" }]]);
  });

  it("does not scope the select that follows an insert", async () => {
    const { client, queries } = scoped();
    await client
      .from("items")
      .insert({} as never)
      .select("id")
      .single();
    expect(callsOf(queries[0]!, "eq")).toEqual([]);
    expect(callsOf(queries[0]!, "select")).toEqual([["id"]]);
  });

  it("scopes project_members too", async () => {
    const { client, queries } = scoped();
    await client.from("project_members").select("role");
    expect(callsOf(queries[0]!, "eq")).toEqual([["user_id", USER]]);
  });

  it("skips the tables without a user_id column", async () => {
    const { client, queries } = scoped();
    await client.from("project_invites").select("code");
    await client.from("signup_allow_list").delete().eq("email", "a@b.c");
    expect(callsOf(queries[0]!, "eq")).toEqual([]);
    expect(callsOf(queries[1]!, "eq")).toEqual([["email", "a@b.c"]]);
  });

  it("keeps chaining and awaiting working", async () => {
    const { client } = scoped({ items: [{ id: "a" }] });
    const result = await client
      .from("items")
      .select("id")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    expect(result).toEqual({ data: [{ id: "a" }], error: null });
  });

  it("passes rpc, storage and auth through unchanged", async () => {
    const { client, rpcCalls } = scoped();
    const { data } = await client.rpc("project_access", { p_user_id: USER });
    expect(data).toEqual([{ project_id: "p" }]);
    expect(rpcCalls).toEqual([{ fn: "project_access", args: { p_user_id: USER } }]);
    expect((client.storage as unknown as { from(): string }).from()).toBe("bucket");
    expect(client.auth).toEqual({ admin: "auth" });
  });
});
