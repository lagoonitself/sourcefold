import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShowTarget } from "../types";
import { ApiError } from "../web-api";
import { defineTool, type ToolContext } from "./define";
import { loadFolderIndex, requireFolder } from "./library-data";

/** The source's title, or an error naming the id (QA 2026-11-05: a made-up id "opened"). */
async function requireSource(ctx: ToolContext, id: string): Promise<string> {
  try {
    const item = await ctx.api.get<{ title?: string }>(`/items/${encodeURIComponent(id)}`);
    return item?.title ? `"${item.title}"` : `source [${id}]`;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      throw new Error(`No source with id ${id}. Use list_sources or find_sources to find ids.`);
    }
    throw err;
  }
}

export function registerAppTools(server: McpServer, ctx: ToolContext): void {
  // The web connector runs on the server and can never reach the user's desktop app.
  if (ctx.mode === "remote") return;
  defineTool(server, ctx, {
    name: "show_in_app",
    title: "Show in the Sourcefold app",
    description:
      "Opens a group, a source or a highlight in the Sourcefold desktop app and brings its window to the front, so the user can look at it. Give exactly one target: group_id; or source_id (the reader opens); or source_id together with highlight_id (the reader opens at that highlight; the highlight id alone is not enough). Needs the desktop app to be open; if it isn't, the reply says to open it first. It changes nothing in the library.",
    input: {
      group_id: z.string().optional().describe("Id of a group to open."),
      source_id: z
        .string()
        .optional()
        .describe("Id of a source to open in the reader. Also required with highlight_id."),
      highlight_id: z
        .string()
        .optional()
        .describe("Id of a highlight in that source (from list_highlights). Needs source_id."),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ group_id, source_id, highlight_id }, { api, desktop }) => {
      let target: ShowTarget;
      let what: string;
      if (group_id && !source_id && !highlight_id) {
        const index = await loadFolderIndex(api);
        requireFolder(index, group_id);
        target = { group_id };
        what = `"${index.pathOf(group_id)}"`;
      } else if (source_id && highlight_id && !group_id) {
        const title = await requireSource(ctx, source_id);
        const list = await api.get<{ id: string }[]>("/highlights", { query: { item: source_id } });
        if (!Array.isArray(list) || !list.some((h) => h.id === highlight_id)) {
          throw new Error(
            `No highlight with id ${highlight_id} in that source. list_highlights shows its highlights.`,
          );
        }
        target = { source_id, highlight_id };
        what = `the highlight in ${title}`;
      } else if (source_id && !highlight_id && !group_id) {
        target = { source_id };
        what = await requireSource(ctx, source_id);
      } else if (highlight_id && !source_id) {
        throw new Error(
          "To show a highlight, give its source_id as well as the highlight_id (list_highlights shows both).",
        );
      } else {
        throw new Error(
          "Give exactly one target: group_id, source_id, or source_id with highlight_id.",
        );
      }
      await desktop.show(target);
      return `Opened ${what} in the Sourcefold app.`;
    },
  });
}
