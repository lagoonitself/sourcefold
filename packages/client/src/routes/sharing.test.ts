import { describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../context";
import { callsOf, createFakeDb } from "../test/fake-db";
import * as sharing from "./projects/[id]/sharing";
import * as invite from "./projects/[id]/invite";
import * as inviteReset from "./projects/[id]/invite/reset";
import * as member from "./projects/[id]/members/[userId]";
import * as preview from "./invites/[code]";
import * as accept from "./invites/[code]/accept";
import * as backup from "./settings/backup";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";

type RpcResult = { data?: unknown; error?: { code?: string; message: string } | null };

/** A db whose rpc answers come from `answers`, and whose tables from `tables`. */
interface ContextOptions {
  via?: "session" | "token";
  connected?: boolean;
  tables?: Record<string, unknown>;
}

function context(
  answers: Record<string, RpcResult> = {},
  { via = "session", connected = true, tables = {} }: ContextOptions = {},
) {
  const fake = createFakeDb(tables);
  const rpc = vi.fn(async (fn: string) => {
    const answer = answers[fn] ?? {};
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
  const db = Object.assign(fake.db, { rpc });
  const isConnected = vi.fn(async () => connected);
  const auth = {
    db,
    userId: USER,
    via,
    host: { drive: { isConnected } },
  } as unknown as RouteContext;
  return { auth, rpc, queries: fake.queries, isConnected };
}

const json = (body: unknown, method = "POST") =>
  new Request("http://sourcefold.local/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const url = (path: string, method = "GET") =>
  new Request(`http://sourcefold.local${path}`, { method });

async function read(response: Response) {
  return { status: response.status, body: await response.json() };
}

const notOwner = { code: "42501", message: "only the project owner can do that" };

describe("GET /api/projects/[id]/sharing", () => {
  it("returns the database's answer", async () => {
    const sharingData = { project_id: PROJECT, your_role: "owner", members: [], invites: [] };
    const { auth, rpc } = context({ get_project_sharing: { data: sharingData } });
    const res = await read(await sharing.GET(auth, url("/"), { id: PROJECT }));
    expect(res).toEqual({ status: 200, body: { data: sharingData } });
    expect(rpc).toHaveBeenCalledWith("get_project_sharing", { p_project_id: PROJECT });
  });

  it("answers 404 for a project you can't see", async () => {
    const { auth } = context({
      get_project_sharing: { error: { code: "P0002", message: "not found" } },
    });
    const res = await read(await sharing.GET(auth, url("/"), { id: PROJECT }));
    expect(res).toEqual({ status: 404, body: { error: { message: "not found" } } });
  });

  it("refuses tokens and bad ids without asking the database", async () => {
    const token = context({}, { via: "token" });
    expect(await read(await sharing.GET(token.auth, url("/"), { id: PROJECT }))).toEqual({
      status: 403,
      body: { error: { message: "Sharing needs the Sourcefold app or website." } },
    });
    const session = context();
    expect((await sharing.GET(session.auth, url("/"), { id: "nope" })).status).toBe(400);
    expect(token.rpc).not.toHaveBeenCalled();
    expect(session.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/invite", () => {
  it("returns the code for the role", async () => {
    const { auth, rpc } = context({ get_project_invite: { data: "K7QM2XPD" } });
    const res = await read(await invite.POST(auth, json({ role: "viewer" }), { id: PROJECT }));
    expect(res).toEqual({ status: 200, body: { data: { code: "K7QM2XPD", role: "viewer" } } });
    expect(rpc).toHaveBeenCalledWith("get_project_invite", {
      p_project_id: PROJECT,
      p_role: "viewer",
    });
  });

  it("validates the role and the body", async () => {
    const { auth, rpc } = context();
    expect((await invite.POST(auth, json({ role: "owner" }), { id: PROJECT })).status).toBe(400);
    expect((await invite.POST(auth, json({}), { id: PROJECT })).status).toBe(400);
    const broken = new Request("http://sourcefold.local/x", { method: "POST", body: "{" });
    expect((await invite.POST(auth, broken, { id: PROJECT })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 403 with a plain message when you're not the owner", async () => {
    const { auth } = context({ get_project_invite: { error: notOwner } });
    const res = await read(await invite.POST(auth, json({ role: "editor" }), { id: PROJECT }));
    expect(res).toEqual({
      status: 403,
      body: { error: { message: "Only the project's owner can do that." } },
    });
  });

  it("refuses tokens", async () => {
    const { auth, rpc } = context({}, { via: "token" });
    expect((await invite.POST(auth, json({ role: "editor" }), { id: PROJECT })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/projects/[id]/invite", () => {
  it("turns the link for the role off", async () => {
    const { auth, rpc } = context();
    const res = await read(
      await invite.DELETE(auth, url(`/api/projects/${PROJECT}/invite?role=editor`, "DELETE"), {
        id: PROJECT,
      }),
    );
    expect(res).toEqual({ status: 200, body: { data: { ok: true } } });
    expect(rpc).toHaveBeenCalledWith("revoke_project_invite", {
      p_project_id: PROJECT,
      p_role: "editor",
    });
  });

  it("needs a valid role", async () => {
    const { auth, rpc } = context();
    for (const query of ["", "?role=owner"]) {
      const req = url(`/api/projects/${PROJECT}/invite${query}`, "DELETE");
      expect((await invite.DELETE(auth, req, { id: PROJECT })).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps database errors and refuses tokens", async () => {
    const { auth } = context({ revoke_project_invite: { error: notOwner } });
    const req = url(`/x?role=viewer`, "DELETE");
    expect((await invite.DELETE(auth, req, { id: PROJECT })).status).toBe(403);
    const token = context({}, { via: "token" });
    expect((await invite.DELETE(token.auth, req, { id: PROJECT })).status).toBe(403);
    expect(token.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/projects/[id]/invite/reset", () => {
  it("returns the new code", async () => {
    const { auth, rpc } = context({ reset_project_invite: { data: "NEWCODE2" } });
    const res = await read(await inviteReset.POST(auth, json({ role: "editor" }), { id: PROJECT }));
    expect(res).toEqual({ status: 200, body: { data: { code: "NEWCODE2", role: "editor" } } });
    expect(rpc).toHaveBeenCalledWith("reset_project_invite", {
      p_project_id: PROJECT,
      p_role: "editor",
    });
  });

  it("validates, maps errors and refuses tokens", async () => {
    const { auth } = context({ reset_project_invite: { error: notOwner } });
    expect((await inviteReset.POST(auth, json({ role: "x" }), { id: PROJECT })).status).toBe(400);
    expect((await inviteReset.POST(auth, json({ role: "viewer" }), { id: PROJECT })).status).toBe(
      403,
    );
    const token = context({}, { via: "token" });
    expect(
      (await inviteReset.POST(token.auth, json({ role: "viewer" }), { id: PROJECT })).status,
    ).toBe(403);
  });
});

describe("/api/projects/[id]/members/[userId]", () => {
  it("PATCH changes a role", async () => {
    const { auth, rpc } = context();
    const res = await read(
      await member.PATCH(auth, json({ role: "viewer" }, "PATCH"), { id: PROJECT, userId: OTHER }),
    );
    expect(res).toEqual({ status: 200, body: { data: { ok: true } } });
    expect(rpc).toHaveBeenCalledWith("set_project_member_role", {
      p_project_id: PROJECT,
      p_user_id: OTHER,
      p_role: "viewer",
    });
  });

  it("PATCH validates and maps errors", async () => {
    const { auth } = context({ set_project_member_role: { error: notOwner } });
    const params = { id: PROJECT, userId: OTHER };
    expect((await member.PATCH(auth, json({ role: "owner" }), params)).status).toBe(400);
    expect(
      (await member.PATCH(auth, json({ role: "editor" }), { ...params, userId: "x" })).status,
    ).toBe(400);
    expect((await member.PATCH(auth, json({ role: "editor" }), params)).status).toBe(403);
  });

  it("DELETE removes a member or leaves", async () => {
    const { auth, rpc } = context();
    const res = await read(
      await member.DELETE(auth, url("/x", "DELETE"), { id: PROJECT, userId: USER }),
    );
    expect(res).toEqual({ status: 200, body: { data: { ok: true } } });
    expect(rpc).toHaveBeenCalledWith("remove_project_member", {
      p_project_id: PROJECT,
      p_user_id: USER,
    });
  });

  it("DELETE maps errors, checks ids and refuses tokens", async () => {
    const params = { id: PROJECT, userId: OTHER };
    const denied = context({ remove_project_member: { error: notOwner } });
    expect((await member.DELETE(denied.auth, url("/x", "DELETE"), params)).status).toBe(403);
    const bad = context();
    expect(
      (await member.DELETE(bad.auth, url("/x", "DELETE"), { id: "nope", userId: OTHER })).status,
    ).toBe(400);
    const token = context({}, { via: "token" });
    expect((await member.DELETE(token.auth, url("/x", "DELETE"), params)).status).toBe(403);
    expect(bad.rpc).not.toHaveBeenCalled();
    expect(token.rpc).not.toHaveBeenCalled();
  });
});

describe("GET /api/invites/[code]", () => {
  it("returns the preview", async () => {
    const data = { project_id: PROJECT, project_name: "Cars", role: "editor", member_count: 3 };
    const { auth, rpc } = context({ preview_project_invite: { data } });
    const res = await read(await preview.GET(auth, url("/"), { code: "K7QM-2XPD" }));
    expect(res).toEqual({ status: 200, body: { data } });
    expect(rpc).toHaveBeenCalledWith("preview_project_invite", { p_code: "K7QM-2XPD" });
  });

  it("answers 404 for a code that doesn't work", async () => {
    const { auth } = context({ preview_project_invite: { data: null } });
    const res = await read(await preview.GET(auth, url("/"), { code: "ZZZZZZZZ" }));
    expect(res).toEqual({
      status: 404,
      body: { error: { message: "This invite link doesn't work. Ask for a new one." } },
    });
    const empty = await preview.GET(auth, url("/"), { code: "  " });
    expect(empty.status).toBe(404);
  });

  it("refuses tokens", async () => {
    const { auth, rpc } = context({}, { via: "token" });
    expect((await preview.GET(auth, url("/"), { code: "K7QM2XPD" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/invites/[code]/accept", () => {
  it("joins and returns the project id", async () => {
    const { auth, rpc } = context({ accept_project_invite: { data: PROJECT } });
    const res = await read(await accept.POST(auth, url("/", "POST"), { code: "K7QM2XPD" }));
    expect(res).toEqual({ status: 200, body: { data: { project_id: PROJECT } } });
    expect(rpc).toHaveBeenCalledWith("accept_project_invite", { p_code: "K7QM2XPD" });
  });

  it("passes the database's readable message on a bad code", async () => {
    const message = "This invite link doesn't work. Ask for a new one.";
    const { auth } = context({ accept_project_invite: { error: { code: "P0002", message } } });
    const res = await read(await accept.POST(auth, url("/", "POST"), { code: "ZZZZZZZZ" }));
    expect(res).toEqual({ status: 404, body: { error: { message } } });
  });

  it("refuses tokens", async () => {
    const { auth, rpc } = context({}, { via: "token" });
    expect((await accept.POST(auth, url("/", "POST"), { code: "K7QM2XPD" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 500 for an unexpected database error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { auth } = context({ accept_project_invite: { error: { message: "boom" } } });
    expect((await accept.POST(auth, url("/", "POST"), { code: "K7QM2XPD" })).status).toBe(500);
    log.mockRestore();
  });
});

describe("/api/settings/backup", () => {
  it("GET reads drive_state and Drive's connection", async () => {
    const { auth, queries, isConnected } = context(
      {},
      { connected: false, tables: { drive_state: { backup_enabled: false } } },
    );
    const res = await read(await backup.GET(auth));
    expect(res).toEqual({ status: 200, body: { data: { enabled: false, connected: false } } });
    expect(callsOf(queries[0]!, "eq")).toEqual([["user_id", USER]]);
    expect(isConnected).toHaveBeenCalledWith(USER);
  });

  it("GET treats a missing row as on, also for tokens", async () => {
    const { auth } = context({}, { via: "token", tables: { drive_state: null } });
    const res = await read(await backup.GET(auth));
    expect(res).toEqual({ status: 200, body: { data: { enabled: true, connected: true } } });
  });

  it("PUT sets the switch through the database", async () => {
    const { auth, rpc } = context({ set_drive_backup: { data: false } });
    const res = await read(await backup.PUT(auth, json({ enabled: false }, "PUT")));
    expect(res).toEqual({ status: 200, body: { data: { enabled: false } } });
    expect(rpc).toHaveBeenCalledWith("set_drive_backup", { p_enabled: false });
  });

  it("PUT validates the body and refuses tokens", async () => {
    const { auth, rpc } = context();
    expect((await backup.PUT(auth, json({ enabled: "yes" }, "PUT"))).status).toBe(400);
    expect((await backup.PUT(auth, json({}, "PUT"))).status).toBe(400);
    const token = context({}, { via: "token" });
    expect((await backup.PUT(token.auth, json({ enabled: true }, "PUT"))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(token.rpc).not.toHaveBeenCalled();
  });
});
