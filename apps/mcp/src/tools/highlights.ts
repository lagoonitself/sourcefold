import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HIGHLIGHT_LIMITS } from "@sourcefold/core";
import {
  captureContext,
  citationsInRange,
  locateHighlight,
  overlappingIds,
  secondsAt,
  trimRange,
} from "@sourcefold/core/reader";
import { z } from "zod";
import { findQuote, readerTextOf } from "../reader-text";
import type { Highlight, HighlightInput, Item } from "../types";
import { defineTool, type ToolContext } from "./define";
import { formatSeconds, kindLabel, plural, truncate } from "./format";
import { loadFolderIndex, loadFolderItems, mapLimit, requireFolder } from "./library-data";
import { clearReadCache, forgetCachedSource } from "./read";

/** Kinds whose highlights record the references they cite (the reader does the same). */
const CITING_KINDS = new Set(["grokipedia", "wikipedia"]);
const QUOTE_SHOWN = 600;

function highlightLines(h: Highlight): string[] {
  const time = h.seconds !== null ? `${formatSeconds(h.seconds)} ` : "";
  const quote =
    h.kind === "image"
      ? `(image) ${h.quote || h.image_src || ""}`
      : `"${truncate(h.quote, QUOTE_SHOWN)}"`;
  const lines = [`  [${h.id}] ${time}${quote}`];
  if (h.note) lines.push(`    note: ${truncate(h.note, 400)}`);
  if (h.cited.length > 0) {
    lines.push(`    cites: ${h.cited.map((c) => `[${c.n}] ${c.title ?? c.url}`).join("; ")}`);
  }
  return lines;
}

/** Highlights grouped under their source, in the order the sources are listed. */
function formatHighlights(items: Item[], highlights: Highlight[]): string[] {
  const byItem = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const list = byItem.get(h.item_id) ?? [];
    list.push(h);
    byItem.set(h.item_id, list);
  }
  const lines: string[] = [];
  for (const item of items) {
    const list = byItem.get(item.id);
    if (!list) continue;
    list.sort((a, b) => a.start_offset - b.start_offset);
    lines.push("", `${item.title} · ${kindLabel(item.kind)} [${item.id}]`);
    for (const h of list) lines.push(...highlightLines(h));
  }
  return lines;
}

async function highlightsOf(ctx: ToolContext, query: { item?: string; folder?: string }) {
  const list = await ctx.api.get<Highlight[]>("/highlights", { query });
  return Array.isArray(list) ? list : [];
}

export function registerHighlightsTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "list_highlights",
    title: "List highlights",
    description:
      "The user's highlights (passages they marked while reading, with their notes), for one source, one group, or a whole project. Each shows its id, the quote, the user's note, the YouTube time when it's from a transcript, and the references a Grokipedia or Wikipedia passage cites. Give exactly one of source_id, group_id or project_id. A group means that group only, not its subgroups; a project means every group in it.",
    input: {
      source_id: z.string().optional().describe("Highlights in this source."),
      group_id: z
        .string()
        .optional()
        .describe("Highlights in this group's sources (not subgroups)."),
      project_id: z.string().optional().describe("Highlights in every group of this project."),
    },
    readOnly: true,
    run: async (args) => {
      const given = [args.source_id, args.group_id, args.project_id].filter(Boolean);
      if (given.length !== 1)
        throw new Error("Give exactly one of source_id, group_id or project_id.");

      if (args.source_id) {
        const item = await ctx.api.get<Item>(`/items/${encodeURIComponent(args.source_id)}`);
        const list = await highlightsOf(ctx, { item: item.id });
        if (list.length === 0) return `No highlights in "${item.title}" yet.`;
        return [
          `${plural(list.length, "highlight")} in this source:`,
          ...formatHighlights([item], list),
        ].join("\n");
      }

      const index = await loadFolderIndex(ctx.api);
      const rootId = (args.group_id ?? args.project_id)!;
      const root = requireFolder(index, rootId, args.project_id ? "project" : "group");
      const groups = args.project_id
        ? index.descendantsOf(root.id).filter((f) => f.parent_id)
        : [root];

      const perGroup = await mapLimit(groups, 6, async (group) => {
        const [items, list] = await Promise.all([
          loadFolderItems(ctx.api, group.id),
          highlightsOf(ctx, { folder: group.id }),
        ]);
        return { group, items, list };
      });

      const total = perGroup.reduce((n, g) => n + g.list.length, 0);
      const where = index.pathOf(root.id);
      if (total === 0) return `No highlights in ${where} yet.`;
      const lines = [`${plural(total, "highlight")} in ${where}:`];
      for (const { group, items, list } of perGroup) {
        if (list.length === 0) continue;
        if (args.project_id) lines.push("", `## ${index.pathOf(group.id)} [${group.id}]`);
        lines.push(...formatHighlights(items, list));
      }
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "add_highlight",
    title: "Highlight a passage",
    description:
      "Highlights a passage in a source, as if the user selected it in the reader; it shows in the reader, the Highlights tab and the source's file. quote must be the exact passage as read_source showed it (Markdown marks like ** and link targets are ignored, footnote markers like [^15] may be left out, spacing and curly quotes don't matter). For a long passage, give its first words, then ..., then its last words. If the passage overlaps an existing highlight, nothing is created and that highlight is named instead (use update_highlight to change its note).",
    input: {
      source_id: z.string().describe("The source to highlight in."),
      quote: z.string().min(1).describe("The passage, copied from read_source."),
      note: z.string().max(HIGHLIGHT_LIMITS.note).optional().describe("A note to attach."),
    },
    run: async (args) => {
      const item = await ctx.api.get<Item>(`/items/${encodeURIComponent(args.source_id)}`);
      if (item.kind === "image") throw new Error("Images can't be highlighted from here.");
      const file = await ctx.api.text(`/items/${encodeURIComponent(item.id)}/content`);
      const reader = readerTextOf(file);

      const match = findQuote(reader.text, args.quote, reader.footnoteMarkers);
      if (!match) {
        throw new Error(
          `That passage isn't in "${item.title}". Copy it exactly from read_source (or give its first words ... last words).`,
        );
      }
      const range = trimRange(reader.text, match.start, match.end);
      if (!range) throw new Error("That passage is only spaces.");
      if (range.end - range.start > HIGHLIGHT_LIMITS.quote) {
        throw new Error(
          "That passage is too long to highlight. Choose less than 10,000 characters.",
        );
      }

      const existing = await highlightsOf(ctx, { item: item.id });
      const placed = existing
        .filter((h) => h.kind === "text")
        .flatMap((h) => {
          const at = locateHighlight(reader.text, h);
          return at ? [{ id: h.id, ...at }] : [];
        });
      const overlap = overlappingIds(placed, range.start, range.end)[0];
      if (overlap) {
        const h = existing.find((e) => e.id === overlap)!;
        return `That passage overlaps an existing highlight, so nothing new was made:\n${highlightLines(h).join("\n")}\nUse update_highlight to change its note, or delete_highlight first.`;
      }

      const seconds =
        item.kind === "youtube"
          ? secondsAt(reader.timestamps.marks, range.start, reader.timestamps.end)
          : null;
      const cited = CITING_KINDS.has(item.kind)
        ? citationsInRange(
            reader.footnotes.refs,
            reader.footnotes.defs,
            range.start,
            range.end,
            HIGHLIGHT_LIMITS.cited,
          )
        : [];
      const input: HighlightInput = {
        id: randomUUID(),
        item_id: item.id,
        kind: "text",
        ...captureContext(reader.text, range.start, range.end),
        start_offset: range.start,
        end_offset: range.end,
        image_src: null,
        note: args.note?.trim() || null,
        seconds,
        cited,
      };
      const saved = await ctx.api.put<Highlight>(`/highlights/${input.id}`, input);
      // The file's "My highlights" section changed.
      forgetCachedSource(item.id);
      const lines = [
        `Highlighted in "${item.title}":`,
        ...highlightLines(saved ?? { ...input, created_at: "", updated_at: "" }),
      ];
      if (match.occurrences > 1) {
        lines.push(
          `The passage appears ${match.occurrences} times; the first was highlighted. Quote more words to pick another.`,
        );
      }
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "update_highlight",
    title: "Change a highlight's note",
    description: "Sets or clears (note: null) the note on a highlight.",
    input: {
      highlight_id: z.string().describe("The highlight, from list_highlights."),
      note: z
        .string()
        .max(HIGHLIGHT_LIMITS.note)
        .nullable()
        .describe("The new note, or null to clear it."),
    },
    idempotent: true,
    run: async (args) => {
      const note = args.note?.trim() || null;
      const saved = await ctx.api.patch<Highlight>(
        `/highlights/${encodeURIComponent(args.highlight_id)}`,
        {
          note,
        },
      );
      forgetCachedSource(saved.item_id);
      return [note ? "Note saved:" : "Note cleared:", ...highlightLines(saved)].join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "delete_highlight",
    title: "Delete a highlight",
    description:
      "Deletes one highlight (the passage stays in the source; only the mark and its note go).",
    input: { highlight_id: z.string().describe("The highlight, from list_highlights.") },
    destructive: true,
    idempotent: true,
    run: async (args) => {
      await ctx.api.delete(`/highlights/${encodeURIComponent(args.highlight_id)}`);
      clearReadCache();
      return `Deleted highlight ${args.highlight_id}.`;
    },
  });
}
