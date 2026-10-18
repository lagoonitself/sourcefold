import { opensInReader } from "@/features/reader/open-decision";
import type { Folder, Item } from "@/lib/types";

/** What `agent-show` carries (apps/desktop/src-tauri/src/agent.rs). */
export type AgentShowTarget = { group_id: string } | { source_id: string; highlight_id?: string };

/** Where the app should go: a project and group, a focused source, and maybe the reader. */
export interface ShowNavigation {
  projectId: string;
  /** Null when the project has no groups yet. */
  groupId: string | null;
  focusItemId: string | null;
  reader: { item: Item; highlightId: string | null } | null;
}

export type ShowPlan = { ok: true; navigation: ShowNavigation } | { ok: false; message: string };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Reads the event's payload; null when it isn't one of the three shapes the app sends. */
export function parseShowPayload(payload: unknown): AgentShowTarget | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;
  const groupId = text(body.group_id);
  const sourceId = text(body.source_id);
  const highlightId = text(body.highlight_id);
  if (groupId && !sourceId && !highlightId) return { group_id: groupId };
  if (sourceId && !groupId) {
    return highlightId
      ? { source_id: sourceId, highlight_id: highlightId }
      : { source_id: sourceId };
  }
  return null;
}

/** The project (a folder with no parent) that holds `folderId`, or null when the chain is broken. */
export function rootProjectId(folders: Folder[], folderId: string): string | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId);
  for (let depth = 0; current && depth < 1000; depth++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return null;
}

/**
 * Turns a show request into navigation. `folders` is the current list of all folders; `item` is the
 * source the request names (loaded by the caller), or null for a group request.
 */
export function planShow(target: AgentShowTarget, folders: Folder[], item: Item | null): ShowPlan {
  if ("group_id" in target) {
    const folder = folders.find((f) => f.id === target.group_id);
    if (!folder) return { ok: false, message: "Claude asked to show a group that isn't there." };
    if (!folder.parent_id) {
      // A project opens on its first group, like choosing it in the project switcher.
      const first = folders.find((f) => f.parent_id === folder.id);
      return {
        ok: true,
        navigation: {
          projectId: folder.id,
          groupId: first?.id ?? null,
          focusItemId: null,
          reader: null,
        },
      };
    }
    const projectId = rootProjectId(folders, folder.id);
    if (!projectId) return { ok: false, message: "Couldn't find the project for that group." };
    return {
      ok: true,
      navigation: { projectId, groupId: folder.id, focusItemId: null, reader: null },
    };
  }

  if (!item || item.id !== target.source_id) {
    return { ok: false, message: "Claude asked to show a source that isn't there." };
  }
  const projectId = rootProjectId(folders, item.folder_id);
  if (!projectId || projectId === item.folder_id) {
    return { ok: false, message: "Couldn't find the group for that source." };
  }
  return {
    ok: true,
    navigation: {
      projectId,
      groupId: item.folder_id,
      focusItemId: item.id,
      // Images and other sources the reader can't show are only focused in the list.
      reader: opensInReader(item) ? { item, highlightId: target.highlight_id ?? null } : null,
    },
  };
}
