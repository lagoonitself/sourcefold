import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sameTag } from "@sourcefold/core";
import { z } from "zod";
import { NOT_SIGNED_IN_MESSAGE } from "../config";
import { DesktopClosedError } from "../desktop-bridge";
import type { Item } from "../types";
import { defineTool, type ToolContext } from "./define";
import {
  formatDate,
  formatSeconds,
  kindLabel,
  messageOf,
  plural,
  snippetToMarkdown,
  sourceLine,
  truncate,
} from "./format";
import {
  isArchived,
  loadFolderIndex,
  loadFolderItems,
  mapLimit,
  requireFolder,
  sourcesIn,
} from "./library-data";

/** More sources than this in a project tree: urls are dropped to keep the reply small. */
export const TREE_URL_LIMIT = 300;
const TREE_CONCURRENCY = 6;
const MAX_TITLE_MATCHES = 40;
export const LIST_PAGE_SIZE = 100;

function urlOf(item: Item): string | null {
  return item.source_url || item.canonical_url || null;
}

/** `[id] kind · title · byline · date`, then the url when `withUrl`. */
function treeSourceLine(item: Item, withUrl: boolean): string {
  const url = withUrl ? urlOf(item) : null;
  return url ? `${sourceLine(item)} · ${url}` : sourceLine(item);
}

export function registerLibraryTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "get_status",
    title: "Sourcefold status",
    description:
      "Shows who Sourcefold is signed in as on this computer, whether the Sourcefold desktop app is open (and its mode), and the Google Drive state (connected, how many changes are not saved yet). Use it first when something fails, or to check which features are available: searching inside sources and show_in_app need the desktop app to be open.",
    input: {},
    readOnly: true,
    idempotent: true,
    run: async (_args, { api, desktop }) => {
      const lines: string[] = [];
      const creds = api.credentials();
      if (!creds) {
        lines.push(`Not signed in. ${NOT_SIGNED_IN_MESSAGE}`);
      } else {
        const how =
          creds.source === "desktop"
            ? "using the desktop app's sign-in"
            : "using the access token from Claude Desktop's settings";
        lines.push(
          `Signed in${creds.email ? ` as ${creds.email}` : ""} at ${creds.webUrl}, ${how}.`,
        );
      }

      const app = await desktop.status();
      if (!app) {
        lines.push(
          "Desktop app: not open. Searching inside sources and show_in_app need it open; everything else works without it.",
        );
      } else {
        const mode =
          app.mode === "signed_in"
            ? "signed in"
            : app.mode === "offline"
              ? "offline mode (it works from this computer's own library)"
              : "signed out";
        lines.push(`Desktop app: open, version ${app.version}, ${mode}.`);
      }

      if (creds) {
        try {
          const drive = await api.get<{
            unsaved?: number;
            last_saved_at?: string | null;
            connected?: boolean;
          }>("/drive/status");
          if (!drive.connected) {
            lines.push("Google Drive: not connected. Connect it in the web app's Settings.");
          } else {
            const last = formatDate(drive.last_saved_at);
            const unsaved = drive.unsaved ?? 0;
            lines.push(
              `Google Drive: connected, ${unsaved === 0 ? "everything is saved" : `${plural(unsaved, "change")} not saved yet (save_to_drive saves them)`}${last ? `, last saved ${last}` : ""}.`,
            );
          }
        } catch (err) {
          lines.push(`Google Drive: couldn't check (${messageOf(err)})`);
        }
      }
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "list_projects",
    title: "List projects",
    description:
      "Lists the user's projects (the top level of the library) with each one's id, number of groups and number of sources. Archived projects are left out unless include_archived is true. Start here; then get_project_tree shows one project's groups.",
    input: {
      include_archived: z
        .boolean()
        .default(false)
        .describe("Also list archived projects. Default false."),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ include_archived }, { api }) => {
      const index = await loadFolderIndex(api);
      const projects = index
        .children(null)
        .filter((p) => include_archived || !isArchived(index, p));
      if (projects.length === 0) {
        return include_archived
          ? "There are no projects yet. Use create_project to make one."
          : "There are no projects yet (archived ones are hidden; pass include_archived to see them). Use create_project to make one.";
      }
      const lines = projects.map((project) => {
        const inside = index.descendantsOf(project.id);
        const groups = inside.length - 1;
        const sources = inside.reduce((sum, f) => sum + sourcesIn(f), 0);
        const archived = isArchived(index, project) ? " · archived" : "";
        return `[${project.id}] ${project.name} · ${plural(groups, "group")} · ${plural(sources, "source")}${archived}`;
      });
      return [`${plural(projects.length, "project")}:`, ...lines].join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "get_project_tree",
    title: "Show a project's groups and sources",
    description:
      "Shows one project's groups as a tree (nested groups are indented), each with its id and number of sources. This is the map of a project: pick the groups that matter, then list_sources shows the titles in a group. Pass include_sources=true only when you need every source title in the whole project at once (large projects get long; over 300 sources the urls are left out).",
    input: {
      project_id: z.string().describe("Id of the project (from list_projects)."),
      include_sources: z
        .boolean()
        .default(false)
        .describe(
          "Also list every source in every group. Default false: just the groups; list_sources shows one group's titles.",
        ),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ project_id, include_sources }, { api }) => {
      const index = await loadFolderIndex(api);
      const project = requireFolder(index, project_id, "project");
      const groups = index.descendantsOf(project_id).filter((f) => f.id !== project_id);

      const loaded = new Map<string, Item[] | Error>();
      if (include_sources) {
        await mapLimit(groups, TREE_CONCURRENCY, async (group) => {
          try {
            loaded.set(group.id, await loadFolderItems(api, group.id));
          } catch (err) {
            loaded.set(group.id, err instanceof Error ? err : new Error(messageOf(err)));
          }
        });
      }

      let total = 0;
      for (const value of loaded.values()) if (Array.isArray(value)) total += value.length;
      if (!include_sources) total = groups.reduce((sum, g) => sum + sourcesIn(g), 0);
      const withUrls = total <= TREE_URL_LIMIT;

      const lines: string[] = [];
      const archived = isArchived(index, project) ? " · archived" : "";
      lines.push(
        `Project: [${project.id}] ${project.name} · ${plural(groups.length, "group")} · ${plural(total, "source")}${archived}`,
      );
      if (include_sources && !withUrls) {
        lines.push(
          `This project has ${total} sources, so urls are left out. Use list_sources with a group id to see urls.`,
        );
      }
      if (groups.length === 0) {
        lines.push("No groups yet. Use create_group with this project's id as parent_id.");
        return lines.join("\n");
      }
      if (!include_sources) {
        lines.push("Groups (list_sources with a group's id shows its source titles):");
      }

      const walk = (parentId: string, depth: number) => {
        const indent = "  ".repeat(depth);
        for (const group of index.children(parentId)) {
          const items = loaded.get(group.id);
          const count = Array.isArray(items) ? items.length : sourcesIn(group);
          lines.push(`${indent}Group [${group.id}] ${group.name} · ${plural(count, "source")}`);
          if (items instanceof Error) {
            lines.push(`${indent}  (couldn't list its sources: ${items.message})`);
          } else if (items) {
            for (const item of items) lines.push(`${indent}  ${treeSourceLine(item, withUrls)}`);
          }
          walk(group.id, depth + 1);
        }
      };
      walk(project_id, 0);
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "list_sources",
    title: "List the sources in a group",
    description:
      "Lists the sources in one group, one line each: `[id] kind · title · author · author type · saved date · status · tags` (and the error when saving failed), after the group's subgroups. Read the titles to decide what is worth opening, then use read_source. Pass status (keep, maybe, cut, none) or tag to filter. Pass details=true to also get each source's url and the start of the user's note. Groups over 100 sources come in pages (offset continues).",
    input: {
      group_id: z.string().describe("Id of the group (from get_project_tree)."),
      status: z
        .enum(["keep", "maybe", "cut", "none"])
        .optional()
        .describe("Filter by research status: keep, maybe, cut, or none (untriaged)."),
      tag: z.string().min(1).optional().describe("Filter by tag (outline section or other tag)."),
      details: z
        .boolean()
        .default(false)
        .describe("Also show each source's url and the first 200 characters of the user's note."),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("How many sources to skip, to see the next page. Default 0."),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ group_id, status, tag, details, offset }, { api }) => {
      const index = await loadFolderIndex(api);
      const group = requireFolder(index, group_id, "group");
      const items = await loadFolderItems(api, group_id);
      let filtered = items;
      if (status) {
        filtered = filtered.filter((item) =>
          status === "none" ? !item.triage : item.triage === status,
        );
      }
      if (tag) {
        filtered = filtered.filter(
          (item) => Array.isArray(item.tags) && item.tags.some((t) => sameTag(t, tag)),
        );
      }
      const page = filtered.slice(offset, offset + LIST_PAGE_SIZE);
      const lines = [
        `${index.pathOf(group_id)} [${group.id}] · ${plural(filtered.length, "source")}`,
      ];

      const subgroups = index.children(group_id);
      if (subgroups.length > 0) {
        lines.push("Subgroups:");
        for (const sub of subgroups) {
          lines.push(`  Group [${sub.id}] ${sub.name} · ${plural(sourcesIn(sub), "source")}`);
        }
        if (filtered.length > 0) lines.push("Sources:");
      }

      for (const item of page) {
        lines.push(sourceLine(item));
        if (item.error) lines.push(`  Error: ${item.error}`);
        if (!details) continue;
        const url = urlOf(item);
        if (url) lines.push(`  ${url}`);
        if (item.note) lines.push(`  Note: ${truncate(item.note, 200)}`);
      }
      if (items.length === 0) {
        lines.push("This group has no sources of its own.");
      } else if (filtered.length === 0) {
        lines.push("No sources in this group match the filter.");
      } else if (page.length === 0) {
        lines.push(`This group has ${filtered.length} matching sources; use a smaller offset.`);
      } else if (offset + page.length < filtered.length) {
        lines.push(
          `Showing ${offset + 1}–${offset + page.length} of ${filtered.length}. Call list_sources with offset=${offset + page.length} for more.`,
        );
      }
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "find_sources",
    title: "Find sources",
    description:
      "Searches the library. Always finds sources whose title contains the words. With inside_text (the default) and the Sourcefold desktop app open, it also finds passages inside the sources' text and the user's highlights and notes, each with the source, its group, the heading it is under, a snippet with the matched words in **bold**, and the video time for YouTube. With the desktop app closed only titles are searched, and the reply says so. Pass project_id to stay inside one project. Then use read_source with a source id to read it.",
    input: {
      query: z.string().min(1).describe("Words to look for."),
      project_id: z
        .string()
        .optional()
        .describe("Only look inside this project (id from list_projects). Default: everywhere."),
      inside_text: z
        .boolean()
        .default(true)
        .describe(
          "Also search the text inside sources (needs the desktop app to be open). Default true.",
        ),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ query, project_id, inside_text }, { api, desktop }) => {
      const [matches, index] = await Promise.all([
        api.get<Item[]>("/items", { query: { q: query } }),
        loadFolderIndex(api),
      ]);
      if (project_id) requireFolder(index, project_id, "project");

      const titles = (Array.isArray(matches) ? matches : []).filter(
        (item) => !project_id || index.projectOf(item.folder_id)?.id === project_id,
      );
      const where = (folderId: string) =>
        index.byId.has(folderId) ? ` · in ${index.pathOf(folderId)}` : "";

      const lines: string[] = [];
      if (titles.length > 0) {
        lines.push(`Titles matching "${query}" (${titles.length}):`);
        for (const item of titles.slice(0, MAX_TITLE_MATCHES)) {
          lines.push(`${sourceLine(item)}${where(item.folder_id)}`);
        }
        if (titles.length > MAX_TITLE_MATCHES) {
          lines.push(`…and ${titles.length - MAX_TITLE_MATCHES} more. Use a more specific query.`);
        }
      } else {
        lines.push(`No source title contains "${query}".`);
      }

      if (inside_text) {
        try {
          const found = await desktop.search({
            query,
            scope: project_id ? "project" : "all",
            project_id: project_id ?? null,
            limit: 20,
          });
          if (found.passages.length > 0) {
            lines.push("", `Passages inside sources (${found.passages.length}):`);
            for (const hit of found.passages) {
              lines.push(`- ${hit.title || "(untitled)"} [${hit.item_id}]${where(hit.folder_id)}`);
              if (hit.heading) lines.push(`  Heading: ${hit.heading}`);
              lines.push(`  ${truncate(snippetToMarkdown(hit.snippet), 400)}`);
              if (hit.seconds !== null)
                lines.push(`  At ${formatSeconds(hit.seconds)} in the video`);
            }
          } else {
            lines.push("", "No passages inside sources match.");
          }
          if (found.notes.length > 0) {
            lines.push("", `In the user's highlights and notes (${found.notes.length}):`);
            for (const hit of found.notes.slice(0, 10)) {
              lines.push(
                `- ${hit.title || "(untitled)"} [${hit.item_id}]${where(hit.folder_id)} · ${hit.source}: ${truncate(snippetToMarkdown(hit.snippet), 300)}`,
              );
            }
          }
        } catch (err) {
          lines.push(
            "",
            err instanceof DesktopClosedError
              ? "Searching inside sources needs the Sourcefold desktop app to be open, so only titles were searched."
              : `Searching inside sources failed: ${messageOf(err)}`,
          );
        }
      }
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "get_source",
    title: "Describe a source",
    description:
      "Everything about one source except its text: kind, title, url, group, author or channel and the other details saved with it, saved date, status (and the error), and the user's own note. Use it to check what a source is before reading it. read_source gives the text.",
    input: {
      source_id: z.string().describe("Id of the source."),
    },
    readOnly: true,
    idempotent: true,
    run: async ({ source_id }, { api }) => {
      const base = await api.get<{
        id: string;
        kind: string;
        title: string;
        note: string | null;
        folder_id: string;
      }>(`/items/${encodeURIComponent(source_id)}`);

      const [index, siblings] = await Promise.all([
        loadFolderIndex(api).catch(() => null),
        loadFolderItems(api, base.folder_id).catch(() => [] as Item[]),
      ]);
      const full = siblings.find((item) => item.id === base.id);
      const item: Item = {
        status: "saved",
        meta: null,
        source_url: null,
        created_at: "",
        ...full,
        id: base.id,
        kind: base.kind,
        title: base.title,
        folder_id: base.folder_id,
        note: base.note,
      };

      const lines = [sourceLine(item)];
      lines.push(`Kind: ${kindLabel(item.kind)}`);
      const url = urlOf(item);
      if (url) lines.push(`URL: ${url}`);
      if (index?.byId.has(item.folder_id)) {
        lines.push(`Group: ${index.pathOf(item.folder_id)} [${item.folder_id}]`);
      } else {
        lines.push(`Group id: ${item.folder_id}`);
      }
      const saved = formatDate(item.created_at);
      if (saved) lines.push(`Saved: ${saved}`);
      lines.push(`Status: ${item.status}${item.error ? ` (${item.error})` : ""}`);
      for (const [key, value] of Object.entries(item.meta ?? {}).slice(0, 20)) {
        if (typeof value === "string" && value.trim()) {
          lines.push(`${key}: ${truncate(value, 300)}`);
        } else if (typeof value === "number" || typeof value === "boolean") {
          lines.push(`${key}: ${value}`);
        }
      }
      if (item.note) lines.push(`Note: ${truncate(item.note, 1000)}`);
      lines.push("Use read_source to read its text.");
      return lines.join("\n");
    },
  });
}
