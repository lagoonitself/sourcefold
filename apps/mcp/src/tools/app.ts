import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ShowTarget } from "../types";
import { defineTool, type ToolContext } from "./define";

export function registerAppTools(server: McpServer, ctx: ToolContext): void {
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
    run: async ({ group_id, source_id, highlight_id }, { desktop }) => {
      let target: ShowTarget;
      let what: string;
      if (group_id && !source_id && !highlight_id) {
        target = { group_id };
        what = `group [${group_id}]`;
      } else if (source_id && highlight_id && !group_id) {
        target = { source_id, highlight_id };
        what = `highlight [${highlight_id}] in source [${source_id}]`;
      } else if (source_id && !highlight_id && !group_id) {
        target = { source_id };
        what = `source [${source_id}]`;
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
