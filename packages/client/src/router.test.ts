import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { callsOf, createFakeDb } from "./test/fake-db";
import { createLocalApi, LOCAL_ROUTES, matchRoute } from "./router";
import type { LocalApiDeps } from "./types";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function signedIn(db: object, userId: string | null = USER_ID) {
  return Object.assign(db, {
    auth: {
      getSession: async () => ({
        data: { session: userId ? { user: { id: userId } } : null },
      }),
    },
    functions: { invoke: vi.fn() },
  }) as unknown as LocalApiDeps["supabase"];
}

function api(db: object, userId: string | null = USER_ID) {
  return createLocalApi({
    supabase: signedIn(db, userId),
    fetchUrl: vi.fn(),
    parseHtml: vi.fn(),
  });
}

describe("matchRoute", () => {
  it("prefers literal segments over [params]", () => {
    expect(matchRoute("/api/items/check")?.params).toEqual({});
    expect(matchRoute("/api/items/abc")?.params).toEqual({ id: "abc" });
  });

  it("reads every param and decodes it", () => {
    expect(matchRoute("/api/items/i1/media/a%20b.png")?.params).toEqual({
      id: "i1",
      name: "a b.png",
    });
    expect(matchRoute("/api/x/i9/posts")?.params).toEqual({ itemId: "i9" });
  });

  it("finds nothing for unknown paths", () => {
    expect(matchRoute("/api/tokens")).toBeNull();
    expect(matchRoute("/api/items/a/b/c/d")).toBeNull();
  });

  it("has every route handler in src/routes in its table", () => {
    const routesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "routes");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(routesDir);
    const fromFiles = files
      .map((f) => `/api/${path.relative(routesDir, f).split(path.sep).join("/").slice(0, -3)}`)
      .sort();
    expect(LOCAL_ROUTES.map(([p]) => p).sort()).toEqual(fromFiles);
  });
});

describe("createLocalApi", () => {
  it("answers health like the website", async () => {
    const { db } = createFakeDb({}, { health: 1 });
    const res = await api(db).fetch("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ok" } });
  });

  it("answers 401 without a session, as the website does", async () => {
    const { db } = createFakeDb({ folders: [] });
    const res = await api(db, null).fetch("/api/folders");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { message: "Sign in to continue." } });
  });

  it("answers 404 for unknown paths and 405 for methods a route doesn't have", async () => {
    const { db } = createFakeDb({});
    expect((await api(db).fetch("/api/nope")).status).toBe(404);
    expect((await api(db).fetch("/api/folders", { method: "DELETE" })).status).toBe(405);
  });

  it("runs the website's handler as the signed-in user, with the query string", async () => {
    const fake = createFakeDb(
      {
        folders: [
          { id: "p1", parent_id: null, name: "Cars", position: 0, archived_at: null },
          { id: "p2", parent_id: null, name: "Old", position: 1, archived_at: "2026-10-01" },
        ],
      },
      { folder_item_counts: [] },
    );
    const local = api(fake.db);

    const res = await local.fetch("/api/folders");
    expect(res.status).toBe(200);
    expect(((await res.json()).data as { id: string }[]).map((f) => f.id)).toEqual(["p1"]);

    const all = await local.fetch("/api/folders?includeArchived=true");
    expect(((await all.json()).data as { id: string }[]).map((f) => f.id).sort()).toEqual([
      "p1",
      "p2",
    ]);

    const folderQuery = fake.queries.find((q) => q.table === "folders")!;
    expect(callsOf(folderQuery, "eq")).toContainEqual(["user_id", USER_ID]);
  });

  it("tells the app when something changed", async () => {
    const fake = createFakeDb({ folders: { id: "f1", name: "New" } });
    const onItemsChanged = vi.fn();
    const local = createLocalApi({
      supabase: signedIn(fake.db),
      fetchUrl: vi.fn(),
      parseHtml: vi.fn(),
      onItemsChanged,
    });
    await local.fetch("/api/folders");
    expect(onItemsChanged).not.toHaveBeenCalled();
    const res = await local.fetch("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(201);
    expect(onItemsChanged).toHaveBeenCalledTimes(1);
  });
});
