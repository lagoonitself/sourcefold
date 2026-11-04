import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Item } from "../types";
import { defineTool, type ToolContext } from "./define";
import { displayKind, sourceLine } from "./format";
import { loadFolderIndex, requireFolder, withHint } from "./library-data";
import { forgetCachedSource } from "./read";

const MAX_TEXT = 200_000;

export function registerNotesTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "create_note",
    title: "Create a note",
    description:
      "Creates a standalone note (a source of kind Note with text you write, in Markdown) inside a group. Use it to save your own summaries, outlines or findings next to the sources. Sources can't live directly in a project, so group_id must be a group. Answers with the new note's id; edit it later with edit_note.",
    input: {
      group_id: z.string().min(1).describe("Id of the group to put the note in."),
      title: z.string().min(1).max(500).describe("Title of the note."),
      text: z
        .string()
        .max(MAX_TEXT)
        .describe("The note's text in Markdown, up to 200,000 characters. May be empty."),
    },
    run: async ({ group_id, title, text }, { api }) => {
      const index = await loadFolderIndex(api);
      const group = requireFolder(index, group_id, "group");
      const note = await api.post<Item>("/notes", { folder_id: group_id, title, markdown: text });
      return `Created note in ${index.pathOf(group.id)}: ${sourceLine(note)}`;
    },
  });

  defineTool(server, ctx, {
    name: "edit_note",
    title: "Edit a note",
    description:
      "Changes the title and/or replaces the whole text of a standalone note made with create_note (or in the app). Give only what to change; text replaces everything, so read_source the note first to keep what should stay. It only works on notes: for the user's own note attached to another source use update_source.",
    input: {
      note_id: z.string().min(1).describe("Id of the note."),
      title: z.string().min(1).max(500).optional().describe("New title."),
      text: z
        .string()
        .max(MAX_TEXT)
        .optional()
        .describe("New text in Markdown; replaces the old text completely."),
    },
    idempotent: true,
    run: async ({ note_id, title, text }, { api }) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (text !== undefined) body.markdown = text;
      if (Object.keys(body).length === 0) throw new Error("Nothing to change. Give title or text.");
      // The API lets any source's text be replaced (remove_text needs that), so the kind is checked
      // here: edit_note must never overwrite an article, transcript or page.
      const path = `/items/${encodeURIComponent(note_id)}`;
      let existing: Pick<Item, "id" | "kind" | "title">;
      try {
        existing = await api.get<Pick<Item, "id" | "kind" | "title">>(path);
      } catch (err) {
        throw withHint(err, "Use list_sources to find note ids.");
      }
      if (existing.kind !== "note") {
        throw new Error(
          `[${existing.id}] "${existing.title}" (${displayKind({ kind: existing.kind, meta: null })}) isn't a note, so edit_note left it unchanged. Use update_source to set the user's note on it, or remove_text to cut text out of it.`,
        );
      }
      let note: Item;
      try {
        note = await api.patch<Item>(path, body);
      } catch (err) {
        throw withHint(err, "Use list_sources to find note ids.");
      }
      forgetCachedSource(note_id);
      const changes = [title !== undefined ? "title" : null, text !== undefined ? "text" : null];
      return `Updated ${changes.filter(Boolean).join(" and ")}: ${sourceLine(note)}`;
    },
  });
}
