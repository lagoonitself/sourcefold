import { describe, expect, it, vi } from "vitest";
import type { Folder, Item } from "../types";
import { registerLibraryTools, TREE_URL_LIMIT } from "../tools/library";
import { closedDesktop, connect, fakeDesktop, fakeWeb } from "./harness";

const folders: Array<Folder & { archived?: boolean }> = [
  { id: "p1", parent_id: null, name: "Cars", position: 0, item_count: 0, archived: false },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0, item_count: 2 },
  { id: "g2", parent_id: "g1", name: "Turbo", position: 0, item_count: 1 },
  { id: "p2", parent_id: null, name: "Boats", position: 1, item_count: 0, archived: true },
  { id: "g3", parent_id: "p2", name: "Sails", position: 0, item_count: 1 },
  { id: "p3", parent_id: null, name: "Planes", position: 2, item_count: 0, archived: false },
];

function item(id: string, folder: string, extra: Partial<Item> = {}): Item {
  return {
    id,
    folder_id: folder,
    kind: "web",
    title: `Title ${id}`,
    source_url: `https://example.com/${id}`,
    status: "saved",
    meta: null,
    created_at: "2026-10-01T10:00:00Z",
    ...extra,
  };
}

const itemsByFolder: Record<string, Item[]> = {
  g1: [
    item("i1", "g1", { kind: "youtube", meta: { channel: "Engineering Explained" } }),
    item("i2", "g1", { note: "x".repeat(300), status: "error", error: "Blocked by the site" }),
  ],
  g2: [item("i3", "g2")],
  g3: [item("i4", "g3")],
};

function web(overrides: Record<string, Parameters<typeof fakeWeb>[0][string]> = {}) {
  return fakeWeb({
    "GET /folders": () => ({ json: { data: folders } }),
    "GET /items": ({ query }) => {
      const folder = query.get("folder");
      if (folder) return { json: { data: itemsByFolder[folder] ?? [] } };
      const q = query.get("q")?.toLowerCase() ?? "";
      const all = Object.values(itemsByFolder).flat();
      return { json: { data: all.filter((i) => i.title.toLowerCase().includes(q)) } };
    },
    ...overrides,
  });
}

describe("get_status", () => {
  it("reports sign-in, desktop app and Drive", async () => {
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /drive/status": () => ({
          json: { data: { unsaved: 3, last_saved_at: "2026-10-17T08:00:00Z", connected: true } },
        }),
      }),
      desktop: fakeDesktop(),
    });
    const { text, isError } = await h.call("get_status");
    expect(isError).toBe(false);
    expect(text).toContain("Signed in as owner@example.com at https://sourcefold.test");
    expect(text).toContain("using the desktop app's sign-in");
    expect(text).toContain("Desktop app: open, version 0.4.1, signed in");
    expect(text).toContain("3 changes not saved yet");
    expect(text).toContain("last saved 2026-10-17");
  });

  it("still answers when Drive fails and the desktop app is closed", async () => {
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /drive/status": () => ({ status: 500, json: { error: { message: "Boom" } } }),
      }),
      credentials: { webUrl: "https://x.test", token: "t", source: "settings", email: null },
    });
    const { text, isError } = await h.call("get_status");
    expect(isError).toBe(false);
    expect(text).toContain("using the access token from Claude Desktop's settings");
    expect(text).toContain("Desktop app: not open");
    expect(text).toContain("Google Drive: couldn't check (Boom)");
  });

  it("says when nobody is signed in", async () => {
    const h = await connect(registerLibraryTools, { web: web(), credentials: null });
    const { text } = await h.call("get_status");
    expect(text).toContain("Not signed in");
  });
});

describe("list_projects", () => {
  it("lists projects with group and source counts and hides archived ones", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("list_projects");
    expect(text).toContain("[p1] Cars · 2 groups · 3 sources");
    expect(text).toContain("[p3] Planes · 0 groups · 0 sources");
    expect(text).not.toContain("Boats");
  });

  it("includes archived projects on request", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("list_projects", { include_archived: true });
    expect(text).toContain("[p2] Boats · 1 group · 1 source · archived");
  });

  it("asks the web app for archived projects too", async () => {
    const fake = web();
    const h = await connect(registerLibraryTools, { web: fake });
    await h.call("list_projects");
    expect(fake.calls).toEqual(["GET /folders?includeArchived=true"]);
  });
});

describe("get_project_tree", () => {
  it("nests groups and lists sources with urls", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text, isError } = await h.call("get_project_tree", {
      project_id: "p1",
      include_sources: true,
    });
    expect(isError).toBe(false);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Project: [p1] Cars · 2 groups · 3 sources");
    expect(text).toContain("Group [g1] Engines · 2 sources");
    expect(text).toContain(
      "  [i1] YouTube · Title i1 · Engineering Explained · 2026-10-01 · https://example.com/i1",
    );
    // The nested group is indented one level deeper than its parent.
    expect(lines).toContain("  Group [g2] Turbo · 1 source");
    expect(text).not.toContain("urls are left out");
  });

  it("shows only the groups by default and makes no per-group requests", async () => {
    const fake = web();
    const h = await connect(registerLibraryTools, { web: fake });
    const { text } = await h.call("get_project_tree", { project_id: "p1" });
    expect(text).toContain("list_sources with a group's id shows its source titles");
    expect(text).toContain("Group [g1] Engines · 2 sources");
    expect(text).not.toContain("[i1]");
    expect(fake.calls).toEqual(["GET /folders?includeArchived=true"]);
  });

  it("auto-compacts over 300 sources", async () => {
    const many = Array.from({ length: TREE_URL_LIMIT + 1 }, (_, n) => item(`m${n}`, "g1"));
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items": ({ query }) => ({
          json: { data: query.get("folder") === "g1" ? many : [] },
        }),
      }),
    });
    const { text } = await h.call("get_project_tree", { project_id: "p1", include_sources: true });
    expect(text).toContain("Short ids: the first 8 characters of each id; any tool accepts them.");
    expect(text).toContain("  [m0] Title m0");
    expect(text).not.toContain("Web page");
    expect(text).not.toContain("https://example.com/m0");
  });

  it("compact mode explicitly requested", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("get_project_tree", {
      project_id: "p1",
      include_sources: true,
      compact: true,
    });
    expect(text).toContain("Short ids: the first 8 characters of each id; any tool accepts them.");
    expect(text).toContain("  [i1] Title i1");
    expect(text).not.toContain("https://example.com/i1");
  });

  it("scopes output to a group and its subgroups when group_id is provided", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("get_project_tree", {
      project_id: "p1",
      group_id: "g2",
      include_sources: true,
    });
    expect(text).toContain("Group [g2] Turbo · 1 source");
    expect(text).toContain("  [i3] Web page · Title i3");
    expect(text).not.toContain("Group [g1] Engines");
    expect(text).not.toContain("[i1]");
  });

  it("caps tree output at 60,000 characters and lists cut groups", async () => {
    const bigGroup1 = Array.from({ length: 400 }, (_, n) =>
      item(`a${n}`, "g1", {
        title: `A very long title that takes up characters in group one number ${n}`,
      }),
    );
    const bigGroup2 = Array.from({ length: 400 }, (_, n) =>
      item(`b${n}`, "g2", {
        title: `A very long title that takes up characters in group two number ${n}`,
      }),
    );
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items": ({ query }) => {
          const folder = query.get("folder");
          if (folder === "g1") return { json: { data: bigGroup1 } };
          if (folder === "g2") return { json: { data: bigGroup2 } };
          return { json: { data: [] } };
        },
      }),
    });
    const { text } = await h.call("get_project_tree", {
      project_id: "p1",
      include_sources: true,
    });
    expect(text).toContain(
      "more sources not shown. Call get_project_tree with group_id set to one of these groups:",
    );
    expect(text).toContain("g2 Turbo");
  });

  it("keeps urls at exactly 300 sources", async () => {
    const many = Array.from({ length: TREE_URL_LIMIT }, (_, n) => item(`m${n}`, "g1"));
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items": ({ query }) => ({
          json: { data: query.get("folder") === "g1" ? many : [] },
        }),
      }),
    });
    const { text } = await h.call("get_project_tree", { project_id: "p1", include_sources: true });
    expect(text).toContain("https://example.com/m0");
  });

  it("loads at most 6 groups at a time", async () => {
    const wide: Folder[] = [
      { id: "p", parent_id: null, name: "Wide", position: 0 },
      ...Array.from({ length: 20 }, (_, n) => ({
        id: `g${n}`,
        parent_id: "p",
        name: `G${n}`,
        position: n,
      })),
    ];
    let active = 0;
    let peak = 0;
    const h = await connect(registerLibraryTools, {
      web: fakeWeb({
        "GET /folders": () => ({ json: { data: wide } }),
        "GET /items": async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return { json: { data: [] } };
        },
      }),
    });
    const { isError } = await h.call("get_project_tree", {
      project_id: "p",
      include_sources: true,
    });
    expect(isError).toBe(false);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("explains when the id is a group or unknown", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const group = await h.call("get_project_tree", { project_id: "g1" });
    expect(group.isError).toBe(true);
    expect(group.text).toContain('Its project is "Cars" [p1]');
    const missing = await h.call("get_project_tree", { project_id: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("No project with id nope");
  });

  it("notes a group whose sources couldn't be loaded and carries on", async () => {
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items": ({ query }) =>
          query.get("folder") === "g2"
            ? { status: 500, json: { error: { message: "Database busy" } } }
            : { json: { data: itemsByFolder[query.get("folder") ?? ""] ?? [] } },
      }),
    });
    const { text, isError } = await h.call("get_project_tree", {
      project_id: "p1",
      include_sources: true,
    });
    expect(isError).toBe(false);
    expect(text).toContain("couldn't list its sources: Database busy");
    expect(text).toContain("[i1]");
  });
});

describe("list_sources", () => {
  it("lists one line per source, with subgroups first, and no urls or notes", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("list_sources", { group_id: "g1" });
    expect(text.split("\n")).toEqual([
      "Cars › Engines [g1] · 2 sources",
      "Subgroups:",
      "  Group [g2] Turbo · 1 source",
      "Sources:",
      "[i1] YouTube · Title i1 · Engineering Explained · 2026-10-01",
      "[i2] Web page · Title i2 · 2026-10-01 · error",
      "  Error: Blocked by the site",
    ]);
  });

  it("pages long groups", async () => {
    const many = Array.from({ length: 130 }, (_, n) => item(`m${n}`, "g2"));
    const h = await connect(registerLibraryTools, {
      web: web({ "GET /items": () => ({ json: { data: many } }) }),
    });
    const first = await h.call("list_sources", { group_id: "g2" });
    expect(first.text).toContain("[m99]");
    expect(first.text).not.toContain("[m100]");
    expect(first.text).toContain(
      "Showing 1–100 of 130. Call list_sources with offset=100 for more.",
    );
    const second = await h.call("list_sources", { group_id: "g2", offset: 100 });
    expect(second.text).toContain("[m129]");
    expect(second.text).not.toContain("[m99]");
    expect(second.text).not.toContain("Showing");
  });

  it("shows url, error and the start of the note with details", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text } = await h.call("list_sources", { group_id: "g1", details: true });
    expect(text).toContain("Cars › Engines [g1] · 2 sources");
    expect(text).toContain("  https://example.com/i1");
    expect(text).toContain("  Error: Blocked by the site");
    expect(text).toMatch(/ {2}Note: x{150,}/);
    expect(text).not.toContain("x".repeat(250));
  });

  it("refuses a project and an unknown group", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const project = await h.call("list_sources", { group_id: "p1" });
    expect(project.isError).toBe(true);
    expect(project.text).toContain("can't live directly in a project");
    const missing = await h.call("list_sources", { group_id: "zzz" });
    expect(missing.text).toContain("No group with id zzz");
  });
});

describe("find_sources", () => {
  it("searches titles only, and says so, when the desktop app is closed", async () => {
    const h = await connect(registerLibraryTools, { web: web(), desktop: closedDesktop() });
    const { text, isError } = await h.call("find_sources", { query: "Title i1" });
    expect(isError).toBe(false);
    expect(text).toContain('Titles matching "Title i1" (1):');
    expect(text).toContain("[i1] YouTube · Title i1");
    expect(text).toContain("in Cars › Engines");
    expect(text).toContain("needs the Sourcefold desktop app to be open");
  });

  it("adds passages from the desktop app", async () => {
    const search = vi.fn(async () => ({
      passages: [
        {
          item_id: "i1",
          project_id: "p1",
          folder_id: "g1",
          title: "Title i1",
          kind: "youtube",
          url: "https://youtu.be/abc",
          heading: "Intro › Boost",
          snippet: "the \u0002turbo\u0003 spools up",
          passage_start: "x",
          seconds: 754,
          matched: "keyword" as const,
          score: 1,
        },
      ],
      notes: [],
      meaning: "off" as const,
      took_ms: 3,
    }));
    const h = await connect(registerLibraryTools, {
      web: web(),
      desktop: fakeDesktop({ search }),
    });
    const { text } = await h.call("find_sources", { query: "turbo", project_id: "p1" });
    expect(search).toHaveBeenCalledWith({
      query: "turbo",
      scope: "project",
      project_id: "p1",
      limit: 20,
    });
    expect(text).toContain("Passages inside sources (1):");
    expect(text).toContain("- Title i1 [i1] · in Cars › Engines");
    expect(text).toContain("Heading: Intro › Boost");
    expect(text).toContain("the **turbo** spools up");
    expect(text).toContain("At 12:34 in the video");
  });

  it("keeps only titles inside the given project", async () => {
    const h = await connect(registerLibraryTools, { web: web(), desktop: closedDesktop() });
    const inBoats = await h.call("find_sources", {
      query: "Title",
      project_id: "p2",
      inside_text: false,
    });
    expect(inBoats.text).toContain("[i4]");
    expect(inBoats.text).not.toContain("[i1]");
    const inCars = await h.call("find_sources", {
      query: "Title",
      project_id: "p1",
      inside_text: false,
    });
    expect(inCars.text).not.toContain("[i4]");
    expect(inCars.text).toContain("[i3]");
    expect(inCars.text).not.toContain("desktop app");
  });

  it("does not search inside text when asked not to", async () => {
    const desktop = fakeDesktop();
    const h = await connect(registerLibraryTools, { web: web(), desktop });
    await h.call("find_sources", { query: "Title", inside_text: false });
    expect(desktop.search).not.toHaveBeenCalled();
  });

  it("fails clearly for an unknown project", async () => {
    const h = await connect(registerLibraryTools, { web: web() });
    const { text, isError } = await h.call("find_sources", { query: "a", project_id: "nope" });
    expect(isError).toBe(true);
    expect(text).toContain("No project with id nope");
  });
});

describe("get_source", () => {
  it("combines the item, its saved details and its group path", async () => {
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items/*": () => ({
          json: {
            data: {
              id: "i1",
              kind: "youtube",
              title: "Title i1",
              note: "my note",
              folder_id: "g1",
            },
          },
        }),
      }),
    });
    const { text, isError } = await h.call("get_source", { source_id: "i1" });
    expect(isError).toBe(false);
    expect(text).toContain("[i1] YouTube · Title i1");
    expect(text).toContain("URL: https://example.com/i1");
    expect(text).toContain("Group: Cars › Engines [g1]");
    expect(text).toContain("channel: Engineering Explained");
    expect(text).toContain("Note: my note");
  });

  it("passes the web app's message when the source is gone", async () => {
    const h = await connect(registerLibraryTools, {
      web: web({
        "GET /items/*": () => ({ status: 404, json: { error: { message: "Item not found." } } }),
      }),
    });
    const { text, isError } = await h.call("get_source", { source_id: "gone" });
    expect(isError).toBe(true);
    expect(text).toBe("Item not found.");
  });
});
