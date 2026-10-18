import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { DesktopBridge } from "../desktop-bridge";
import type { WebApi } from "../web-api";
import { messageOf } from "./format";

export interface ToolContext {
  api: WebApi;
  desktop: DesktopBridge;
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
  /** Answers with text for the model. Throw to answer with an error. */
  run(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<string>;
}

export function defineTool<S extends Shape>(
  server: McpServer,
  ctx: ToolContext,
  spec: ToolSpec<S>,
) {
  const handler = async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
    try {
      const text = await spec.run(args, ctx);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: messageOf(err) }], isError: true };
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
