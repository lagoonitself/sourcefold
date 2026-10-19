import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AUTHOR_TYPES,
  CARD_LIMITS,
  DUPLICATE_REASON_LABELS,
  RESEARCH_LIMITS,
  SECTION_TITLE_MAX,
  TRIAGE_LABELS,
  buildBrollList,
  buildReferenceList,
  buildScript,
  cardProblem,
  findDuplicateSets,
  formatClipTime,
  isAuthorType,
  isTriage,
  normalizeTags,
  orderBrollClips,
  parseClipTime,
  positionBetween,
  sameTag,
  scriptSourceFromItem,
  sortCards,
  sortSections,
  type Card,
  type CardInput,
  type DuplicateSet,
  type OutlineSection,
  type OutlineSectionInput,
  type ScriptInput,
  type ScriptSource,
} from "@sourcefold/core";
import { z } from "zod";
import { findQuote, readerTextOf } from "../reader-text";
import type { Folder, Item } from "../types";
import { defineTool, type ToolContext } from "./define";
import { formatDate, formatSeconds, plural, truncate } from "./format";
import {
  PROJECT_GUARD_DESCRIPTION,
  loadFolderIndex,
  requireInProject,
  resolveProject,
} from "./library-data";
import { forgetCachedSource } from "./read";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_section"),
    title: z.string().min(1).max(SECTION_TITLE_MAX).describe("Title of the section."),
    after: z.string().optional().describe("Section name or id to place after."),
  }),
  z.object({
    action: z.literal("rename_section"),
    section: z.string().min(1).describe("Section name or id to rename."),
    title: z.string().min(1).max(SECTION_TITLE_MAX).describe("New title of the section."),
  }),
  z.object({
    action: z.literal("delete_section"),
    section: z.string().min(1).describe("Section name or id to delete."),
  }),
  z.object({
    action: z.literal("move_section"),
    section: z.string().min(1).describe("Section name or id to move."),
    after: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Section name or id to place after. Pass null to place at the very start of the outline.",
      ),
  }),
  z.object({
    action: z.literal("place_card"),
    card_id: z.string().describe("Id of the card to place."),
    section: z.string().min(1).describe("Section name or id to place in."),
    after_card_id: z
      .string()
      .nullable()
      .optional()
      .describe("Card id to place after. Pass null to place at the very start of the section."),
  }),
  z.object({
    action: z.literal("unplace_card"),
    card_id: z.string().describe("Id of the card to move back to the unplaced pile."),
  }),
  z.object({
    action: z.literal("set_line"),
    card_id: z.string().describe("Id of the card."),
    text: z.string().describe("Script line text to set (empty string to clear)."),
  }),
  z.object({
    action: z.literal("add_line"),
    section: z.string().min(1).describe("Section name or id to add line in."),
    text: z.string().min(1).describe("Narration or transition line text."),
    after_card_id: z
      .string()
      .nullable()
      .optional()
      .describe("Card id to place after. Pass null to place at the very start of the section."),
  }),
  z.object({
    action: z.literal("delete_card"),
    card_id: z.string().describe("Id of the card to delete."),
  }),
]);

export function registerResearchTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "set_source_info",
    title: "Update research info on sources",
    description:
      "Updates research info on one or more sources (1–50): triage status (keep, maybe, cut, or 'none' to clear), add_tags, remove_tags, tags (explicit list), author, author_type (lab, researcher, journalist, company, government, creator, forum, encyclopedia, other), and summary (pass '' to clear). A summary or author on several sources at once is refused. Replies with each source's new status and tags.",
    input: {
      source_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(50)
        .optional()
        .describe("Source ids to update (1–50). Either source_ids or source_id is required."),
      source_id: z.string().min(1).optional().describe("Single source id to update."),
      status: z
        .enum(["keep", "maybe", "cut", "none"])
        .optional()
        .describe("Research triage status, or 'none' to clear status."),
      add_tags: z.array(z.string().min(1)).optional().describe("Tags to add to the sources."),
      remove_tags: z
        .array(z.string().min(1))
        .optional()
        .describe("Tags to remove from the sources."),
      tags: z
        .array(z.string().min(1))
        .max(RESEARCH_LIMITS.tags)
        .optional()
        .describe("Explicit full list of tags (replaces existing tags)."),
      author: z
        .string()
        .max(RESEARCH_LIMITS.author)
        .optional()
        .describe(
          "Author or creator name (empty string to clear). Only allowed for single source.",
        ),
      author_type: z
        .enum(AUTHOR_TYPES)
        .optional()
        .describe(
          "Author type: lab, researcher, journalist, company, government, creator, forum, encyclopedia, other.",
        ),
      summary: z
        .string()
        .max(RESEARCH_LIMITS.summary)
        .optional()
        .describe(
          "Short summary of the source (empty string to clear). Only allowed for single source.",
        ),
      project: z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION),
    },
    run: async (args, { api }) => {
      const {
        source_ids,
        source_id,
        status,
        add_tags,
        remove_tags,
        tags,
        author,
        author_type,
        summary,
        project,
      } = args;

      const ids = source_ids ?? (source_id ? [source_id] : []);
      if (ids.length === 0) {
        throw new Error("Provide either source_ids or source_id.");
      }
      if (ids.length > 50) {
        throw new Error("At most 50 sources can be updated at once.");
      }
      if (ids.length > 1 && (summary !== undefined || author !== undefined)) {
        throw new Error("A summary or author on several sources at once is refused.");
      }

      const index = await loadFolderIndex(api);
      const targetProject = project ? resolveProject(index, project) : null;

      const results: string[] = [];

      for (const id of ids) {
        const item = await api.get<Item>(`/items/${encodeURIComponent(id)}`);
        requireInProject(index, targetProject, item.folder_id, `"${item.title}"`);

        const patch: Record<string, unknown> = {};

        if (status !== undefined) {
          if (status === "none") {
            patch.triage = null;
          } else if (isTriage(status)) {
            patch.triage = status;
          }
        }

        if (tags !== undefined) {
          patch.tags = normalizeTags(tags);
        } else if (add_tags !== undefined || remove_tags !== undefined) {
          let current = item.tags ? [...item.tags] : [];
          if (remove_tags && remove_tags.length > 0) {
            current = current.filter((t) => !remove_tags.some((r) => sameTag(t, r)));
          }
          if (add_tags && add_tags.length > 0) {
            current.push(...add_tags);
          }
          const cleaned = normalizeTags(current);
          if (cleaned.length > RESEARCH_LIMITS.tags) {
            throw new Error(`A source can have at most ${RESEARCH_LIMITS.tags} tags.`);
          }
          patch.tags = cleaned;
        }

        if (author !== undefined) {
          const a = author.trim();
          patch.author = a.length > 0 ? a : null;
        }

        if (author_type !== undefined) {
          if (isAuthorType(author_type)) {
            patch.author_type = author_type;
          }
        }

        if (summary !== undefined) {
          const s = summary.trim();
          patch.summary = s.length > 0 ? s : null;
        }

        if (Object.keys(patch).length > 0) {
          const updated = await api.patch<Item>(`/items/${encodeURIComponent(id)}`, patch);
          forgetCachedSource(id);
          const currentTriage = (updated.triage ?? patch.triage) as string | null | undefined;
          const statusText = currentTriage
            ? (TRIAGE_LABELS[currentTriage as keyof typeof TRIAGE_LABELS] ?? currentTriage)
            : "none";
          const currentTags = (updated.tags ?? patch.tags ?? []) as string[];
          const tagsText = currentTags.length > 0 ? currentTags.join(", ") : "(none)";
          results.push(
            `- "${updated.title || item.title}" [${id}]: status: ${statusText}, tags: ${tagsText}`,
          );
        } else {
          const statusText = item.triage ? (TRIAGE_LABELS[item.triage] ?? item.triage) : "none";
          const tagsText = item.tags && item.tags.length > 0 ? item.tags.join(", ") : "(none)";
          results.push(
            `- "${item.title}" [${id}]: status: ${statusText}, tags: ${tagsText} (no change)`,
          );
        }
      }

      return `Updated ${plural(ids.length, "source")}:\n${results.join("\n")}`;
    },
  });

  defineTool(server, ctx, {
    name: "list_tags",
    title: "List tags and outline sections in a project",
    description:
      "Lists the outline sections and other tags used across sources in a project, with the count of sources tagged with each. Outline sections appear first in outline order.",
    input: {
      project: z.string().min(1).describe("The project name or id."),
    },
    readOnly: true,
    run: async ({ project }, { api }) => {
      const index = await loadFolderIndex(api);
      const proj = resolveProject(index, project);

      const [sections, items] = await Promise.all([
        api.get<OutlineSection[]>("/outline-sections", { query: { project: proj.id } }),
        api.get<Item[]>("/items", { query: { project: proj.id } }),
      ]);

      const sortedSections = sortSections(sections);
      const sectionTagNames = new Set(sortedSections.map((s) => s.title.toLowerCase()));

      const tagCounts = new Map<string, { display: string; count: number }>();
      for (const item of items) {
        if (Array.isArray(item.tags)) {
          for (const rawTag of item.tags) {
            const key = rawTag.trim().toLowerCase();
            if (!key) continue;
            const existing = tagCounts.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              tagCounts.set(key, { display: rawTag.trim(), count: 1 });
            }
          }
        }
      }

      const lines: string[] = [`Project "${proj.name}" tags:`];

      if (sortedSections.length > 0) {
        lines.push("", "Outline sections:");
        for (const sec of sortedSections) {
          const key = sec.title.toLowerCase();
          const count = tagCounts.get(key)?.count ?? 0;
          lines.push(`- § ${sec.title} · ${plural(count, "source")}`);
        }
      }

      const otherTags = Array.from(tagCounts.entries())
        .filter(([key]) => !sectionTagNames.has(key))
        .sort((a, b) => b[1].count - a[1].count || a[1].display.localeCompare(b[1].display));

      if (otherTags.length > 0) {
        lines.push("", "Other tags:");
        for (const [, { display, count }] of otherTags) {
          lines.push(`- ${display} · ${plural(count, "source")}`);
        }
      }

      if (sortedSections.length === 0 && otherTags.length === 0) {
        lines.push("No outline sections or tags found in this project.");
      }

      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "find_duplicates",
    title: "Find duplicate sources in a project",
    description:
      "Finds duplicate sources in a project using findDuplicateSets: each set with reason, ids, titles, group paths, and saved dates.",
    input: {
      project: z.string().min(1).describe("The project name or id."),
    },
    readOnly: true,
    run: async ({ project }, { api }) => {
      const index = await loadFolderIndex(api);
      const proj = resolveProject(index, project);

      const items = await api.get<Item[]>("/items", { query: { project: proj.id } });
      const duplicateSets = findDuplicateSets(items);
      if (duplicateSets.length === 0) {
        return `No duplicate sources found in "${proj.name}".`;
      }

      const itemById = new Map(items.map((it) => [it.id, it]));
      const lines = [`Found ${plural(duplicateSets.length, "duplicate group")} in "${proj.name}":`];
      duplicateSets.forEach((set: DuplicateSet, indexNum: number) => {
        const label = DUPLICATE_REASON_LABELS[set.reason] ?? set.reason;
        lines.push("", `Duplicate group ${indexNum + 1} (${label}):`);
        for (const id of set.item_ids) {
          const item = itemById.get(id);
          const where = item ? index.pathOf(item.folder_id) : "";
          const date = item?.created_at ? formatDate(item.created_at) : "";
          const parts = [
            `[${id}]`,
            item?.title || "(untitled)",
            where ? `in ${where}` : null,
            date || null,
          ].filter(Boolean);
          lines.push(`- ${parts.join(" · ")}`);
        }
      });
      lines.push("", "Use merge_duplicates to combine duplicates and move their highlights.");
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "merge_duplicates",
    title: "Merge duplicate sources",
    description:
      "Merges one or more duplicate sources into keep_id, re-attaching their highlights and cards, and deletes the duplicates.",
    input: {
      keep_id: z.string().describe("The source id to keep."),
      ids: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .optional()
        .describe("The duplicate source ids to merge into keep_id and delete."),
      duplicate_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .optional()
        .describe("Alias for ids."),
      project: z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION),
    },
    run: async ({ keep_id, ids, duplicate_ids, project }, { api }) => {
      const mergeIds = ids ?? duplicate_ids ?? [];
      if (mergeIds.length === 0) {
        throw new Error("Provide ids of duplicate sources to merge into keep_id.");
      }

      const index = await loadFolderIndex(api);
      const targetProject = project ? resolveProject(index, project) : null;

      const keepItem = await api.get<Item>(`/items/${encodeURIComponent(keep_id)}`);
      requireInProject(index, targetProject, keepItem.folder_id, `"${keepItem.title}"`);

      for (const dupId of mergeIds) {
        const dupItem = await api.get<Item>(`/items/${encodeURIComponent(dupId)}`);
        requireInProject(index, targetProject, dupItem.folder_id, `"${dupItem.title}"`);
      }

      const res = await api.post<{
        merged?: number;
        moved_highlights: number;
        moved_cards: number;
      }>(`/items/${encodeURIComponent(keep_id)}/merge`, {
        ids: mergeIds,
      });

      forgetCachedSource(keep_id);
      for (const dupId of mergeIds) {
        forgetCachedSource(dupId);
      }

      const movedParts: string[] = [];
      if (res.moved_highlights) movedParts.push(`${plural(res.moved_highlights, "highlight")}`);
      if (res.moved_cards) movedParts.push(`${plural(res.moved_cards, "card")}`);
      const movedNotice = movedParts.length > 0 ? ` (moved ${movedParts.join(" and ")})` : "";

      return `Merged ${plural(mergeIds.length, "duplicate")} into "${keepItem.title}" [${keepItem.id}]${movedNotice}.`;
    },
  });

  defineTool(server, ctx, {
    name: "make_card",
    title: "Create a quote card for research outline",
    description:
      "Creates a quote card from an existing highlight_id OR from (source_id and quote). The quote must appear in the source's reader text. Places it into an outline section (or unplaced card pile).",
    input: {
      highlight_id: z
        .string()
        .optional()
        .describe("Id of an existing highlight to make into a card."),
      source_id: z.string().optional().describe("Source id (when making from source and quote)."),
      quote: z.string().optional().describe("Exact quote from the source."),
      seconds: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Start time in seconds for video quote."),
      note: z.string().optional().describe("Note or takeaway on this quote."),
      section: z.string().optional().describe("Outline section (tag) to place this card in."),
      project: z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION),
    },
    run: async (args, { api }) => {
      const { highlight_id, source_id, quote, seconds, note, section, project } = args;

      if (!highlight_id && (!source_id || !quote)) {
        throw new Error("Provide either highlight_id or (source_id and quote).");
      }
      if (highlight_id && (source_id || quote)) {
        throw new Error("Provide either highlight_id or (source_id and quote), not both.");
      }

      const index = await loadFolderIndex(api);
      const targetProject = project ? resolveProject(index, project) : null;

      let itemId: string;
      let cardQuote: string;
      let cardSeconds: number | null = seconds ?? null;
      let cardNote: string | null = note ? note.trim() : null;
      let itemTitle: string;
      let proj: Folder | null;

      if (highlight_id) {
        const h = await api.get<{
          id: string;
          item_id: string;
          quote: string;
          seconds: number | null;
          note?: string | null;
        }>(`/highlights/${encodeURIComponent(highlight_id)}`);
        const item = await api.get<Item>(`/items/${encodeURIComponent(h.item_id)}`);
        requireInProject(index, targetProject, item.folder_id, `"${item.title}"`);
        proj = index.projectOf(item.folder_id);
        itemId = item.id;
        cardQuote = h.quote;
        if (cardSeconds === null && h.seconds !== null) cardSeconds = h.seconds;
        if (!cardNote && h.note) cardNote = h.note;
        itemTitle = item.title;
      } else {
        const item = await api.get<Item>(`/items/${encodeURIComponent(source_id!)}`);
        requireInProject(index, targetProject, item.folder_id, `"${item.title}"`);
        proj = index.projectOf(item.folder_id);
        const file = await api.text(`/items/${encodeURIComponent(item.id)}/content`);
        const reader = readerTextOf(file);
        const match = findQuote(reader.text, quote!, reader.footnoteMarkers);
        if (!match) {
          throw new Error(
            `That quote isn't in "${item.title}". Copy the exact words from read_source.`,
          );
        }
        itemId = item.id;
        cardQuote = quote!.trim();
        itemTitle = item.title;
      }

      if (!proj) throw new Error("Could not determine project for this source.");

      const sections = await api.get<OutlineSection[]>("/outline-sections", {
        query: { project: proj.id },
      });
      let sectionId: string | null = null;
      let sectionTitle: string | null = null;
      if (section) {
        const matched = sections.find((s) => s.id === section || sameTag(s.title, section));
        if (!matched) {
          throw new Error(`No section "${section}" in project "${proj.name}".`);
        }
        sectionId = matched.id;
        sectionTitle = matched.title;
      }

      const cards = await api.get<Card[]>("/cards", {
        query: { project: proj.id },
      });
      const inPlace = sortCards(cards.filter((c) => c.section_id === sectionId));
      const last = inPlace[inPlace.length - 1];
      const position = positionBetween(last?.position ?? null, null);

      const cardId = randomUUID();
      const input: CardInput = {
        id: cardId,
        project_id: proj.id,
        kind: "quote",
        item_id: itemId,
        highlight_id: highlight_id ?? null,
        quote: cardQuote,
        seconds: cardSeconds,
        end_seconds: null,
        url: null,
        note: cardNote,
        script_line: null,
        section_id: sectionId,
        position,
      };

      const problem = cardProblem(input);
      if (problem) throw new Error(problem);

      const created = await api.put<Card>(`/cards/${encodeURIComponent(cardId)}`, input);

      const placement = sectionTitle
        ? `placed in section "${sectionTitle}"`
        : "added to unplaced card pile";
      const quoteSnippet = truncate(created.quote, 80);
      return `Created quote card [${created.id}] from "${itemTitle}" (${placement}):\n“${quoteSnippet}”`;
    },
  });

  defineTool(server, ctx, {
    name: "add_broll",
    title: "Add a b-roll clip to research outline",
    description:
      "Adds a b-roll clip (video segment) to a project's research outline. Provide source_id (from a video in library) or url (direct video link), with start and optional end times (e.g. '1:05', '01:02:05', '65', or '1m5s').",
    input: {
      source_id: z.string().optional().describe("Video source id from the library."),
      url: z.string().url().optional().describe("Direct video link (e.g. YouTube)."),
      start: z.string().min(1).describe("Clip start time (e.g. '1:12' or '72s')."),
      end: z.string().optional().describe("Clip end time (e.g. '1:25')."),
      description: z.string().optional().describe("What the clip shows (its script line)."),
      note: z.string().optional().describe("Note or why to use this clip."),
      section: z.string().optional().describe("Outline section (tag) to place this clip in."),
      project: z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION),
    },
    run: async (args, { api }) => {
      const { source_id, url, start, end, description, note, section, project } = args;

      if (!source_id && !url) {
        throw new Error("Provide either source_id or url for the b-roll clip.");
      }

      const startSeconds = parseClipTime(start);
      if (startSeconds === null) {
        throw new Error(`Could not parse start time "${start}". Use e.g. "1:05" or "65s".`);
      }

      let endSeconds: number | null = null;
      if (end) {
        endSeconds = parseClipTime(end);
        if (endSeconds === null) {
          throw new Error(`Could not parse end time "${end}". Use e.g. "1:25" or "85s".`);
        }
        if (endSeconds <= startSeconds) {
          throw new Error("End time must be after start time.");
        }
      }

      const index = await loadFolderIndex(api);
      const targetProject = project ? resolveProject(index, project) : null;

      let proj: Folder | null = null;
      let itemId: string | null = null;
      let clipTitle = "b-roll";

      if (source_id) {
        const item = await api.get<Item>(`/items/${encodeURIComponent(source_id)}`);
        requireInProject(index, targetProject, item.folder_id, `"${item.title}"`);
        proj = index.projectOf(item.folder_id);
        itemId = item.id;
        clipTitle = item.title;
      } else if (targetProject) {
        proj = targetProject;
      } else {
        throw new Error("Specify project when adding b-roll by URL.");
      }

      if (!proj) throw new Error("Could not determine project for this b-roll clip.");

      const sections = await api.get<OutlineSection[]>("/outline-sections", {
        query: { project: proj.id },
      });
      let sectionId: string | null = null;
      let sectionTitle: string | null = null;
      if (section) {
        const matched = sections.find((s) => s.id === section || sameTag(s.title, section));
        if (!matched) {
          throw new Error(`No section "${section}" in project "${proj.name}".`);
        }
        sectionId = matched.id;
        sectionTitle = matched.title;
      }

      const cards = await api.get<Card[]>("/cards", {
        query: { project: proj.id },
      });
      const inPlace = sortCards(cards.filter((c) => c.section_id === sectionId));
      const last = inPlace[inPlace.length - 1];
      const position = positionBetween(last?.position ?? null, null);

      const cardId = randomUUID();
      const input: CardInput = {
        id: cardId,
        project_id: proj.id,
        kind: "broll",
        item_id: itemId,
        highlight_id: null,
        quote: "",
        seconds: startSeconds,
        end_seconds: endSeconds,
        url: url ?? null,
        note: note ? note.trim() : null,
        script_line: description ? description.trim() : null,
        section_id: sectionId,
        position,
      };

      const problem = cardProblem(input);
      if (problem) throw new Error(problem);

      const created = await api.put<Card>(`/cards/${encodeURIComponent(cardId)}`, input);

      const timeRange =
        formatClipTime(created.seconds, created.end_seconds) ?? formatSeconds(startSeconds);
      const placement = sectionTitle
        ? `placed in section "${sectionTitle}"`
        : "added to unplaced card pile";
      return `Added b-roll clip [${created.id}] from "${clipTitle}" at ${timeRange} (${placement}).`;
    },
  });

  defineTool(server, ctx, {
    name: "list_cards",
    title: "List research cards in a project",
    description:
      "Lists the cards in a project outline (quotes, b-roll clips, lines) grouped by outline section and unplaced cards.",
    input: {
      project: z.string().min(1).describe("The project name or id."),
      section: z.string().optional().describe("Filter by section name or id."),
      unplaced_only: z.boolean().default(false).describe("Only show unplaced cards."),
      kind: z.enum(["quote", "broll", "line"]).optional().describe("Filter by card kind."),
    },
    readOnly: true,
    run: async ({ project, section, unplaced_only, kind }, { api }) => {
      const index = await loadFolderIndex(api);
      const proj = resolveProject(index, project);

      const [sections, cards, items] = await Promise.all([
        api.get<OutlineSection[]>("/outline-sections", { query: { project: proj.id } }),
        api.get<Card[]>("/cards", { query: { project: proj.id } }),
        api.get<Item[]>("/items", { query: { project: proj.id } }),
      ]);

      const itemMap = new Map(items.map((i) => [i.id, i]));
      const sortedSections = sortSections(sections);

      let filteredCards = cards;
      if (kind) {
        filteredCards = filteredCards.filter((c) => c.kind === kind);
      }
      if (unplaced_only) {
        filteredCards = filteredCards.filter((c) => c.section_id === null);
      } else if (section) {
        const target = sections.find((s) => s.id === section || sameTag(s.title, section));
        if (!target) throw new Error(`No section "${section}" in project "${proj.name}".`);
        filteredCards = filteredCards.filter((c) => c.section_id === target.id);
      }

      if (filteredCards.length === 0) {
        return `No cards match the filter in "${proj.name}".`;
      }

      const lines: string[] = [`Cards in "${proj.name}" (${filteredCards.length}):`];

      const renderCard = (c: Card): string => {
        const item = c.item_id ? itemMap.get(c.item_id) : null;
        const sourceName = item ? item.title : c.url ? c.url : "(no source)";
        const time = formatClipTime(c.seconds, c.end_seconds);
        const parts: string[] = [`[${c.id}] ${c.kind}`];
        if (time) parts.push(`at ${time}`);
        parts.push(`from ${sourceName}`);
        let line = parts.join(" · ");
        if (c.quote) {
          line += `\n    “${truncate(c.quote, 120)}”`;
        }
        if (c.script_line) {
          line += `\n    Script: ${truncate(c.script_line, 120)}`;
        }
        if (c.note) {
          line += `\n    Note: ${truncate(c.note, 120)}`;
        }
        return line;
      };

      if (!unplaced_only && !section) {
        for (const sec of sortedSections) {
          const inSec = sortCards(filteredCards.filter((c) => c.section_id === sec.id));
          if (inSec.length === 0) continue;
          lines.push("", `Section § ${sec.title} (${plural(inSec.length, "card")}):`);
          for (const card of inSec) {
            lines.push(`  ${renderCard(card)}`);
          }
        }
      }

      const unplaced = sortCards(filteredCards.filter((c) => c.section_id === null));
      if (unplaced.length > 0 && !section) {
        lines.push("", `Unplaced cards (${plural(unplaced.length, "card")}):`);
        for (const card of unplaced) {
          lines.push(`  ${renderCard(card)}`);
        }
      } else if (section) {
        for (const card of sortCards(filteredCards)) {
          lines.push(`  ${renderCard(card)}`);
        }
      }

      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "edit_outline",
    title: "Edit research outline sections and card placements",
    description:
      "Performs one or more outline mutations in order: add_section, rename_section, delete_section, move_section, place_card, unplace_card, set_line, add_line, delete_card. Stops on first failure and reports progress.",
    input: {
      project: z.string().min(1).describe("The project name or id."),
      actions: z.array(actionSchema).min(1).describe("Ordered array of outline actions to apply."),
    },
    run: async ({ project, actions }, { api }) => {
      const index = await loadFolderIndex(api);
      const proj = resolveProject(index, project);

      let [sections, cards] = await Promise.all([
        api.get<OutlineSection[]>("/outline-sections", {
          query: { project: proj.id },
        }),
        api.get<Card[]>("/cards", {
          query: { project: proj.id },
        }),
      ]);

      const findSection = (nameOrId: string): OutlineSection | undefined =>
        sections.find((s) => s.id === nameOrId || sameTag(s.title, nameOrId));

      const findCard = (id: string): Card | undefined => cards.find((c) => c.id === id);

      const completed: string[] = [];

      try {
        for (let i = 0; i < actions.length; i++) {
          const a = actions[i]!;
          switch (a.action) {
            case "add_section": {
              const sorted = sortSections(sections);
              let position: number;
              if (a.after) {
                const target = findSection(a.after);
                if (!target) throw new Error(`No section "${a.after}" to place after.`);
                const targetIdx = sorted.findIndex((s) => s.id === target.id);
                position = positionBetween(
                  sorted[targetIdx]?.position ?? null,
                  sorted[targetIdx + 1]?.position ?? null,
                );
              } else {
                const last = sorted[sorted.length - 1];
                position = positionBetween(last?.position ?? null, null);
              }
              const newId = randomUUID();
              const input: OutlineSectionInput = {
                id: newId,
                project_id: proj.id,
                title: a.title.trim(),
                position,
              };
              const created = await api.put<OutlineSection>(
                `/outline-sections/${encodeURIComponent(newId)}`,
                input,
              );
              sections = [...sections, created];
              completed.push(`${i + 1}. Added section "${created.title}" [${created.id}]`);
              break;
            }
            case "rename_section": {
              const target = findSection(a.section);
              if (!target) throw new Error(`No section "${a.section}" to rename.`);
              const updated = await api.put<OutlineSection>(
                `/outline-sections/${encodeURIComponent(target.id)}`,
                {
                  id: target.id,
                  project_id: proj.id,
                  title: a.title.trim(),
                  position: target.position,
                },
              );
              sections = sections.map((s) => (s.id === updated.id ? updated : s));
              completed.push(`${i + 1}. Renamed section "${target.title}" to "${updated.title}"`);
              break;
            }
            case "delete_section": {
              const target = findSection(a.section);
              if (!target) throw new Error(`No section "${a.section}" to delete.`);
              await api.delete(`/outline-sections/${encodeURIComponent(target.id)}`);
              sections = sections.filter((s) => s.id !== target.id);
              cards = cards.map((c) =>
                c.section_id === target.id ? { ...c, section_id: null } : c,
              );
              completed.push(`${i + 1}. Deleted section "${target.title}"`);
              break;
            }
            case "move_section": {
              const target = findSection(a.section);
              if (!target) throw new Error(`No section "${a.section}" to move.`);
              const remaining = sortSections(sections.filter((s) => s.id !== target.id));
              let position: number;
              if (a.after === null) {
                position = positionBetween(null, remaining[0]?.position ?? null);
              } else if (a.after) {
                const afterSec = remaining.find(
                  (s) => s.id === a.after || sameTag(s.title, a.after!),
                );
                if (!afterSec) throw new Error(`No section "${a.after}" to move after.`);
                const idx = remaining.findIndex((s) => s.id === afterSec.id);
                position = positionBetween(
                  remaining[idx]?.position ?? null,
                  remaining[idx + 1]?.position ?? null,
                );
              } else {
                position = positionBetween(remaining[remaining.length - 1]?.position ?? null, null);
              }
              const moved = await api.put<OutlineSection>(
                `/outline-sections/${encodeURIComponent(target.id)}`,
                {
                  id: target.id,
                  project_id: proj.id,
                  title: target.title,
                  position,
                },
              );
              sections = sections.map((s) => (s.id === moved.id ? moved : s));
              completed.push(`${i + 1}. Moved section "${target.title}"`);
              break;
            }
            case "place_card": {
              const card = findCard(a.card_id);
              if (!card) throw new Error(`No card with id "${a.card_id}".`);
              const sec = findSection(a.section);
              if (!sec) throw new Error(`No section "${a.section}" to place card in.`);
              const secCards = sortCards(
                cards.filter((c) => c.section_id === sec.id && c.id !== card.id),
              );
              let position: number;
              if (a.after_card_id === null) {
                position = positionBetween(null, secCards[0]?.position ?? null);
              } else if (a.after_card_id) {
                const idx = secCards.findIndex((c) => c.id === a.after_card_id);
                if (idx < 0) {
                  throw new Error(`No card "${a.after_card_id}" in section to place after.`);
                }
                position = positionBetween(
                  secCards[idx]?.position ?? null,
                  secCards[idx + 1]?.position ?? null,
                );
              } else {
                position = positionBetween(secCards[secCards.length - 1]?.position ?? null, null);
              }
              const placed = await api.patch<Card>(`/cards/${encodeURIComponent(card.id)}`, {
                section_id: sec.id,
                position,
              });
              cards = cards.map((c) => (c.id === placed.id ? placed : c));
              completed.push(`${i + 1}. Placed card [${card.id}] in section "${sec.title}"`);
              break;
            }
            case "unplace_card": {
              const card = findCard(a.card_id);
              if (!card) throw new Error(`No card with id "${a.card_id}".`);
              const pile = sortCards(
                cards.filter((c) => c.section_id === null && c.id !== card.id),
              );
              const position = positionBetween(pile[pile.length - 1]?.position ?? null, null);
              const unplaced = await api.patch<Card>(`/cards/${encodeURIComponent(card.id)}`, {
                section_id: null,
                position,
              });
              cards = cards.map((c) => (c.id === unplaced.id ? unplaced : c));
              completed.push(`${i + 1}. Moved card [${card.id}] to unplaced card pile`);
              break;
            }
            case "set_line": {
              const card = findCard(a.card_id);
              if (!card) throw new Error(`No card with id "${a.card_id}".`);
              const scriptLine = a.text.trim() || null;
              const updated = await api.patch<Card>(`/cards/${encodeURIComponent(card.id)}`, {
                script_line: scriptLine,
              });
              cards = cards.map((c) => (c.id === updated.id ? updated : c));
              completed.push(`${i + 1}. Updated script line on card [${card.id}]`);
              break;
            }
            case "add_line": {
              const sec = findSection(a.section);
              if (!sec) throw new Error(`No section "${a.section}" to add line in.`);
              const secCards = sortCards(cards.filter((c) => c.section_id === sec.id));
              let position: number;
              if (a.after_card_id === null) {
                position = positionBetween(null, secCards[0]?.position ?? null);
              } else if (a.after_card_id) {
                const idx = secCards.findIndex((c) => c.id === a.after_card_id);
                if (idx < 0) {
                  throw new Error(`No card "${a.after_card_id}" in section to place after.`);
                }
                position = positionBetween(
                  secCards[idx]?.position ?? null,
                  secCards[idx + 1]?.position ?? null,
                );
              } else {
                position = positionBetween(secCards[secCards.length - 1]?.position ?? null, null);
              }
              const lineId = randomUUID();
              const input: CardInput = {
                id: lineId,
                project_id: proj.id,
                kind: "line",
                item_id: null,
                highlight_id: null,
                quote: "",
                seconds: null,
                end_seconds: null,
                url: null,
                note: null,
                script_line: a.text.trim(),
                section_id: sec.id,
                position,
              };
              const created = await api.put<Card>(`/cards/${encodeURIComponent(lineId)}`, input);
              cards = [...cards, created];
              completed.push(`${i + 1}. Added line card [${created.id}] in section "${sec.title}"`);
              break;
            }
            case "delete_card": {
              const card = findCard(a.card_id);
              if (!card) throw new Error(`No card with id "${a.card_id}".`);
              await api.delete(`/cards/${encodeURIComponent(card.id)}`);
              cards = cards.filter((c) => c.id !== card.id);
              completed.push(`${i + 1}. Deleted card [${card.id}]`);
              break;
            }
          }
        }
        return `Successfully completed ${completed.length} actions:\n${completed.join("\n")}`;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return [
          `Failed during action ${completed.length + 1} of ${actions.length}: ${errorMsg}`,
          "",
          completed.length > 0
            ? `Completed before failure:\n${completed.join("\n")}`
            : "No actions were applied before failure.",
        ].join("\n");
      }
    },
  });

  defineTool(server, ctx, {
    name: "get_script",
    title: "Export outline script, reference list or b-roll list",
    description:
      "Exports the project's research outline as a narration script with citations, a reference list of cited sources, keep_references (all sources marked keep), or a chronological b-roll clip list.",
    input: {
      project: z.string().min(1).describe("The project name or id."),
      format: z
        .enum(["script", "references", "keep_references", "broll"])
        .default("script")
        .describe("Export format: script, references, keep_references, or broll."),
    },
    readOnly: true,
    run: async ({ project, format }, { api }) => {
      const index = await loadFolderIndex(api);
      const proj = resolveProject(index, project);

      const [sections, cards, items] = await Promise.all([
        api.get<OutlineSection[]>("/outline-sections", { query: { project: proj.id } }),
        api.get<Card[]>("/cards", { query: { project: proj.id } }),
        api.get<Item[]>("/items", { query: { project: proj.id } }),
      ]);

      const sources: Record<string, ScriptSource> = {};
      for (const item of items) {
        sources[item.id] = scriptSourceFromItem(item);
      }

      if (format === "script") {
        const scriptInput: ScriptInput = {
          projectTitle: proj.name,
          sections,
          cards,
          sources,
        };
        const built = buildScript(scriptInput);
        return built.markdown;
      }

      if (format === "references") {
        const scriptInput: ScriptInput = {
          projectTitle: proj.name,
          sections,
          cards,
          sources,
        };
        const built = buildScript(scriptInput);
        const citedSources = built.references.map((r) => r.source);
        if (citedSources.length === 0) {
          return `No sources are cited in the script for "${proj.name}".`;
        }
        return buildReferenceList(citedSources);
      }

      if (format === "keep_references") {
        const keepItems = items.filter((i) => i.triage === "keep");
        if (keepItems.length === 0) {
          return `No sources in "${proj.name}" are marked keep.`;
        }
        const keepSources = keepItems.map((item) => scriptSourceFromItem(item));
        return buildReferenceList(keepSources);
      }

      if (format === "broll") {
        const orderedClips = orderBrollClips(cards, sections);
        if (orderedClips.length === 0) {
          return `No b-roll clips found in "${proj.name}".`;
        }
        return buildBrollList(proj.name, orderedClips, sources);
      }

      throw new Error(`Unknown format: ${format}`);
    },
  });
}
