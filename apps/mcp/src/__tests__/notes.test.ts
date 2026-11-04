import { describe, expect, it } from "vitest";
import { registerNotesTools } from "../tools/notes";
import type { Folder } from "../types";
import { connect, fakeWeb } from "./harness";

const folders: Folder[] = [
  { id: "p1", parent_id: null, name: "Cars", position: 0 },
  { id: "g1", parent_id: "p1", name: "Engines", position: 0 },
];

const noteReply = {
  id: "n1",
  folder_id: "g1",
  kind: "note",
  title: "Plan",
  status: "saved",
  source_url: null,
  meta: {},
  created_at: "2026-10-01T00:00:00Z",
};

describe("create_note", () => {
  it("creates a note in a group", async () => {
    const web = fakeWeb({
      "GET /folders": () => ({ json: { data: folders } }),
      "POST /notes": () => ({ status: 201, json: { data: noteReply } }),
    });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("create_note", {
      group_id: "g1",
      title: "Plan",
      text: "# Plan\n\n- step",
    });
    expect(isError).toBe(false);
    expect(text).toBe("Created note in Cars › Engines: [n1] Note · Plan · 2026-10-01");
    expect(web.bodies.at(-1)).toEqual({
      folder_id: "g1",
      title: "Plan",
      markdown: "# Plan\n\n- step",
    });
  });

  it("refuses a project, since notes live in groups", async () => {
    const web = fakeWeb({ "GET /folders": () => ({ json: { data: folders } }) });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("create_note", { group_id: "p1", title: "T", text: "" });
    expect(isError).toBe(true);
    expect(text).toContain("can't live directly in a project");
    expect(web.calls.some((c) => c.startsWith("POST"))).toBe(false);
  });
});

describe("edit_note", () => {
  const noteGet = () => ({ json: { data: { id: "n1", kind: "note", title: "Plan" } } });

  it("sends only what changed", async () => {
    const web = fakeWeb({
      "GET /items/*": noteGet,
      "PATCH /items/*": () => ({ json: { data: noteReply } }),
    });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("edit_note", { note_id: "n1", text: "New text" });
    expect(isError).toBe(false);
    expect(text).toContain("Updated text: [n1]");
    const patches = () => web.bodies.filter((_, i) => web.calls[i]?.startsWith("PATCH"));
    expect(patches()[0]).toEqual({ markdown: "New text" });
    const both = await h.call("edit_note", { note_id: "n1", title: "T", text: "" });
    expect(both.text).toContain("Updated title and text");
    expect(patches()[1]).toEqual({ title: "T", markdown: "" });
  });

  // QA 2026-11-04 P0-1: edit_note on a web page replaced the whole article.
  it.each(["web", "grokipedia", "youtube", "pdf"])(
    "refuses a %s source and never sends a PATCH",
    async (kind) => {
      const web = fakeWeb({
        "GET /items/*": () => ({
          json: { data: { id: "s1", kind, title: "How to Do Great Work" } },
        }),
        "PATCH /items/*": () => ({ json: { data: { ...noteReply, id: "s1", kind } } }),
      });
      const h = await connect(registerNotesTools, { web });
      const { text, isError } = await h.call("edit_note", { note_id: "s1", text: "x" });
      expect(isError).toBe(true);
      expect(text).toContain("isn't a note");
      expect(text).toContain("left it unchanged");
      expect(text).toContain("update_source");
      expect(web.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
    },
  );

  it("refuses a title-only change on a non-note too", async () => {
    const web = fakeWeb({
      "GET /items/*": () => ({ json: { data: { id: "s1", kind: "web", title: "Page" } } }),
    });
    const h = await connect(registerNotesTools, { web });
    const { isError } = await h.call("edit_note", { note_id: "s1", title: "New" });
    expect(isError).toBe(true);
    expect(web.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });

  it("passes on a missing note", async () => {
    const web = fakeWeb({
      "GET /items/*": () => ({ status: 404, json: { error: { message: "Item not found." } } }),
    });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("edit_note", { note_id: "nope", text: "x" });
    expect(isError).toBe(true);
    expect(text).toContain("Item not found.");
    expect(web.calls.some((c) => c.startsWith("PATCH"))).toBe(false);
  });

  it("needs something to change", async () => {
    const h = await connect(registerNotesTools, { web: fakeWeb({}) });
    const { text, isError } = await h.call("edit_note", { note_id: "n1" });
    expect(isError).toBe(true);
    expect(text).toContain("Nothing to change");
  });
});
