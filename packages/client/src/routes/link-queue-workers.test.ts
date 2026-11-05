import { describe, expect, it } from "vitest";
import type { RouteContext } from "../context";
import { callsOf } from "../test/fake-db";
import { createScriptedDb } from "../test/scripted-db";
import { matchRoute } from "../router";
import * as route from "./link-queue/workers";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function context(db: object) {
  return { db, userId: USER_ID, via: "session", host: {} } as unknown as RouteContext;
}

function post(body: unknown) {
  return new Request("https://sourcefold.test/api/link-queue/workers", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("link queue workers", () => {
  it("is routed before /api/link-queue/[id]", () => {
    expect(matchRoute("/api/link-queue/workers")?.module).toBe(route);
  });

  it("answers the newest desktop and the best extension check-in", async () => {
    const fake = createScriptedDb({
      link_workers: [
        {
          data: [
            { kind: "extension", can_run: false, seen_at: "2026-11-06T12:00:30Z" },
            { kind: "desktop", can_run: true, seen_at: "2026-11-06T12:00:20Z" },
            { kind: "extension", can_run: true, seen_at: "2026-11-06T12:00:10Z" },
            { kind: "desktop", can_run: true, seen_at: "2026-11-06T11:00:00Z" },
          ],
        },
      ],
    });
    const response = await route.GET(context(fake.db));
    expect(await response.json()).toEqual({
      data: {
        desktop_seen_at: "2026-11-06T12:00:20Z",
        extension_seen_at: "2026-11-06T12:00:10Z",
        extension_can_run: true,
      },
    });
    expect(callsOf(fake.queries[0]!, "eq")).toContainEqual(["user_id", USER_ID]);
  });

  it("answers nulls before anything checked in", async () => {
    const fake = createScriptedDb({ link_workers: [{ data: [] }] });
    const response = await route.GET(context(fake.db));
    expect(await response.json()).toEqual({
      data: { desktop_seen_at: null, extension_seen_at: null, extension_can_run: false },
    });
  });

  it("records a check-in through the database function", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        return { data: null, error: null };
      },
    };
    const response = await route.POST(
      context(db),
      post({ worker: "extension:abc-123", kind: "extension", can_run: false, version: "0.7.1" }),
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      [
        "link_worker_check_in",
        {
          p_worker: "extension:abc-123",
          p_kind: "extension",
          p_can_run: false,
          p_version: "0.7.1",
          p_user_id: USER_ID,
        },
      ],
    ]);
  });

  it("refuses a worker id that doesn't match its kind or isn't an id", async () => {
    const db = { rpc: async () => ({ data: null, error: null }) };
    for (const body of [
      { worker: "desktop:abc", kind: "extension" },
      { worker: "someone else", kind: "desktop" },
      { worker: "desktop:abc", kind: "phone" },
    ]) {
      expect((await route.POST(context(db), post(body))).status).toBe(400);
    }
  });
});
