import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appDataDir, loadCredentials } from "../config";
import { createDesktopBridge } from "../desktop-bridge";
import { defineTool } from "../tools/define";
import { indexFolders } from "../tools/format";
import { connect, fakeDesktop, fakeWeb } from "./harness";

describe("loadCredentials", () => {
  it("prefers a pasted token, then the desktop app's sign-in", () => {
    const root = mkdtempSync(join(tmpdir(), "sourcefold-mcp-"));
    const env = { LOCALAPPDATA: root, XDG_DATA_HOME: root, HOME: root } as NodeJS.ProcessEnv;
    const dir = appDataDir(env);
    expect(loadCredentials(env)).toBeNull();

    if (process.platform !== "darwin") {
      // macOS reads ~/Library, which this test can't redirect.
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "session.json"),
        JSON.stringify({ web_url: "https://app.test/", token: "desk", email: "a@b.c" }),
      );
      expect(loadCredentials(env)).toEqual({
        webUrl: "https://app.test",
        token: "desk",
        source: "desktop",
        email: "a@b.c",
      });
      expect(loadCredentials({ ...env, SOURCEFOLD_TOKEN: "pasted" })).toMatchObject({
        webUrl: "https://app.test",
        token: "pasted",
        source: "settings",
      });
    }
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
