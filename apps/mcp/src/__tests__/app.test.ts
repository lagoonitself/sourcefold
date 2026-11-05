import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer, INSTRUCTIONS } from "../index";
import { registerAppTools } from "../tools/app";
import { createWebApi } from "../web-api";
import { closedDesktop, connect, fakeDesktop, fakeWeb } from "./harness";

const appWeb = () =>
  fakeWeb({
    "GET /folders": () => ({
      json: {
        data: [
          { id: "p1", parent_id: null, name: "Cars", position: 0, item_count: 0 },
          { id: "g1", parent_id: "p1", name: "Engines", position: 0, item_count: 1 },
        ],
      },
    }),
    "GET /items/*": ({ path }) =>
      path === "/items/s1"
        ? { json: { data: { id: "s1", title: "Turbo", folder_id: "g1" } } }
        : { status: 404, json: { error: { message: "Item not found." } } },
    "GET /highlights": () => ({ json: { data: [{ id: "h1" }] } }),
  });

describe("show_in_app", () => {
  it("shows a group, a source, and a highlight with its source", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerAppTools, { web: appWeb(), desktop });
    expect((await h.call("show_in_app", { group_id: "g1" })).text).toBe(
      'Opened "Cars › Engines" in the Sourcefold app.',
    );
    await h.call("show_in_app", { source_id: "s1" });
    const highlight = await h.call("show_in_app", { source_id: "s1", highlight_id: "h1" });
    expect(highlight.text).toContain('the highlight in "Turbo"');
    expect(desktop.show).toHaveBeenNthCalledWith(1, { group_id: "g1" });
    expect(desktop.show).toHaveBeenNthCalledWith(2, { source_id: "s1" });
    expect(desktop.show).toHaveBeenNthCalledWith(3, { source_id: "s1", highlight_id: "h1" });
  });

  it("asks for the desktop app to be opened when it is closed", async () => {
    const h = await connect(registerAppTools, { web: appWeb(), desktop: closedDesktop() });
    const { text, isError } = await h.call("show_in_app", { group_id: "g1" });
    expect(isError).toBe(true);
    expect(text).toBe("Open the Sourcefold desktop app first.");
  });

  it("wants exactly one target and a source with a highlight", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerAppTools, { web: fakeWeb({}), desktop });
    const none = await h.call("show_in_app", {});
    expect(none.isError).toBe(true);
    expect(none.text).toContain("exactly one target");
    const two = await h.call("show_in_app", { group_id: "g1", source_id: "s1" });
    expect(two.isError).toBe(true);
    const lonely = await h.call("show_in_app", { highlight_id: "h1" });
    expect(lonely.isError).toBe(true);
    expect(lonely.text).toContain("source_id");
    expect(desktop.show).not.toHaveBeenCalled();
  });

  // QA 2026-11-05: a made-up all-zeros id was "opened".
  it("refuses ids that don't exist, without opening anything", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerAppTools, { web: appWeb(), desktop });
    const zero = "00000000-0000-0000-0000-000000000000";
    const group = await h.call("show_in_app", { group_id: zero });
    expect(group.isError).toBe(true);
    expect(group.text).toContain(`No project or group with id ${zero}`);
    const source = await h.call("show_in_app", { source_id: zero });
    expect(source.text).toContain(`No source with id ${zero}`);
    const highlight = await h.call("show_in_app", { source_id: "s1", highlight_id: zero });
    expect(highlight.text).toContain(`No highlight with id ${zero}`);
    expect(desktop.show).not.toHaveBeenCalled();
  });
});

// QA 2026-11-04 P1-3: the web connector runs on the server and can never reach the desktop app.
describe("web connector (remote mode)", () => {
  async function connectServer(mode: "local" | "remote") {
    const server = createServer(
      { api: createWebApi({ credentials: () => null }), desktop: closedDesktop() },
      { mode },
    );
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    const { tools } = await client.listTools();
    return { client, tools };
  }

  it("doesn't offer show_in_app or promise desktop features", async () => {
    const remote = await connectServer("remote");
    const names = remote.tools.map((t) => t.name);
    expect(names).not.toContain("show_in_app");
    expect(names).toContain("find_sources");
    const instructions = remote.client.getInstructions() ?? "";
    expect(instructions).not.toContain("show_in_app");
    expect(instructions).toContain("can't search inside sources' text");
    const find = remote.tools.find((t) => t.name === "find_sources");
    expect(find?.description).not.toMatch(/desktop app open/);
  });

  it("keeps them in Claude Desktop", async () => {
    const local = await connectServer("local");
    expect(local.tools.map((t) => t.name)).toContain("show_in_app");
    expect(local.client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toContain("show_in_app opens a group");
  });
});
