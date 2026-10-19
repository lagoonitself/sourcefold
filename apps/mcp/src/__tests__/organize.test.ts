import { describe, expect, it } from "vitest";
import { registerOrganizeTools } from "../tools/organize";
import type { Folder } from "../types";
import { connect, fakeDesktop, fakeWeb } from "./harness";

const folders: Array<Folder & { archived?: boolean }> = [
  { id: "p1", parent_id: null, name: "Cars", position: 0, item_count: 0, archived: false },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0, item_count: 4 },
  { id: "g2", parent_id: "g1", name: "Turbo", position: 0, item_count: 2 },
  { id: "p9", parent_id: null, name: "AI research", position: 1, item_count: 0 },
  { id: "g9", parent_id: "p9", name: "Papers", position: 0, item_count: 1 },
];

/** `GET /items/<id>`: every source is in g1, except ids starting with "ai" (in AI research). */
const sourceRoute = ({ path }: { path: string }) => {
  const id = path.split("/").pop()!;
  if (id === "bad") return { status: 404, json: { error: { message: "Item not found." } } };
  return {
    json: {
      data: {
        id,
        kind: "web",
        title: `Title ${id}`,
        note: null,
        folder_id: id.startsWith("ai") ? "g9" : "g1",
      },
    },
  };
};

const foldersRoute = () => ({ json: { data: folders } });

const itemReply = (id: string, folder = "g1") => ({
  json: {
    data: {
      id,
      folder_id: folder,
      kind: "web",
      title: `Title ${id}`,
      status: "saved",
      source_url: null,
      meta: null,
      created_at: "2026-10-01T00:00:00Z",
    },
  },
});

describe("create_project / create_group", () => {
  it("creates a project", async () => {
    const web = fakeWeb({
      "POST /folders": ({ body }) => ({
        status: 201,
        json: { data: { id: "np", parent_id: null, name: (body as { name: string }).name } },
      }),
    });
    const desktop = fakeDesktop();
    const h = await connect(registerOrganizeTools, { web, desktop });
    const { text, isError } = await h.call("create_project", { name: "Boats" });
    expect(isError).toBe(false);
    expect(text).toContain('Created project "Boats" [np]');
    expect(web.bodies[0]).toEqual({ name: "Boats" });
    expect(desktop.changed).toHaveBeenCalled();
  });

  it("creates a group inside a group and names where", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "POST /folders": () => ({
        status: 201,
        json: { data: { id: "ng", parent_id: "g1", name: "Diesel" } },
      }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text } = await h.call("create_group", { name: "Diesel", parent_id: "g1" });
    expect(text).toBe('Created group "Diesel" [ng] in Cars › Engines.');
    expect(web.bodies[1]).toEqual({ name: "Diesel", parent_id: "g1" });
  });

  it("rejects a missing parent without calling the web app to create anything", async () => {
    const web = fakeWeb({ "GET /folders": foldersRoute });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("create_group", { name: "X", parent_id: "nope" });
    expect(isError).toBe(true);
    expect(text).toContain("No project or group with id nope");
    expect(web.calls.some((c) => c.startsWith("POST"))).toBe(false);
    expect((await h.call("create_group", { name: "X", parent_id: "" })).isError).toBe(true);
  });
});

describe("update_group", () => {
  it("renames and archives with separate requests, as the web app needs", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "PATCH /folders/*": () => ({ json: { data: { id: "p1" } } }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("update_group", {
      group_id: "p1",
      name: "Automobiles",
      archived: true,
    });
    expect(isError).toBe(false);
    expect(text).toBe('Updated Project "Cars" [p1]: renamed to "Automobiles", archived.');
    const patches = web.calls
      .map((c, i) => ({ c, body: web.bodies[i] }))
      .filter((x) => x.c.startsWith("PATCH"));
    expect(patches).toEqual([
      { c: "PATCH /folders/p1", body: { name: "Automobiles" } },
      { c: "PATCH /folders/p1", body: { archived: true } },
    ]);
  });

  it("moves a group and can make it a project with null", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "PATCH /folders/*": () => ({ json: { data: { id: "g2" } } }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const moved = await h.call("update_group", { group_id: "g2", parent_id: "p1", position: 3 });
    expect(moved.text).toContain("moved into Cars");
    expect(web.bodies.at(-1)).toEqual({ parent_id: "p1", position: 3 });
    const top = await h.call("update_group", { group_id: "g2", parent_id: null });
    expect(top.text).toContain("made a top-level project");
    expect(web.bodies.at(-1)).toEqual({ parent_id: null });
  });

  it("refuses to archive a group and to change nothing", async () => {
    const web = fakeWeb({ "GET /folders": foldersRoute });
    const h = await connect(registerOrganizeTools, { web });
    const archive = await h.call("update_group", { group_id: "g1", archived: true });
    expect(archive.isError).toBe(true);
    expect(archive.text).toContain("Only projects can be archived");
    const nothing = await h.call("update_group", { group_id: "g1" });
    expect(nothing.text).toContain("Nothing to change");
    const unknown = await h.call("update_group", { group_id: "zz", name: "A" });
    expect(unknown.text).toContain("No project or group with id zz");
  });

  it("passes on the web app's refusal with a hint", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "PATCH /folders/*": () => ({
        status: 400,
        json: { error: { message: "You can't move a group inside itself." } },
      }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("update_group", { group_id: "g1", parent_id: "g2" });
    expect(isError).toBe(true);
    expect(text).toBe("You can't move a group inside itself.");
  });
});

describe("delete_group", () => {
  it("deletes and says what went with it", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "DELETE /folders/*": () => ({ json: { data: { id: "g1" } } }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("delete_group", { group_id: "g1" });
    expect(isError).toBe(false);
    expect(text).toBe('Deleted group "Cars › Engines" [g1] with 1 subgroup and 6 sources.');
    expect(web.calls).toContain("DELETE /folders/g1");
  });

  it("does not delete a group that does not exist", async () => {
    const web = fakeWeb({ "GET /folders": foldersRoute });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("delete_group", { group_id: "gone" });
    expect(isError).toBe(true);
    expect(text).toContain("No project or group with id gone");
    expect(web.calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });

  it("adds a hint to the web app's not-found answer", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "DELETE /folders/*": () => ({
        status: 404,
        json: { error: { message: "Folder not found." } },
      }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text } = await h.call("delete_group", { group_id: "g1" });
    expect(text).toBe("Folder not found. Use get_project_tree to find group ids.");
  });
});

describe("update_source", () => {
  it("maps the fields to the web app's and can clear the note", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": sourceRoute,
      "PATCH /items/*": () => itemReply("s1", "g2"),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("update_source", {
      source_id: "s1",
      title: "New",
      group_id: "g2",
      note: null,
    });
    expect(isError).toBe(false);
    expect(text).toContain(
      'renamed from "Title s1", moved from Cars › Engines to Cars › Engines › Turbo, note cleared',
    );
    expect(web.bodies[web.calls.indexOf("PATCH /items/s1")]).toEqual({
      title: "New",
      folder_id: "g2",
      note: null,
    });
  });

  it("needs something to change, and passes on failures", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": sourceRoute,
      "PATCH /items/*": () => ({
        status: 400,
        json: { error: { message: "That title is too long." } },
      }),
    });
    const h = await connect(registerOrganizeTools, { web });
    expect((await h.call("update_source", { source_id: "s1" })).text).toContain(
      "Nothing to change",
    );
    const project = await h.call("update_source", { source_id: "s1", group_id: "p1" });
    expect(project.isError).toBe(true);
    expect(project.text).toContain("can't live directly in a project");
    const bad = await h.call("update_source", { source_id: "s1", title: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("That title is too long.");
    const gone = await h.call("update_source", { source_id: "bad", title: "x" });
    expect(gone.text).toBe("Item not found. Use list_sources to find source ids.");
  });
});

describe("move_sources", () => {
  it("reports each source, moved or failed", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": sourceRoute,
      "PATCH /items/*": ({ path }) => itemReply(path.split("/").pop()!, "g2"),
    });
    const desktop = fakeDesktop();
    const h = await connect(registerOrganizeTools, { web, desktop });
    const { text, isError } = await h.call("move_sources", {
      source_ids: ["a", "bad", "c", "a"],
      group_id: "g2",
    });
    expect(isError).toBe(false);
    expect(text).toContain("Moved 2 of 3 sources to Cars › Engines › Turbo [g2]:");
    expect(text).toContain('[a] Web page · "Title a" (from Cars › Engines)');
    expect(text).toContain("Failed:\n[bad] Item not found. Use list_sources to find source ids.");
    expect(web.calls.filter((c) => c.startsWith("PATCH")).length).toBe(2);
    expect(desktop.changed).toHaveBeenCalled();
  });

  it("throws only when every source failed", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": () => ({ status: 404, json: { error: { message: "Item not found." } } }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("move_sources", {
      source_ids: ["a", "b"],
      group_id: "g2",
    });
    expect(isError).toBe(true);
    expect(text).toContain("Couldn't move any source:");
    expect(text).toContain("[a] Item not found.");
    expect(text).toContain("[b] Item not found.");
  });

  it("refuses a project as the target before moving anything", async () => {
    const web = fakeWeb({ "GET /folders": foldersRoute });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("move_sources", { source_ids: ["a"], group_id: "p1" });
    expect(isError).toBe(true);
    expect(text).toContain("can't live directly in a project");
    expect(web.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });
});

describe("delete_sources", () => {
  it("deletes what it can and lists the failures", async () => {
    const web = fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": sourceRoute,
      "DELETE /items/*": ({ path }) => ({ json: { data: { id: path.split("/").pop() } } }),
    });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("delete_sources", { source_ids: ["a", "bad", "c"] });
    expect(isError).toBe(false);
    expect(text).toContain("Deleted 2 of 3 sources:");
    expect(text).toContain('[a] Web page · "Title a" (in Cars › Engines)');
    expect(text).toContain('[c] Web page · "Title c" (in Cars › Engines)');
    expect(text).toContain("[bad] Item not found.");
  });

  it("throws when nothing could be deleted", async () => {
    const web = fakeWeb({ "GET /folders": foldersRoute });
    const h = await connect(registerOrganizeTools, { web });
    const { text, isError } = await h.call("delete_sources", { source_ids: ["x"] });
    expect(isError).toBe(true);
    expect(text).toContain("Couldn't delete any source:");
    expect(text).toContain("[x]");
  });
});

describe("the project guard", () => {
  function guarded() {
    return fakeWeb({
      "GET /folders": foldersRoute,
      "GET /items/*": sourceRoute,
      "PATCH /items/*": ({ path }) => itemReply(path.split("/").pop()!, "g2"),
      "DELETE /items/*": ({ path }) => ({ json: { data: { id: path.split("/").pop() } } }),
      "PATCH /folders/*": () => ({ json: { data: {} } }),
      "DELETE /folders/*": () => ({ json: { data: {} } }),
    });
  }
  const changed = (web: ReturnType<typeof guarded>) =>
    web.calls.filter((c) => c.startsWith("PATCH") || c.startsWith("DELETE"));

  it("moves and deletes only sources inside the named project", async () => {
    const web = guarded();
    const h = await connect(registerOrganizeTools, { web });
    const moved = await h.call("move_sources", {
      source_ids: ["a", "ai1"],
      group_id: "g2",
      project: "cars",
    });
    expect(moved.isError).toBe(false);
    expect(moved.text).toContain("Moved 1 of 2 sources");
    expect(moved.text).toContain(
      '[ai1] "Title ai1" is in AI research › Papers, outside the project "Cars", so it was left untouched.',
    );
    const deleted = await h.call("delete_sources", { source_ids: ["ai1"], project: "p1" });
    expect(deleted.isError).toBe(true);
    expect(changed(web)).toEqual(["PATCH /items/a"]);
  });

  it("refuses groups and targets outside the project", async () => {
    const web = guarded();
    const h = await connect(registerOrganizeTools, { web });
    const intoOther = await h.call("move_sources", {
      source_ids: ["a"],
      group_id: "g9",
      project: "Cars",
    });
    expect(intoOther.isError).toBe(true);
    expect(intoOther.text).toContain("outside the project");
    const del = await h.call("delete_group", { group_id: "g9", project: "Cars" });
    expect(del.isError).toBe(true);
    expect(del.text).toContain('Group "AI research › Papers" [g9] is in AI research');
    const archive = await h.call("update_group", {
      group_id: "p9",
      archived: true,
      project: "Cars",
    });
    expect(archive.isError).toBe(true);
    const source = await h.call("update_source", { source_id: "ai2", title: "x", project: "Cars" });
    expect(source.isError).toBe(true);
    expect(changed(web)).toEqual([]);

    const ok = await h.call("delete_group", { group_id: "g2", project: "Cars" });
    expect(ok.isError).toBe(false);
    expect(changed(web)).toEqual(["DELETE /folders/g2"]);
  });

  it("explains a project name it doesn't know", async () => {
    const h = await connect(registerOrganizeTools, { web: guarded() });
    const { text, isError } = await h.call("delete_sources", {
      source_ids: ["a"],
      project: "Bikes",
    });
    expect(isError).toBe(true);
    expect(text).toContain(
      'No project is named "Bikes". The projects are: "Cars" [p1], "AI research" [p9].',
    );
  });
});
