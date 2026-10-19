import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Folder, Item } from "../types";
import { ApiError, type WebApi } from "../web-api";
import { defineTool, type ToolContext } from "./define";
import { kindLabel, messageOf, plural, sourceLine, type FolderIndex } from "./format";
import {
  isProject,
  loadFolderIndex,
  mapLimit,
  PROJECT_GUARD_DESCRIPTION,
  requireFolder,
  requireInProject,
  resolveProject,
  sourcesIn,
  withHint,
} from "./library-data";
import { forgetCachedSource } from "./read";

const BATCH_CONCURRENCY = 4;
const GROUP_HINT = "Use get_project_tree to find group ids.";
const SOURCE_HINT = "Use list_sources to find source ids.";

/** Runs `fn` for each distinct id; returns what worked and what failed, in order. */
async function eachId<T>(
  ids: string[],
  fn: (id: string) => Promise<T>,
): Promise<{
  done: Array<{ id: string; value: T }>;
  failed: Array<{ id: string; message: string }>;
}> {
  const unique = [...new Set(ids)];
  const results = await mapLimit(unique, BATCH_CONCURRENCY, async (id) => {
    try {
      return { id, value: await fn(id) };
    } catch (err) {
      return { id, error: messageOf(withHint(err, SOURCE_HINT)) };
    }
  });
  const done: Array<{ id: string; value: T }> = [];
  const failed: Array<{ id: string; message: string }> = [];
  for (const result of results) {
    if ("error" in result && result.error !== undefined) {
      failed.push({ id: result.id, message: result.error });
    } else if ("value" in result) {
      done.push({ id: result.id, value: result.value });
    }
  }
  return { done, failed };
}

function failureLines(failed: Array<{ id: string; message: string }>): string[] {
  return failed.map((f) => `[${f.id}] ${f.message}`);
}

/** What `GET /api/items/[id]` answers: enough to say what and where a source is. */
interface SourceRef {
  id: string;
  kind: string;
  title: string;
  folder_id: string;
  source_url?: string | null;
  canonical_url?: string | null;
}

async function loadSourceRef(api: WebApi, id: string): Promise<SourceRef> {
  return api.get<SourceRef>(`/items/${encodeURIComponent(id)}`);
}

function where(index: FolderIndex, folderId: string): string {
  return index.byId.has(folderId) ? index.pathOf(folderId) : `group ${folderId}`;
}

/** `[id] Web page · "Title" (in Cars › Engines)` */
function refLine(index: FolderIndex, ref: SourceRef): string {
  return `[${ref.id}] ${kindLabel(ref.kind)} · "${ref.title}" (in ${where(index, ref.folder_id)})`;
}

const projectGuard = z.string().min(1).optional().describe(PROJECT_GUARD_DESCRIPTION);

export function registerOrganizeTools(server: McpServer, ctx: ToolContext): void {
  defineTool(server, ctx, {
    name: "create_project",
    title: "Create a project",
    description:
      "Creates a new top-level project. A project holds groups, and groups hold sources, so after this use create_group with the project's id before adding sources. Answers with the new project's id.",
    input: {
      name: z.string().min(1).max(200).describe("Name of the project, up to 200 characters."),
    },
    run: async ({ name }, { api }) => {
      const project = await api.post<Folder>("/folders", { name });
      return `Created project "${project.name}" [${project.id}]. Sources can't live directly in a project: use create_group with parent_id ${project.id} to make a group.`;
    },
  });

  defineTool(server, ctx, {
    name: "create_group",
    title: "Create a group",
    description:
      "Creates a group inside a project or inside another group (groups nest to any depth). Sources are saved into groups, never directly into a project. parent_id is required: the id of the project or group it goes in (from list_projects or get_project_tree). Answers with the new group's id.",
    input: {
      name: z.string().min(1).max(200).describe("Name of the group, up to 200 characters."),
      parent_id: z
        .string()
        .min(1)
        .describe(
          "Id of the project or group to create it in (from list_projects/get_project_tree).",
        ),
    },
    run: async ({ name, parent_id }, { api }) => {
      const index = await loadFolderIndex(api);
      const parent = requireFolder(index, parent_id, "any");
      const group = await api.post<Folder>("/folders", { name, parent_id });
      return `Created group "${group.name}" [${group.id}] in ${index.pathOf(parent.id)}.`;
    },
  });

  defineTool(server, ctx, {
    name: "update_group",
    title: "Change a group or project",
    description:
      "Renames a group or project, moves it into another project or group (parent_id; null makes it a top-level project, which only works for a group without sources), changes its position among its siblings, or archives/unarchives a project (archived; projects only). Give only the fields to change. Sources keep their places when a group moves.",
    input: {
      group_id: z.string().min(1).describe("Id of the group or project."),
      name: z.string().min(1).max(200).optional().describe("New name."),
      parent_id: z
        .string()
        .nullable()
        .optional()
        .describe("Id of the project or group to move it into, or null to make it a project."),
      position: z
        .number()
        .int()
        .optional()
        .describe("Place among its siblings, starting at 0 (lower comes first)."),
      archived: z
        .boolean()
        .optional()
        .describe("true to archive a project, false to bring it back. Projects only."),
      project: projectGuard,
    },
    idempotent: true,
    run: async ({ group_id, name, parent_id, position, archived, project }, { api }) => {
      const body: Record<string, unknown> = {};
      if (name !== undefined) body.name = name;
      if (parent_id !== undefined) body.parent_id = parent_id;
      if (position !== undefined) body.position = position;
      if (Object.keys(body).length === 0 && archived === undefined) {
        throw new Error("Nothing to change. Give name, parent_id, position or archived.");
      }

      const index = await loadFolderIndex(api);
      const guard = project ? resolveProject(index, project) : null;
      const folder = requireFolder(index, group_id, "any");
      const label = `${isProject(folder) ? "Project" : "Group"} "${index.pathOf(group_id)}" [${group_id}]`;
      requireInProject(index, guard, group_id, label);
      if (archived !== undefined && !isProject(folder)) {
        throw new Error(
          `Only projects can be archived, and "${folder.name}" is a group in ${index.pathOf(group_id)}.`,
        );
      }
      if (parent_id) {
        requireFolder(index, parent_id, "any");
        requireInProject(index, guard, parent_id, `The new parent [${parent_id}]`);
      }

      const changes: string[] = [];
      // The web app handles `archived` on its own and ignores other fields sent with it.
      if (Object.keys(body).length > 0) {
        try {
          await api.patch(`/folders/${encodeURIComponent(group_id)}`, body);
        } catch (err) {
          throw withHint(err, GROUP_HINT);
        }
        if (name !== undefined) changes.push(`renamed to "${name}"`);
        if (parent_id !== undefined) {
          changes.push(
            parent_id === null
              ? "made a top-level project"
              : `moved into ${index.pathOf(parent_id)}`,
          );
        }
        if (position !== undefined) changes.push(`position ${position}`);
      }
      if (archived !== undefined) {
        await api.patch(`/folders/${encodeURIComponent(group_id)}`, { archived });
        changes.push(archived ? "archived" : "unarchived");
      }
      return `Updated ${label}: ${changes.join(", ")}.`;
    },
  });

  defineTool(server, ctx, {
    name: "delete_group",
    title: "Delete a group or project",
    description:
      "Deletes a group (or a whole project) together with every group inside it and every source in them. This cannot be undone from here. Check with get_project_tree first, and use move_sources to keep sources that should survive. Answers with what was deleted.",
    input: {
      group_id: z.string().min(1).describe("Id of the group or project to delete."),
      project: projectGuard,
    },
    destructive: true,
    run: async ({ group_id, project }, { api }) => {
      let summary = `[${group_id}]`;
      let note = "";
      let index: FolderIndex | null = null;
      try {
        index = await loadFolderIndex(api);
      } catch (err) {
        // With a guard the delete must be checked; without one a failed lookup isn't a reason
        // to refuse.
        if (project) throw err;
      }
      if (index) {
        const guard = project ? resolveProject(index, project) : null;
        const folder = requireFolder(index, group_id, "any");
        summary = `${isProject(folder) ? "project" : "group"} "${index.pathOf(group_id)}" [${group_id}]`;
        requireInProject(
          index,
          guard,
          group_id,
          summary.replace(/^./, (c) => c.toUpperCase()),
        );
        const inside = index.descendantsOf(group_id);
        const sources = inside.reduce((sum, f) => sum + sourcesIn(f), 0);
        note = ` with ${plural(inside.length - 1, "subgroup")} and ${plural(sources, "source")}`;
      }
      try {
        await api.delete(`/folders/${encodeURIComponent(group_id)}`);
      } catch (err) {
        throw withHint(err, GROUP_HINT);
      }
      return `Deleted ${summary}${note}.`;
    },
  });

  defineTool(server, ctx, {
    name: "update_source",
    title: "Change a source",
    description:
      "Renames a source (title), moves it to another group (group_id), or sets, replaces or clears the user's own note on it (note; null clears it). Give only the fields to change. This is the user's note about the source, not its text: to edit a standalone note's text use edit_note. To move many sources at once use move_sources.",
    input: {
      source_id: z.string().min(1).describe("Id of the source."),
      title: z.string().min(1).max(500).optional().describe("New title."),
      group_id: z
        .string()
        .optional()
        .describe("Id of the group to move it to (a group, not a project)."),
      note: z
        .string()
        .max(20000)
        .nullable()
        .optional()
        .describe("The user's note on the source; null or an empty string removes it."),
      project: projectGuard,
    },
    idempotent: true,
    run: async ({ source_id, title, group_id, note, project }, { api }) => {
      const body: Record<string, unknown> = {};
      if (title !== undefined) body.title = title;
      if (group_id !== undefined) body.folder_id = group_id;
      if (note !== undefined) body.note = note;
      if (Object.keys(body).length === 0) {
        throw new Error("Nothing to change. Give title, group_id or note.");
      }

      const [index, before] = await Promise.all([
        loadFolderIndex(api),
        loadSourceRef(api, source_id).catch((err: unknown) => {
          throw withHint(err, SOURCE_HINT);
        }),
      ]);
      const guard = project ? resolveProject(index, project) : null;
      requireInProject(index, guard, before.folder_id, `"${before.title}" [${source_id}]`);
      if (group_id !== undefined) {
        requireFolder(index, group_id, "group");
        requireInProject(index, guard, group_id, `The group [${group_id}]`);
      }

      let item: Item;
      try {
        item = await api.patch<Item>(`/items/${encodeURIComponent(source_id)}`, body);
      } catch (err) {
        throw withHint(err, SOURCE_HINT);
      }
      forgetCachedSource(source_id);
      const changes = [
        title !== undefined ? `renamed from "${before.title}"` : null,
        group_id !== undefined
          ? `moved from ${where(index, before.folder_id)} to ${where(index, group_id)}`
          : null,
        note !== undefined ? (note ? "note set" : "note cleared") : null,
      ].filter(Boolean);
      return `Updated (${changes.join(", ")}): ${sourceLine(item)} · in ${where(index, item.folder_id)}`;
    },
  });

  defineTool(server, ctx, {
    name: "move_sources",
    title: "Move sources to a group",
    description:
      'Moves several sources into one group (a group, not a project). Each source is handled on its own, and the reply lists each one with where it came from, and which failed with the reason. Use if_duplicate="skip" to leave sources whose link the target group already has where they are, or if_duplicate="merge" to combine highlights and notes into the existing copy and delete the moved one. Fails as a whole only when none could be moved, skipped or merged.',
    input: {
      source_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(200)
        .describe("Ids of the sources to move."),
      group_id: z.string().min(1).describe("Id of the group to move them into."),
      if_duplicate: z
        .enum(["fail", "skip", "merge"])
        .default("fail")
        .describe(
          'What to do when a source\'s link is already in the target group: "fail" (default), "skip" (leave in its current group), or "merge" (combine highlights and notes into the copy already in the group, and delete the moved one).',
        ),
      project: projectGuard,
    },
    idempotent: true,
    run: async ({ source_ids, group_id, if_duplicate, project }, { api }) => {
      const index = await loadFolderIndex(api);
      const guard = project ? resolveProject(index, project) : null;
      const target = requireFolder(index, group_id, "group");
      requireInProject(index, guard, group_id, `The group ${index.pathOf(group_id)} [${group_id}]`);

      type MoveOutcome =
        | { status: "moved"; ref: SourceRef }
        | { status: "skipped"; ref: SourceRef }
        | { status: "merged"; ref: SourceRef; targetId: string };

      const unique = [...new Set(source_ids)];
      const results = await mapLimit(unique, BATCH_CONCURRENCY, async (id) => {
        try {
          const ref = await loadSourceRef(api, id);
          requireInProject(index, guard, ref.folder_id, `"${ref.title}"`);
          try {
            await api.patch<Item>(`/items/${encodeURIComponent(id)}`, { folder_id: group_id });
            forgetCachedSource(id);
            return { id, outcome: { status: "moved", ref } as MoveOutcome };
          } catch (patchErr) {
            const isDup =
              patchErr instanceof ApiError &&
              patchErr.status === 409 &&
              /already has this link/i.test(patchErr.message);

            if (isDup && if_duplicate === "skip") {
              return { id, outcome: { status: "skipped", ref } as MoveOutcome };
            }
            if (isDup && if_duplicate === "merge") {
              let url = ref.canonical_url || ref.source_url;
              if (!url) {
                const full = await api.get<{
                  canonical_url?: string | null;
                  source_url?: string | null;
                }>(`/items/${encodeURIComponent(id)}`);
                url = full.canonical_url || full.source_url;
              }
              if (!url) throw patchErr;
              const check = await api.post<{ item_id: string }>("/items/check", {
                url,
                folder_id: group_id,
              });
              await api.post(`/items/${encodeURIComponent(check.item_id)}/merge`, {
                ids: [id],
              });
              forgetCachedSource(id);
              forgetCachedSource(check.item_id);
              return {
                id,
                outcome: { status: "merged", ref, targetId: check.item_id } as MoveOutcome,
              };
            }
            throw patchErr;
          }
        } catch (err) {
          return { id, error: messageOf(withHint(err, SOURCE_HINT)) };
        }
      });

      const moved: SourceRef[] = [];
      const skipped: SourceRef[] = [];
      const merged: Array<{ ref: SourceRef; targetId: string }> = [];
      const failed: Array<{ id: string; message: string }> = [];

      for (const res of results) {
        if ("error" in res && res.error !== undefined) {
          failed.push({ id: res.id, message: res.error });
        } else if ("outcome" in res && res.outcome) {
          if (res.outcome.status === "moved") moved.push(res.outcome.ref);
          else if (res.outcome.status === "skipped") skipped.push(res.outcome.ref);
          else if (res.outcome.status === "merged")
            merged.push({ ref: res.outcome.ref, targetId: res.outcome.targetId });
        }
      }

      const succeededCount = moved.length + skipped.length + merged.length;
      if (succeededCount === 0) {
        throw new Error(["Couldn't move any source:", ...failureLines(failed)].join("\n"));
      }

      const total = succeededCount + failed.length;
      const lines = [
        `Moved ${moved.length} of ${total} sources to ${index.pathOf(target.id)} [${target.id}]:`,
      ];
      if (moved.length > 0) {
        lines.push(...moved.map((ref) => refLine(index, ref).replace(/\(in /, "(from ")));
      }
      if (skipped.length > 0) {
        lines.push(
          "Skipped (the group already has this link):",
          ...skipped.map((ref) => refLine(index, ref).replace(/\(in /, "(from ")),
        );
      }
      if (merged.length > 0) {
        lines.push(
          "Merged into the copy already in the group:",
          ...merged.map(
            ({ ref, targetId }) =>
              `[${ref.id}] into [${targetId}] ${kindLabel(ref.kind)} · "${ref.title}" (from ${where(index, ref.folder_id)})`,
          ),
        );
      }
      if (failed.length > 0) lines.push("Failed:", ...failureLines(failed));
      return lines.join("\n");
    },
  });

  defineTool(server, ctx, {
    name: "delete_sources",
    title: "Delete sources",
    description:
      "Deletes sources by id. Each one is handled on its own, and the reply lists each deleted source with its title and group, and which failed with the reason. Fails as a whole only when none could be deleted. Check ids with list_sources or find_sources first; this cannot be undone from here.",
    input: {
      source_ids: z
        .array(z.string().min(1))
        .min(1)
        .max(200)
        .describe("Ids of the sources to delete."),
      project: projectGuard,
    },
    destructive: true,
    run: async ({ source_ids, project }, { api }) => {
      const index = await loadFolderIndex(api);
      const guard = project ? resolveProject(index, project) : null;
      const { done, failed } = await eachId(source_ids, async (id) => {
        const ref = await loadSourceRef(api, id);
        requireInProject(index, guard, ref.folder_id, `"${ref.title}"`);
        await api.delete(`/items/${encodeURIComponent(id)}`);
        forgetCachedSource(id);
        return ref;
      });
      if (done.length === 0) {
        throw new Error(["Couldn't delete any source:", ...failureLines(failed)].join("\n"));
      }
      const lines = [
        `Deleted ${done.length} of ${done.length + failed.length} sources:`,
        ...done.map(({ value }) => refLine(index, value)),
      ];
      if (failed.length > 0) lines.push("Failed:", ...failureLines(failed));
      return lines.join("\n");
    },
  });
}
