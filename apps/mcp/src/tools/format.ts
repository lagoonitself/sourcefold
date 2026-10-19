import { AUTHOR_TYPE_LABELS, TRIAGE_LABELS } from "@sourcefold/core";
import type { Folder, Item } from "../types";

// Text helpers shared by every tool. Replies are written for a model to read: one fact per line,
// ids in brackets so they can be passed back, no JSON.

export function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "Something went wrong.";
}

/** `2026-10-18`, or an empty string for a missing or bad date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const KIND_LABELS: Record<string, string> = {
  grokipedia: "Grokipedia",
  wikipedia: "Wikipedia",
  substack: "Substack",
  x: "X",
  youtube: "YouTube",
  web: "Web page",
  reddit: "Reddit",
  pdf: "PDF",
  hackernews: "Hacker News",
  bluesky: "Bluesky",
  note: "Note",
  image: "Image",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function metaString(meta: Item["meta"], key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Author, channel, publication or site, whichever the source has. */
export function bylineOf(item: Pick<Item, "meta"> & { author?: string | null }): string | null {
  if (item.author && typeof item.author === "string" && item.author.trim()) {
    return item.author.trim();
  }
  for (const key of ["author", "channel", "publication", "site_name", "site", "subreddit"]) {
    const value = metaString(item.meta, key);
    if (value) return value;
  }
  return null;
}

/** `[id] YouTube · Title · Engineering Explained · 2026-10-18` */
export function sourceLine(item: Item): string {
  const parts = [kindLabel(item.kind), item.title || "(untitled)"];
  const byline = bylineOf(item);
  if (byline) parts.push(byline);
  if (item.author_type) {
    const label = AUTHOR_TYPE_LABELS[item.author_type] ?? item.author_type;
    parts.push(label);
  }
  const date = formatDate(item.created_at);
  if (date) parts.push(date);
  if (item.triage) {
    const label = TRIAGE_LABELS[item.triage] ?? item.triage;
    parts.push(label);
  }
  if (item.status && item.status !== "saved") parts.push(item.status);
  if (item.tags && item.tags.length > 0) {
    parts.push(`tags: ${item.tags.join(", ")}`);
  }
  return `[${item.id}] ${parts.join(" · ")}`;
}

/** The desktop index marks matched words as `\u0002word\u0003`. */
export function snippetToMarkdown(snippet: string): string {
  return snippet.replace(/\u0002/g, "**").replace(/\u0003/g, "**");
}

/** `1:02:03` / `4:05` for a YouTube time. */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// ----------------------------------------------------------------------------------------------
// The folder tree. A project is a folder without a parent; a group is any folder inside one.
// ----------------------------------------------------------------------------------------------

export interface FolderIndex {
  folders: Folder[];
  byId: Map<string, Folder>;
  /** Children of each folder id (and of `null`: the projects), sorted by position then name. */
  children(parentId: string | null): Folder[];
  /** The project a folder belongs to (itself for a project). */
  projectOf(id: string): Folder | null;
  /** `Cars › Engines › Turbo`. */
  pathOf(id: string): string;
  /** The folder and every folder below it. */
  descendantsOf(id: string): Folder[];
}

export function indexFolders(folders: Folder[]): FolderIndex {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const kids = new Map<string | null, Folder[]>();
  for (const folder of folders) {
    const parent = folder.parent_id && byId.has(folder.parent_id) ? folder.parent_id : null;
    const list = kids.get(parent) ?? [];
    list.push(folder);
    kids.set(parent, list);
  }
  for (const list of kids.values()) {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  const chain = (id: string): Folder[] => {
    const out: Folder[] = [];
    let current = byId.get(id);
    for (let depth = 0; current && depth < 1000; depth++) {
      out.unshift(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return out;
  };

  return {
    folders,
    byId,
    children: (parentId) => kids.get(parentId) ?? [],
    projectOf: (id) => chain(id)[0] ?? null,
    pathOf: (id) =>
      chain(id)
        .map((f) => f.name)
        .join(" › "),
    descendantsOf: (id) => {
      const root = byId.get(id);
      if (!root) return [];
      const out: Folder[] = [];
      const stack = [root];
      while (stack.length) {
        const next = stack.pop()!;
        out.push(next);
        stack.push(...(kids.get(next.id) ?? []));
      }
      return out;
    },
  };
}
