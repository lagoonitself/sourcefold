import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  locateHighlight,
  removeFromBody,
  targetsForSelection,
  trimRange,
  type RemoveTarget,
} from "@sourcefold/core/reader";
import { z } from "zod";
import { findQuote, readerTextOf, renderedViewOf } from "../reader-text";
import type { Highlight, HighlightInput } from "../types";
import { defineTool, type ToolContext } from "./define";
import { plural, truncate } from "./format";
import {
  loadFolderIndex,
  PROJECT_GUARD_DESCRIPTION,
  requireInProject,
  resolveProject,
  withHint,
} from "./library-data";
import { findHeadings, forgetCachedSource } from "./read";

// remove_text: the desktop reader's "Remove text" (apps/desktop/src/features/reader/
// use-reader-cleanup.ts) for Claude. The cut is made by the same core code on the same blocks the
// reader sees, saved with `PATCH /api/items/[id] { markdown }`, and highlights in the removed text
// are deleted with it. undo_remove_text puts both back.

/** The same kinds as the reader's `canEditText`: the page as it was saved. */
const EDITABLE_KINDS = new Set([
  "grokipedia",
  "wikipedia",
  "substack",
  "youtube",
  "web",
  "reddit",
  "pdf",
  "hackernews",
  "bluesky",
]);

const PREVIEW_CHARS = 400;

interface SourceRef {
  id: string;
  kind: string;
  title: string;
  folder_id: string;
}

interface UndoEntry {
  /** The body before the removal, and after it (to notice edits made since). */
  before: string;
  after: string;
  lost: Highlight[];
}

/** Each source's removals in this server's lifetime, newest last. */
const undoStacks = new Map<string, UndoEntry[]>();

/** For tests. */
export function clearRemoveUndo(): void {
  undoStacks.clear();
}

function toInput(h: Highlight): HighlightInput {
  const { created_at: _created, updated_at: _updated, ...input } = h;
  return input;
}

function sameBody(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

async function loadEditable(
  ctx: ToolContext,
  sourceId: string,
  project: string | undefined,
): Promise<SourceRef> {
  let ref: SourceRef;
  try {
    ref = await ctx.api.get<SourceRef>(`/items/${encodeURIComponent(sourceId)}`);
  } catch (err) {
    throw withHint(err, "Use list_sources to find source ids.");
  }
  if (!EDITABLE_KINDS.has(ref.kind)) {
    throw new Error(
      ref.kind === "note"
        ? `"${ref.title}" is a note: change its text with edit_note.`
        : `Text can't be removed from "${ref.title}" (an ${ref.kind === "x" ? "X thread is built from its posts" : "image has no text"}).`,
    );
  }
  if (project) {
    const index = await loadFolderIndex(ctx.api);
    requireInProject(index, resolveProject(index, project), ref.folder_id, `"${ref.title}"`);
  }
  return ref;
}

export function registerRemoveTextTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "remove_text",
    title: "Remove text from a source",
    description:
      "Cuts text the user doesn't want out of a saved source (an article, transcript, web page, PDF or thread), like the Remove text mode of the desktop reader: the source's file, its Drive copy and the reader all change. Give exactly one of quote (a passage as read_source showed it; for a long one its first words ... its last words) or section (a section number from read_source's outline: the heading and everything under it). Whole paragraphs go with their markup; part of a paragraph, heading or one-line list item can go on its own. Highlights inside the removed text are deleted with it. Only remove what the user asked for. undo_remove_text puts the last removal back.",
    input: {
      source_id: z.string().min(1).describe("The source to cut text from."),
      quote: z
        .string()
        .min(1)
        .optional()
        .describe("The passage to remove, copied from read_source (first words ... last words)."),
      section: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Remove this section (§N in read_source's outline) with its heading."),
      project: z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION),
    },
    destructive: true,
    run: async ({ source_id, quote, section, project }) => {
      if ((quote ? 1 : 0) + (section ? 1 : 0) !== 1) {
        throw new Error("Give exactly one of quote or section.");
      }
      const ref = await loadEditable(ctx, source_id, project);
      const file = await ctx.api.text(`/items/${encodeURIComponent(ref.id)}/content`);
      const reader = readerTextOf(file);
      if (!reader.body.trim()) throw new Error(`"${ref.title}" has no text to remove.`);

      let targets: RemoveTarget[];
      let what: string;
      if (quote) {
        const match = findQuote(reader.text, quote, reader.footnoteMarkers);
        const range = match && trimRange(reader.text, match.start, match.end);
        if (!range) {
          throw new Error(
            `That passage isn't in "${ref.title}". Copy it exactly from read_source (or give its first words ... last words).`,
          );
        }
        targets = targetsForSelection(reader.blocks, range.start, range.end);
        what = `"${truncate(reader.text.slice(range.start, range.end), PREVIEW_CHARS)}"`;
        if (match.occurrences > 1) {
          what += ` (it appears ${match.occurrences} times; the first was removed)`;
        }
      } else {
        const headings = findHeadings(reader.body);
        const heading = headings[section! - 1];
        if (!heading) {
          throw new Error(
            `"${ref.title}" has ${plural(headings.length, "section")} of its own text, so §${section} isn't one (the user's highlights and note can't be removed here). Call read_source without section or part to see the outline.`,
          );
        }
        const next = headings.slice(section!).find((h) => h.level <= heading.level);
        const end = next ? next.offset : reader.body.length;
        targets = reader.blocks
          .filter((b) => b.start >= heading.offset && b.start < end)
          .map((b) => ({ start: b.start, end: b.end }));
        what = `the section "${heading.text}" (${(end - heading.offset).toLocaleString("en-US")} characters)`;
      }
      if (targets.length === 0) {
        throw new Error(
          "That text can't be cut here (it is in the reference list, or the source's text couldn't be mapped). Nothing was removed.",
        );
      }

      const result = removeFromBody(reader.body, targets);
      if (!result.ok) {
        throw new Error(
          /Edit as text/.test(result.message)
            ? "Part of that can't be cut exactly (it starts or ends inside a table, a quote, or a list item over several lines). Quote whole paragraphs or list items instead. Nothing was removed."
            : `${result.message} Nothing was removed.`,
        );
      }
      const next = result.markdown;
      if (sameBody(next, reader.body)) throw new Error("Nothing would change.");
      if (!next.trim()) {
        throw new Error(
          "That would remove all of the source's text. Delete the source instead (delete_sources) if that's what the user wants.",
        );
      }

      // Highlights that sat in the text and have nothing to sit on afterwards.
      const highlights = await ctx.api.get<Highlight[]>("/highlights", { query: { item: ref.id } });
      const before = { text: reader.text, images: renderedViewOf(reader.body).images };
      const after = renderedViewOf(next);
      const lost = (Array.isArray(highlights) ? highlights : []).filter((h) =>
        h.kind === "image"
          ? Boolean(h.image_src) &&
            before.images.has(h.image_src!) &&
            !after.images.has(h.image_src!)
          : locateHighlight(before.text, h) !== null && locateHighlight(after.text, h) === null,
      );

      await ctx.api.patch(`/items/${encodeURIComponent(ref.id)}`, { markdown: next });
      forgetCachedSource(ref.id);
      const failedDeletes: string[] = [];
      for (const h of lost) {
        try {
          await ctx.api.delete(`/highlights/${encodeURIComponent(h.id)}`);
        } catch {
          failedDeletes.push(h.id);
        }
      }
      const stack = undoStacks.get(ref.id) ?? [];
      stack.push({ before: reader.body, after: next, lost });
      undoStacks.set(ref.id, stack);

      const lines = [
        `Removed ${what} from "${ref.title}" [${ref.id}].`,
        `The text went from ${reader.body.length.toLocaleString("en-US")} to ${next.length.toLocaleString("en-US")} characters; Drive and the reader update by themselves.`,
      ];
      if (lost.length > 0) {
        lines.push(
          `${plural(lost.length, "highlight")} in that text went with it: ${lost
            .map((h) => `"${truncate(h.quote, 80)}"`)
            .join("; ")}.`,
        );
      }
      if (failedDeletes.length > 0) {
        lines.push(
          `Couldn't delete ${plural(failedDeletes.length, "highlight")} (${failedDeletes.join(", ")}); the reader will show them as not found.`,
        );
      }
      lines.push("undo_remove_text with this source_id puts it back.");
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "undo_remove_text",
    title: "Undo removing text",
    description:
      "Puts back the last text remove_text cut out of a source in this session, with the highlights that went with it. Call it again to undo the removal before that. Refuses when the source's text was changed some other way since.",
    input: {
      source_id: z.string().min(1).describe("The source remove_text changed."),
    },
    run: async ({ source_id }) => {
      const stack = undoStacks.get(source_id);
      const last = stack?.[stack.length - 1];
      if (!last) {
        throw new Error(
          "There is no removal to undo for this source (undo only covers removals made since Claude Desktop started Sourcefold).",
        );
      }
      const ref = await loadEditable(ctx, source_id, undefined);
      const current = readerTextOf(
        await ctx.api.text(`/items/${encodeURIComponent(ref.id)}/content`),
      ).body;
      if (!sameBody(current, last.after)) {
        throw new Error(
          `The text of "${ref.title}" changed since that removal (in the app or by another removal), so it wasn't put back.`,
        );
      }

      await ctx.api.patch(`/items/${encodeURIComponent(ref.id)}`, { markdown: last.before });
      stack!.pop();
      forgetCachedSource(ref.id);
      let restored = 0;
      for (const h of last.lost) {
        try {
          await ctx.api.put(`/highlights/${encodeURIComponent(h.id)}`, toInput(h));
          restored++;
        } catch {
          // The text is back; a highlight that can't be saved is reported below.
        }
      }
      const lines = [`Put the removed text back in "${ref.title}" [${ref.id}].`];
      if (last.lost.length > 0) {
        lines.push(
          restored === last.lost.length
            ? `Restored ${plural(restored, "highlight")} too.`
            : `Restored ${restored} of ${plural(last.lost.length, "highlight")}; the user can highlight the others again.`,
        );
      }
      return lines.join("\n");
    },
  });
}
