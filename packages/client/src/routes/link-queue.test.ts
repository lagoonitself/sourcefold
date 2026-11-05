import { describe, expect, it } from "vitest";
import type { RouteContext } from "../context";
import { callsOf } from "../test/fake-db";
import { createScriptedDb } from "../test/scripted-db";
import { dispatchRoute } from "../router";
import * as route from "./link-queue";
import * as claimRoute from "./link-queue/claim";
import * as itemRoute from "./link-queue/[id]";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const FOLDER_ID = "00000000-0000-4000-8000-000000000002";
const QUEUE_ID = "00000000-0000-4000-8000-000000000003";

function queueRow(patch: Record<string, unknown> = {}) {
  return {
    id: QUEUE_ID,
    user_id: USER_ID,
    folder_id: FOLDER_ID,
    url: "https://example.com/article",
    kind: "web",
    needs: "desktop",
    status: "waiting",
    claimed_by: null,
    claimed_at: null,
    attempts: 0,
    message: "Cloud fetch was refused.",
    title: null,
    item_id: null,
    added_by: "Claude",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...patch,
  };
}

function context(db: object) {
  return {
    db,
    userId: USER_ID,
    via: "token",
    host: {},
  } as unknown as RouteContext;
}

describe("link queue routes", () => {
  it("lists open rows scoped to the user, oldest first", async () => {
    const fake = createScriptedDb({ link_queue: [{ data: [queueRow()] }] });
    const response = await route.GET(
      context(fake.db),
      new Request("https://sourcefold.test/api/link-queue"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [expect.objectContaining({ id: QUEUE_ID })] });
    const query = fake.queries[0]!;
    expect(callsOf(query, "eq")).toContainEqual(["user_id", USER_ID]);
    expect(callsOf(query, "in")).toContainEqual(["status", ["waiting", "working"]]);
    expect(callsOf(query, "order")).toContainEqual(["created_at", { ascending: true }]);
  });

  it("inserts links in input order and returns an existing open duplicate", async () => {
    const existing = queueRow({ url: "https://example.com/first" });
    const inserted = queueRow({
      id: "00000000-0000-4000-8000-000000000004",
      url: "https://example.com/second",
    });
    const fake = createScriptedDb({
      folders: [{ data: { id: FOLDER_ID, parent_id: "00000000-0000-4000-8000-000000000005" } }],
      link_queue: [{ data: existing }, { data: null }, { data: inserted }],
    });
    const response = await route.POST(
      context(fake.db),
      new Request("https://sourcefold.test/api/link-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: FOLDER_ID,
          added_by: "Claude",
          links: [
            { url: existing.url, kind: "web" },
            { url: inserted.url, kind: "web", message: "Waiting for desktop." },
          ],
        }),
      }),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: { id: string }[] };
    expect(payload.data.map((row) => row.id)).toEqual([existing.id, inserted.id]);
    const folderQuery = fake.queries.find((query) => query.table === "folders")!;
    // The folder is project data: row-level security decides, no user_id filter.
    expect(callsOf(folderQuery, "eq")).not.toContainEqual(["user_id", USER_ID]);
    const queueQueries = fake.queries.filter((query) => query.table === "link_queue");
    for (const query of queueQueries) {
      if (callsOf(query, "insert").length > 0) {
        expect(callsOf(query, "insert")[0]?.[0]).toMatchObject({ user_id: USER_ID });
      } else {
        expect(callsOf(query, "eq")).toContainEqual(["user_id", USER_ID]);
      }
    }
  });

  it("rejects projects as queue folders", async () => {
    const fake = createScriptedDb({ folders: [{ data: { id: FOLDER_ID, parent_id: null } }] });
    const response = await route.POST(
      context(fake.db),
      new Request("https://sourcefold.test/api/link-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: FOLDER_ID, links: [{ url: "https://example.com" }] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "Pick a group. Sources can't be saved directly in a project." },
    });
  });

  it("claims rows through the user-scoped RPC", async () => {
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe("claim_link_queue");
        expect(args).toEqual({
          p_user_id: USER_ID,
          p_needs: "browser",
          p_worker: "extension:install-1",
          p_limit: 1,
        });
        return { data: [queueRow({ needs: "browser", status: "working" })], error: null };
      },
    };
    const response = await claimRoute.POST(
      context(db),
      new Request("https://sourcefold.test/api/link-queue/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needs: "browser", worker: "extension:install-1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: { status: string }[] }).data[0]?.status).toBe(
      "working",
    );
  });

  it("releases a row with cleared claim fields and filters every update by user", async () => {
    const released = queueRow({ claimed_by: null, claimed_at: null, message: "Try again later." });
    const fake = createScriptedDb({ link_queue: [{ data: released }] });
    const response = await itemRoute.PATCH(
      context(fake.db),
      new Request(`https://sourcefold.test/api/link-queue/${QUEUE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "waiting", message: "Try again later." }),
      }),
      { id: QUEUE_ID },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: expect.objectContaining({ status: "waiting" }) });
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
    expect(callsOf(fake.queries[0]!, "in")).toContainEqual([
      "status",
      ["waiting", "working", "saved", "duplicate", "unavailable", "failed"],
    ]);
  });

  it("never brings a cancelled row back when a worker reports late", async () => {
    const fake = createScriptedDb({
      link_queue: [{ data: null }, { data: { id: QUEUE_ID } }],
    });
    const response = await itemRoute.PATCH(
      context(fake.db),
      new Request(`https://sourcefold.test/api/link-queue/${QUEUE_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "saved", title: "Late" }),
      }),
      { id: QUEUE_ID },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { message: "This link was cancelled." } });
  });

  it("exposes dispatchRoute for the same handlers", async () => {
    const fake = createScriptedDb({ link_queue: [{ data: [queueRow()] }] });
    const response = await dispatchRoute(context(fake.db), "/api/link-queue?needs=desktop");
    expect(response.status).toBe(200);
    expect(fake.queries[0]?.table).toBe("link_queue");
  });
});
