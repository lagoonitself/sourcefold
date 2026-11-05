import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { DesktopBridge } from "../desktop-bridge";
import type { WebApi } from "../web-api";
import { scheduleDriveSave } from "./drive-autosave";
import { messageOf } from "./format";
import { createShortIdStore, type ShortIdStore } from "./short-ids";

export interface ToolContext {
  api: WebApi;
  desktop: DesktopBridge;
  mode?: "local" | "remote";
  addedBy?: string;
  shortIds?: ShortIdStore;
}

type Shape = Record<string, z.ZodType>;

export interface ToolSpec<S extends Shape> {
  name: string;
  title: string;
  /** Written for the model: what it does, when to use it, what it answers with. */
  description: string;
  input: S;
  /** Only reads. Mutating tools tell the desktop app to reload when they finish. */
  readOnly?: boolean;
  /** Deletes something. */
  destructive?: boolean;
  /** Calling it twice with the same input changes nothing more. */
  idempotent?: boolean;
  /** Reaches sites other than Sourcefold (fetching links). */
  openWorld?: boolean;
  /** Set false for queue changes that do not change the saved library. */
  syncDrive?: boolean;
  /** Answers with text for the model. Throw to answer with an error. */
  run(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<string>;
}

const TARGET_ID_KEYS = new Set([
  "source_id",
  "source_ids",
  "note_id",
  "group_id",
  "parent_id",
  "project_id",
  "keep_id",
  "ids",
  "highlight_id",
  "card_id",
]);

function resolveToolArgs<T>(args: T, shortIds: ShortIdStore): T {
  if (!args || typeof args !== "object") return args;
  const out = { ...(args as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (!TARGET_ID_KEYS.has(key)) continue;
    const val = out[key];
    if (typeof val === "string") {
      out[key] = shortIds.resolveId(val);
    } else if (Array.isArray(val)) {
      out[key] = val.map((v) => (typeof v === "string" ? shortIds.resolveId(v) : v));
    }
  }
  return out as T;
}

export function defineTool<S extends Shape>(
  server: McpServer,
  ctx: ToolContext,
  spec: ToolSpec<S>,
) {
  const shortIds = ctx.shortIds ?? createShortIdStore();
  const handler = async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
    try {
      const resolved = ctx.mode === "remote" ? args : resolveToolArgs(args, shortIds);
      const text = await spec.run(resolved, ctx);
      if (ctx.mode !== "remote") shortIds.rememberIds(text);
      if (!spec.readOnly && spec.syncDrive !== false && ctx.mode !== "remote") {
        scheduleDriveSave(ctx.api);
      }
      return { content: [{ type: "text", text }] };
    } catch (err) {
      let text = messageOf(err);
      // The API's bare "Item not found." didn't say which id or what to do (QA 2026-11-05).
      if (/^Item not found\.?$/i.test(text.trim())) {
        const id = (args as Record<string, unknown>).source_id;
        text = `${typeof id === "string" ? `No source with id ${id}` : "That source wasn't found"}. Use list_sources or find_sources to find source ids.`;
      }
      return { content: [{ type: "text", text }], isError: true };
    } finally {
      // Also after a partial failure: some of a batch may have changed.
      if (!spec.readOnly) await ctx.desktop.changed();
    }
  };

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: {
        title: spec.title,
        readOnlyHint: spec.readOnly ?? false,
        destructiveHint: spec.destructive ?? false,
        idempotentHint: spec.idempotent ?? false,
        openWorldHint: spec.openWorld ?? false,
      },
    },
    handler as unknown as ToolCallback<S>,
  );
}
