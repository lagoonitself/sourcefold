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
  it("sends only what changed", async () => {
    const web = fakeWeb({ "PATCH /items/*": () => ({ json: { data: noteReply } }) });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("edit_note", { note_id: "n1", text: "New text" });
    expect(isError).toBe(false);
    expect(text).toContain("Updated text: [n1]");
    expect(web.bodies[0]).toEqual({ markdown: "New text" });
    const both = await h.call("edit_note", { note_id: "n1", title: "T", text: "" });
    expect(both.text).toContain("Updated title and text");
    expect(web.bodies[1]).toEqual({ title: "T", markdown: "" });
  });

  it("explains when the source is not a note", async () => {
    const web = fakeWeb({
      "PATCH /items/*": () => ({
        status: 400,
        json: { error: { message: "Only notes have editable text." } },
      }),
    });
    const h = await connect(registerNotesTools, { web });
    const { text, isError } = await h.call("edit_note", { note_id: "s1", text: "x" });
    expect(isError).toBe(true);
    expect(text).toContain("Only notes have editable text.");
    expect(text).toContain("update_source");
  });

  it("needs something to change", async () => {
    const h = await connect(registerNotesTools, { web: fakeWeb({}) });
    const { text, isError } = await h.call("edit_note", { note_id: "n1" });
    expect(isError).toBe(true);
    expect(text).toContain("Nothing to change");
  });
});
