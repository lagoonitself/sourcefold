import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appDataDir, DESKTOP_SIGN_IN_EXPIRED_MESSAGE, isExpired, loadCredentials } from "../config";
import { createDesktopBridge } from "../desktop-bridge";
import { defineTool } from "../tools/define";
import { indexFolders } from "../tools/format";
import { createWebApi } from "../web-api";
import { connect, fakeDesktop, fakeWeb } from "./harness";

/** A temp app-data folder with `session` written as session.json (null on macOS, see below). */
function withSession(session: unknown): NodeJS.ProcessEnv | null {
  const root = mkdtempSync(join(tmpdir(), "sourcefold-mcp-"));
  const env = { LOCALAPPDATA: root, XDG_DATA_HOME: root, HOME: root } as NodeJS.ProcessEnv;
  // macOS reads ~/Library, which these tests can't redirect.
  if (process.platform === "darwin") return null;
  const dir = appDataDir(env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session.json"), JSON.stringify(session));
  return env;
}

/** What `apps/desktop/src-tauri/src/session.rs` writes since 2026-10-23. */
const desktopSession = (expiresAt: number) => ({
  supabase_url: "https://project.supabase.co",
  publishable_key: "sb_publishable_test",
  access_token: "eyJ.desktop.jwt",
  expires_at: expiresAt,
  user_id: "00000000-0000-4000-8000-000000000001",
  email: "a@b.c",
  signed_in_at: "2026-11-04T00:00:00Z",
});

describe("loadCredentials", () => {
  it("is null with nothing on this computer", () => {
    const root = mkdtempSync(join(tmpdir(), "sourcefold-mcp-"));
    const env = { LOCALAPPDATA: root, XDG_DATA_HOME: root, HOME: root } as NodeJS.ProcessEnv;
    expect(loadCredentials(env)).toBeNull();
  });

  // QA 2026-11-04 P0-2: the desktop app's current session.json was never read.
  it("reads the desktop app's current session.json", () => {
    const env = withSession(desktopSession(4_102_444_800));
    if (!env) return;
    expect(loadCredentials({ ...env, SOURCEFOLD_WEB_URL: "https://app.test/" })).toEqual({
      webUrl: "https://app.test",
      token: "eyJ.desktop.jwt",
      source: "desktop",
      email: "a@b.c",
      expiresAt: 4_102_444_800,
    });
  });

  it("prefers a pasted token over the desktop app's sign-in", () => {
    const env = withSession(desktopSession(4_102_444_800));
    if (!env) return;
    const creds = loadCredentials({
      ...env,
      SOURCEFOLD_WEB_URL: "https://app.test",
      SOURCEFOLD_TOKEN: "sf_pasted",
    });
    expect(creds).toEqual({
      webUrl: "https://app.test",
      token: "sf_pasted",
      source: "settings",
      email: null,
    });
  });

  it("still reads a session.json from before 2026-10-23", () => {
    const env = withSession({ web_url: "https://old.test/", token: "sf_desk", email: "a@b.c" });
    if (!env) return;
    expect(loadCredentials(env)).toEqual({
      webUrl: "https://old.test",
      token: "sf_desk",
      source: "desktop",
      email: "a@b.c",
    });
  });

  it("marks a desktop sign-in that ran out as expired", () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const creds = {
      webUrl: "https://app.test",
      token: "t",
      source: "desktop" as const,
      email: null,
    };
    expect(isExpired({ ...creds, expiresAt: now / 1000 - 36_000 }, now)).toBe(true);
    expect(isExpired({ ...creds, expiresAt: now / 1000 + 10 }, now)).toBe(true);
    expect(isExpired({ ...creds, expiresAt: now / 1000 + 3_000 }, now)).toBe(false);
    expect(isExpired(creds, now)).toBe(false);
  });

  it("answers an expired desktop sign-in without calling the website", async () => {
    const web = fakeWeb({ "GET /folders": () => ({ json: { data: [] } }) });
    const api = createWebApi({
      credentials: () => ({
        webUrl: "https://app.test",
        token: "eyJ.stale",
        source: "desktop",
        email: null,
        expiresAt: Math.floor(Date.now() / 1000) - 36_000,
      }),
      fetch: web.fetch,
    });
    await expect(api.get("/folders")).rejects.toThrow(DESKTOP_SIGN_IN_EXPIRED_MESSAGE);
    expect(web.calls).toEqual([]);
  });

  it("sends the desktop app's access token as the Bearer token", async () => {
    let auth: string | null = null;
    const api = createWebApi({
      credentials: () => ({
        webUrl: "https://app.test",
        token: "eyJ.fresh",
        source: "desktop",
        email: null,
        expiresAt: Math.floor(Date.now() / 1000) + 3_000,
      }),
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        auth = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }) as typeof fetch,
    });
    await api.get("/folders");
    expect(auth).toBe("Bearer eyJ.fresh");
  });

  it("ignores unfilled bundle settings", () => {
    const root = mkdtempSync(join(tmpdir(), "sourcefold-mcp-"));
    const env = {
      LOCALAPPDATA: root,
      XDG_DATA_HOME: root,
      SOURCEFOLD_TOKEN: "${user_config.api_token}",
      SOURCEFOLD_WEB_URL: "",
    } as NodeJS.ProcessEnv;
    expect(loadCredentials(env)).toBeNull();
  });
});

describe("web API answers", () => {
  // QA 2026-11-04 P2-2: `{ data: null }` came back as the envelope object, not null.
  it("unwraps `{ data: null }` to null", async () => {
    const web = fakeWeb({
      "GET /items/*/text-undos": () => ({ json: { data: null } }),
      "GET /folders": () => ({ json: { data: [] } }),
    });
    const api = createWebApi({
      credentials: () => ({ webUrl: "https://app.test", token: "t", source: "web", email: null }),
      fetch: web.fetch,
    });
    expect(await api.get("/items/s1/text-undos")).toBeNull();
    expect(await api.get("/folders")).toEqual([]);
  });
});

describe("web API errors", () => {
  it("passes the web app's message through and marks the reply as an error", async () => {
    const web = fakeWeb({
      "GET /folders": () => ({
        status: 400,
        json: { error: { message: "That group no longer exists." } },
      }),
    });
    const desktop = fakeDesktop();
    const h = await connect(
      (server, ctx) =>
        defineTool(server, ctx, {
          name: "probe",
          title: "Probe",
          description: "test",
          input: { n: z.number().optional() },
          run: async (_args, { api }) => {
            await api.get("/folders");
            return "unreachable";
          },
        }),
      { web, desktop },
    );
    const result = await h.call("probe");
    expect(result).toEqual({ text: "That group no longer exists.", isError: true });
    // Not marked read-only, so the desktop app is told to reload even after a failure.
    expect(desktop.changed).toHaveBeenCalledTimes(1);
  });

  it("explains how to sign in when there is no sign-in", async () => {
    const web = fakeWeb({});
    const h = await connect(
      (server, ctx) =>
        defineTool(server, ctx, {
          name: "probe",
          title: "Probe",
          description: "test",
          input: {},
          readOnly: true,
          run: async (_args, { api }) => api.get("/folders"),
        }),
      { web, credentials: null },
    );
    const result = await h.call("probe");
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Sign in to the Sourcefold desktop app/);
  });
});

describe("desktop bridge", () => {
  it("is null when the app isn't running", async () => {
    expect(await createDesktopBridge({ agentFile: () => null }).status()).toBeNull();
    const refused = createDesktopBridge({
      agentFile: () => ({ port: 1, key: "k" }),
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(await refused.status()).toBeNull();
    await expect(refused.show({ group_id: "g" })).rejects.toThrow(
      /Open the Sourcefold desktop app/,
    );
  });

  it("sends the key from agent.json", async () => {
    let auth: string | null = null;
    const bridge = createDesktopBridge({
      agentFile: () => ({ port: 23456, key: "secret" }),
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        auth = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    });
    await bridge.show({ source_id: "s" });
    expect(auth).toBe("Bearer secret");
  });
});

describe("indexFolders", () => {
  it("builds paths, projects and descendants", () => {
    const index = indexFolders([
      { id: "p", parent_id: null, name: "Cars", position: 0 },
      { id: "g2", parent_id: "p", name: "Brakes", position: 1 },
      { id: "g1", parent_id: "p", name: "Engines", position: 0 },
      { id: "s", parent_id: "g1", name: "Turbo", position: 0 },
    ]);
    expect(index.children("p").map((f) => f.id)).toEqual(["g1", "g2"]);
    expect(index.pathOf("s")).toBe("Cars › Engines › Turbo");
    expect(index.projectOf("s")?.id).toBe("p");
    expect(index.descendantsOf("g1").map((f) => f.id)).toEqual(["g1", "s"]);
  });
});
