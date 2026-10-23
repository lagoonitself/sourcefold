import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProjectExportPage,
  ProjectExportRowsByTable,
  ProjectExportSource,
  ProjectExportTable,
} from "@sourcefold/core/project-file";
import type { Database } from "@/lib/database.types";
import { projectFolderIds } from "@/features/projects/project";
import { loadItemsInGroups, selectAllPages } from "@/features/research/projects";

// The pages `GET /api/projects/{id}/export` returns (docs/PROJECT-FILE.md, "Over the web API").
// Every query filters by user_id because token requests use the admin client, which skips RLS.

export const EXPORT_PAGE_SIZE = 500;

type Db = SupabaseClient<Database>;
type Project = ProjectExportPage<ProjectExportTable>["project"];
type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function byPositionThenAge<T extends { position: number; created_at: string; id: string }>(
  rows: T[],
): T[] {
  return rows.sort(
    (a, b) => a.position - b.position || cmp(a.created_at, b.created_at) || cmp(a.id, b.id),
  );
}

function byAge<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
}

/** The user's live top-level folder with this id, or null (not a project, not theirs, deleted). */
export async function loadProject(
  db: Db,
  userId: string,
  projectId: string,
): Promise<Project | null> {
  const { data, error } = await db
    .from("folders")
    .select("id, name, created_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .is("parent_id", null)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_at: string;
}

export async function loadGroups(db: Db, userId: string, projectId: string): Promise<FolderRow[]> {
  const folders = await selectAllPages<FolderRow>((from, to) =>
    db
      .from("folders")
      .select("id, parent_id, name, position, created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const inProject = new Set(projectFolderIds(folders, projectId));
  return folders.filter((f) => f.id !== projectId && inProject.has(f.id));
}

/** Runs a query once per chunk of ids (keeps the request address short), paging within each. */
async function inChunks<T>(
  ids: string[],
  run: (chunk: string[], from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    rows.push(...(await selectAllPages<T>((from, to) => run(chunk, from, to))));
  }
  return rows;
}

const SOURCE_COLUMNS =
  "id, folder_id, kind, title, source_url, canonical_url, meta, note, position, created_at, updated_at, triage, tags, summary, author, author_type, status, storage_path, drive_file_id";

interface ItemRow {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  source_url: string | null;
  canonical_url: string | null;
  meta: unknown;
  note: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  triage: string | null;
  tags: string[] | null;
  summary: string | null;
  author: string | null;
  author_type: string | null;
  status: string;
  storage_path: string | null;
  drive_file_id: string | null;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

function extensionFromName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const dot = name.lastIndexOf(".");
  if (dot < 0 || name.includes("/", dot)) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

/** An image source's own extension: from its storage path, its file name, then its type. */
export function imageExtension(storagePath: string | null, meta: Record<string, unknown>): string {
  const mime = typeof meta.mime_type === "string" ? meta.mime_type.toLowerCase() : "";
  return (
    extensionFromName(storagePath) ??
    extensionFromName(meta.file_name) ??
    MIME_EXTENSIONS[mime] ??
    "png"
  );
}

function plainObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Ids among these items whose text is still in Supabase (`markdown` isn't null). */
async function idsWithMarkdown(db: Db, userId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db
      .from("items")
      .select("id")
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + 100))
      .not("markdown", "is", null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) found.add(row.id);
  }
  return found;
}

function toExportSource(item: ItemRow, hasMarkdown: boolean): ProjectExportSource {
  const meta = plainObject(item.meta);
  const isImage = item.kind === "image";
  const hasFile =
    item.status === "saved" &&
    (isImage
      ? Boolean(item.storage_path || item.drive_file_id)
      : hasMarkdown || Boolean(item.drive_file_id));
  return {
    id: item.id,
    group_id: item.folder_id,
    kind: item.kind,
    title: item.title,
    source_url: item.source_url,
    canonical_url: item.canonical_url,
    meta,
    note: item.note,
    position: item.position,
    created_at: item.created_at,
    updated_at: item.updated_at,
    triage: item.triage,
    tags: item.tags ?? [],
    summary: item.summary,
    author: item.author,
    author_type: item.author_type,
    extension: isImage ? imageExtension(item.storage_path, meta) : "md",
    has_file: hasFile,
  };
}

/** Every live source of the project, in export order. */
async function loadSources(db: Db, userId: string, groupIds: string[]): Promise<ItemRow[]> {
  const items = await loadItemsInGroups<ItemRow>(db, userId, groupIds, SOURCE_COLUMNS);
  return byPositionThenAge(items);
}

function page<T>(sorted: T[], from: number): { rows: T[]; next: number | null } {
  const rows = sorted.slice(from, from + EXPORT_PAGE_SIZE);
  const end = from + rows.length;
  return { rows, next: end < sorted.length ? end : null };
}

export async function exportPage<T extends ProjectExportTable>(
  db: Db,
  userId: string,
  project: Project,
  table: T,
  from: number,
): Promise<ProjectExportPage<T>> {
  const projectId = project.id;
  let all: unknown[];

  if (table === "groups") {
    const groups = await loadGroups(db, userId, projectId);
    all = byPositionThenAge(groups).map((g) => ({
      id: g.id,
      parent_id: g.parent_id === projectId ? null : g.parent_id,
      name: g.name,
      position: g.position,
      created_at: g.created_at,
    }));
  } else if (table === "outline_sections") {
    const sections = await selectAllPages<{
      id: string;
      title: string;
      position: number;
      created_at: string;
    }>((a, b) =>
      db
        .from("outline_sections")
        .select("id, title, position, created_at")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .order("id", { ascending: true })
        .range(a, b),
    );
    all = byPositionThenAge(sections);
  } else {
    const groups = await loadGroups(db, userId, projectId);
    const items = await loadSources(
      db,
      userId,
      groups.map((g) => g.id),
    );
    const itemIds = items.map((i) => i.id);

    if (table === "sources") {
      const slice = page(items, from);
      const withMarkdown = await idsWithMarkdown(
        db,
        userId,
        slice.rows.filter((i) => i.kind !== "image").map((i) => i.id),
      );
      return {
        project,
        rows: slice.rows.map((i) =>
          toExportSource(i, withMarkdown.has(i.id)),
        ) as ProjectExportRowsByTable[T][],
        next: slice.next,
      };
    }

    if (table === "x_posts") {
      const posts = await inChunks<{
        id: string;
        item_id: string;
        parent_id: string | null;
        post_url: string;
        canonical_url: string;
        author_name: string;
        handle: string;
        author_url: string;
        posted_at: string | null;
        text: string;
        media: unknown;
        position: number;
        created_at: string;
      }>(itemIds, (chunk, a, b) =>
        db
          .from("x_posts")
          .select(
            "id, item_id, parent_id, post_url, canonical_url, author_name, handle, author_url, posted_at, text, media, position, created_at",
          )
          .eq("user_id", userId)
          .in("item_id", chunk)
          .order("id", { ascending: true })
          .range(a, b),
      );
      all = byPositionThenAge(posts).map(({ item_id, media, ...rest }) => ({
        ...rest,
        source_id: item_id,
        media: Array.isArray(media) ? media : [],
      }));
    } else if (table === "highlights") {
      const highlights = await inChunks<{
        id: string;
        item_id: string;
        kind: string;
        quote: string;
        prefix: string;
        suffix: string;
        start_offset: number;
        end_offset: number;
        image_src: string | null;
        note: string | null;
        seconds: number | null;
        cited: unknown;
        created_at: string;
      }>(itemIds, (chunk, a, b) =>
        db
          .from("highlights")
          .select(
            "id, item_id, kind, quote, prefix, suffix, start_offset, end_offset, image_src, note, seconds, cited, created_at",
          )
          .eq("user_id", userId)
          .in("item_id", chunk)
          .order("id", { ascending: true })
          .range(a, b),
      );
      all = byAge(highlights).map(({ item_id, cited, ...rest }) => ({
        ...rest,
        source_id: item_id,
        cited: Array.isArray(cited) ? cited : [],
      }));
    } else {
      const cards = await selectAllPages<{
        id: string;
        kind: string;
        item_id: string | null;
        highlight_id: string | null;
        quote: string;
        seconds: number | null;
        end_seconds: number | null;
        url: string | null;
        note: string | null;
        script_line: string | null;
        section_id: string | null;
        position: number;
        created_at: string;
      }>((a, b) =>
        db
          .from("cards")
          .select(
            "id, kind, item_id, highlight_id, quote, seconds, end_seconds, url, note, script_line, section_id, position, created_at",
          )
          .eq("user_id", userId)
          .eq("project_id", projectId)
          .order("id", { ascending: true })
          .range(a, b),
      );
      const live = new Set(itemIds);
      // A card of a deleted source goes with it; one whose highlight is gone loses the link.
      const highlightIds = new Set<string>();
      const wanted = cards.filter((c) => c.item_id === null || live.has(c.item_id));
      const linked = wanted.filter((c) => c.highlight_id !== null).map((c) => c.highlight_id!);
      for (let i = 0; i < linked.length; i += 100) {
        const { data, error } = await db
          .from("highlights")
          .select("id")
          .eq("user_id", userId)
          .in("id", linked.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const row of data ?? []) highlightIds.add(row.id);
      }
      all = byPositionThenAge(wanted).map(({ item_id, highlight_id, ...rest }) => ({
        ...rest,
        source_id: item_id,
        highlight_id: highlight_id !== null && highlightIds.has(highlight_id) ? highlight_id : null,
      }));
    }
  }

  const slice = page(all, from);
  return { project, rows: slice.rows as ProjectExportRowsByTable[T][], next: slice.next };
}
