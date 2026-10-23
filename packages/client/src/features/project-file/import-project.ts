import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeXMedia,
  RESEARCH_LIMITS,
  isAuthorType,
  isTriage,
  normalizeTags,
} from "@sourcefold/core";
import { uniqueProjectName } from "@sourcefold/core/project-file";
import type { Database, Json, TablesInsert } from "../../database.types";
import { nextPosition } from "../capture/find-duplicate";
import { loadGroups, loadProject } from "./export-pages";
import type { ImportRequest } from "./import-schema";

// Adds one batch of a project file to the user's new project (docs/PROJECT-FILE.md, "Over the
// web API"). Rows come with their final ids; every reference must point at this project, which
// is checked here against the database and the same request. Every query filters by user_id
// because token requests use the admin client, which skips RLS.

type Db = SupabaseClient<Database>;
type Row = Record<string, unknown>;

export class ImportError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new ImportError(400, message);

interface LooseQuery extends PromiseLike<{
  data: Row[] | null;
  error: { message: string } | null;
}> {
  eq(column: string, value: string): LooseQuery;
  in(column: string, values: string[]): LooseQuery;
  is(column: string, value: null): LooseQuery;
}

/** Rows of a table by id, in chunks that keep the request address short. */
async function fetchByIds(
  db: Db,
  table: string,
  columns: string,
  ids: readonly string[],
  filters: { eq?: Record<string, string>; live?: boolean } = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    let query = (db.from(table as "items") as unknown as { select(c: string): LooseQuery })
      .select(columns)
      .in("id", ids.slice(i, i + 100));
    for (const [column, value] of Object.entries(filters.eq ?? {})) query = query.eq(column, value);
    if (filters.live) query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function insertRows(db: Db, table: string, rows: object[]): Promise<void> {
  const target = db.from(table as "items") as unknown as {
    insert(values: object[]): PromiseLike<{
      error: { message: string; code?: string } | null;
    }>;
  };
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await target.insert(rows.slice(i, i + 500));
    if (!error) continue;
    if (error.code === "23505") {
      throw bad("Part of this was already imported, or two rows in the file clash.");
    }
    if (error.code === "23514" || error.code === "23503" || error.code === "22P02") {
      throw bad("Something in the file isn't valid.");
    }
    if (error.message.includes("invalid folder") || error.message.includes("invalid parent")) {
      throw bad("A group or source in the file has no valid place in the project.");
    }
    console.error(`Failed to import rows into ${table}:`, error);
    throw new ImportError(500, "Couldn't save the project. Try again.");
  }
}

function checkNoRepeats(ids: string[], what: string): void {
  if (new Set(ids).size !== ids.length) throw bad(`The same ${what} id appears twice.`);
}

async function checkNew(db: Db, table: string, ids: string[], what: string) {
  checkNoRepeats(ids, what);
  const found = await fetchByIds(db, table, "id", ids);
  if (found.length > 0) throw bad(`A ${what} in the file was already imported.`);
}

const int = (value: number) => Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round(value)));

function isoDate(value: string | null, fallback = new Date().toISOString()): string {
  if (value === null) return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function clean(value: string, max: number, fallback: string): string {
  return value.trim().slice(0, max).trim() || fallback;
}

/** Rows grouped by depth in a parent chain, so a parent is always inserted before its children. */
function byDepth<T extends { id: string }>(
  rows: T[],
  parentOf: (row: T) => string | null,
  depthOfExisting: (parentId: string) => number,
): T[][] {
  const depth = new Map<string, number>();
  const levels: T[][] = [];
  for (const row of rows) {
    const parent = parentOf(row);
    const d = parent === null ? 0 : (depth.get(parent) ?? depthOfExisting(parent)) + 1;
    depth.set(row.id, d);
    (levels[d] ??= []).push(row);
  }
  return levels.filter(Boolean);
}

async function createProject(
  db: Db,
  userId: string,
  projectId: string,
  requestedName: string,
): Promise<string> {
  const { data: existing, error: existingError } = await db
    .from("folders")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) throw new ImportError(409, "This project was already imported.");

  const { data: taken, error: takenError } = await db
    .from("folders")
    .select("name")
    .eq("user_id", userId)
    .is("parent_id", null)
    .is("deleted_at", null);
  if (takenError) throw new Error(takenError.message);
  // Leave room for " (2)" within the 200 characters a folder name may have.
  const name = uniqueProjectName(
    clean(requestedName, 190, "Imported project"),
    (taken ?? []).map((t) => t.name),
  );
  const position = await nextPosition(db, userId, null, "folders");
  const { error } = await db
    .from("folders")
    .insert({ id: projectId, user_id: userId, name, parent_id: null, position });
  if (error) {
    if (error.code === "23505") throw new ImportError(409, "This project was already imported.");
    console.error("Failed to create the imported project:", error);
    throw new ImportError(500, "Couldn't create the project. Try again.");
  }
  return name;
}

export interface ImportOutcome {
  name: string;
  /** The last call: the caller starts the Drive push. */
  done: boolean;
}

export async function importBatch(
  db: Db,
  userId: string,
  projectId: string,
  body: ImportRequest,
): Promise<ImportOutcome> {
  let name: string;
  if (body.project) {
    name = await createProject(db, userId, projectId, body.project.name);
  } else {
    const project = await loadProject(db, userId, projectId);
    if (!project) throw new ImportError(404, "Project not found.");
    name = project.name;
  }

  const groups = body.groups ?? [];
  const sources = body.sources ?? [];
  const xPosts = body.x_posts ?? [];
  const highlights = body.highlights ?? [];
  const sections = body.outline_sections ?? [];
  const cards = body.cards ?? [];
  if (
    groups.length +
      sources.length +
      xPosts.length +
      highlights.length +
      sections.length +
      cards.length ===
    0
  ) {
    return { name, done: body.done === true };
  }

  const groupIds = new Set((await loadGroups(db, userId, projectId)).map((g) => g.id));

  // --- Groups -----------------------------------------------------------------------------
  checkNoRepeats(
    groups.map((g) => g.id),
    "group",
  );
  if (groups.some((g) => g.id === projectId)) throw bad("A group has the project's id.");
  if (groups.length > 0) {
    const found = await fetchByIds(
      db,
      "folders",
      "id",
      groups.map((g) => g.id),
    );
    if (found.length > 0) throw bad("A group in the file was already imported.");
  }
  for (const group of groups) {
    if (group.parent_id !== null && !groupIds.has(group.parent_id)) {
      throw bad(`The group "${group.name}" is inside a group that isn't in this project.`);
    }
    groupIds.add(group.id);
  }

  // --- Sources ----------------------------------------------------------------------------
  const sourceIds = new Set<string>();
  /** Every id must be a live source of this project: sent in this call, or already saved. */
  const requireSources = async (ids: string[], message: string) => {
    const missing = [...new Set(ids)].filter((id) => !sourceIds.has(id));
    if (missing.length === 0) return;
    const found = await fetchByIds(db, "items", "id, folder_id", missing, {
      eq: { user_id: userId },
      live: true,
    });
    for (const row of found) {
      if (groupIds.has(String(row.folder_id))) sourceIds.add(String(row.id));
    }
    if (missing.some((id) => !sourceIds.has(id))) throw bad(message);
  };

  await checkNew(
    db,
    "items",
    sources.map((s) => s.id),
    "source",
  );
  const sourceRows: TablesInsert<"items">[] = [];
  const imageChecks: { id: string; path: string }[] = [];
  for (const source of sources) {
    if (!groupIds.has(source.group_id)) {
      throw bad(`The source "${source.title}" is in a group that isn't in this project.`);
    }
    if (source.kind === "image" && source.storage_path !== null) {
      const prefix = `${userId}/${source.id}/`;
      const rest = source.storage_path.slice(prefix.length);
      if (
        !source.storage_path.startsWith(prefix) ||
        rest.length === 0 ||
        rest.includes("/") ||
        source.storage_path.includes("..")
      ) {
        throw bad("An image in the file was uploaded to the wrong place.");
      }
      imageChecks.push({ id: source.id, path: source.storage_path });
    } else if (source.kind !== "image" && source.storage_path !== null) {
      throw bad("Only images have an uploaded file.");
    }
    const image = source.kind === "image";
    const missingImage = image && source.storage_path === null;
    sourceRows.push({
      id: source.id,
      user_id: userId,
      folder_id: source.group_id,
      kind: source.kind,
      title: clean(source.title, 500, "Untitled"),
      status: missingImage ? "failed" : "saved",
      error: missingImage ? "The image was missing from the project file." : null,
      source_url: source.source_url,
      canonical_url: source.canonical_url,
      markdown: image ? null : source.markdown,
      storage_path: source.storage_path,
      meta: source.meta as Json,
      note: source.note,
      position: int(source.position),
      created_at: isoDate(source.created_at),
      triage: isTriage(source.triage) ? source.triage : null,
      tags: normalizeTags(source.tags).slice(0, RESEARCH_LIMITS.tags),
      summary: source.summary?.slice(0, RESEARCH_LIMITS.summary) || null,
      author: source.author?.slice(0, RESEARCH_LIMITS.author) || null,
      author_type: isAuthorType(source.author_type) ? source.author_type : null,
    });
    sourceIds.add(source.id);
  }
  // The uploaded object has to be there, or the source would point at nothing.
  for (let i = 0; i < imageChecks.length; i += 8) {
    await Promise.all(
      imageChecks.slice(i, i + 8).map(async ({ id, path }) => {
        const { data, error } = await db.storage.from("images").list(`${userId}/${id}`);
        if (error || !data?.some((f) => f.name === path.slice(path.lastIndexOf("/") + 1))) {
          throw bad("An image in the file wasn't uploaded.");
        }
      }),
    );
  }

  // --- X posts ----------------------------------------------------------------------------
  await checkNew(
    db,
    "x_posts",
    xPosts.map((p) => p.id),
    "X post",
  );
  await requireSources(
    xPosts.map((p) => p.source_id),
    "An X post belongs to a source that isn't in this project.",
  );
  const postSource = new Map(xPosts.map((p) => [p.id, p.source_id]));
  const outsideParents = [
    ...new Set(
      xPosts
        .map((p) => p.parent_id)
        .filter((id): id is string => id !== null && !postSource.has(id)),
    ),
  ];
  for (const row of await fetchByIds(db, "x_posts", "id, item_id", outsideParents, {
    eq: { user_id: userId },
  })) {
    postSource.set(String(row.id), String(row.item_id));
  }
  for (const post of xPosts) {
    if (post.parent_id === null) continue;
    const parentSource = postSource.get(post.parent_id);
    if (parentSource === undefined)
      throw bad("An X post replies to a post that isn't in this project.");
    if (parentSource !== post.source_id) {
      throw bad("An X post replies to a post that isn't in the same thread.");
    }
  }

  // --- Highlights -------------------------------------------------------------------------
  await checkNew(
    db,
    "highlights",
    highlights.map((h) => h.id),
    "highlight",
  );
  await requireSources(
    highlights.map((h) => h.source_id),
    "A highlight belongs to a source that isn't in this project.",
  );
  for (const h of highlights) {
    if (h.end_offset < h.start_offset) throw bad("A highlight ends before it starts.");
  }
  const highlightSource = new Map(highlights.map((h) => [h.id, h.source_id]));

  // --- Outline sections and cards ---------------------------------------------------------
  await checkNew(
    db,
    "outline_sections",
    sections.map((s) => s.id),
    "outline section",
  );
  const sectionIds = new Set(sections.map((s) => s.id));
  await checkNew(
    db,
    "cards",
    cards.map((c) => c.id),
    "card",
  );
  await requireSources(
    cards.map((c) => c.source_id).filter((id): id is string => id !== null),
    "A card comes from a source that isn't in this project.",
  );
  const outsideHighlights = [
    ...new Set(
      cards
        .map((c) => c.highlight_id)
        .filter((id): id is string => id !== null && !highlightSource.has(id)),
    ),
  ];
  for (const row of await fetchByIds(db, "highlights", "id, item_id", outsideHighlights, {
    eq: { user_id: userId },
  })) {
    highlightSource.set(String(row.id), String(row.item_id));
  }
  await requireSources(
    outsideHighlights.filter((id) => highlightSource.has(id)).map((id) => highlightSource.get(id)!),
    "A card comes from a highlight that isn't in this project.",
  );
  const outsideSections = [
    ...new Set(
      cards
        .map((c) => c.section_id)
        .filter((id): id is string => id !== null && !sectionIds.has(id)),
    ),
  ];
  for (const row of await fetchByIds(db, "outline_sections", "id", outsideSections, {
    eq: { user_id: userId, project_id: projectId },
  })) {
    sectionIds.add(String(row.id));
  }
  for (const card of cards) {
    if (card.highlight_id !== null && !highlightSource.has(card.highlight_id)) {
      throw bad("A card comes from a highlight that isn't in this project.");
    }
    if (card.section_id !== null && !sectionIds.has(card.section_id)) {
      throw bad("A card is in an outline section that isn't in this project.");
    }
    if (card.seconds !== null && card.end_seconds !== null && card.end_seconds < card.seconds) {
      throw bad("A card ends before it starts.");
    }
  }

  // --- Save -------------------------------------------------------------------------------
  const groupLevels = byDepth(
    groups,
    (g) => g.parent_id,
    () => 0,
  );
  for (const level of groupLevels) {
    await insertRows(
      db,
      "folders",
      level.map((g) => ({
        id: g.id,
        user_id: userId,
        parent_id: g.parent_id ?? projectId,
        name: clean(g.name, 200, "Untitled group"),
        position: int(g.position),
        created_at: isoDate(g.created_at),
      })),
    );
  }
  await insertRows(db, "items", sourceRows);

  const postLevels = byDepth(
    xPosts,
    (p) => p.parent_id,
    () => 0,
  );
  for (const level of postLevels) {
    await insertRows(
      db,
      "x_posts",
      level.map((p): TablesInsert<"x_posts"> => ({
        id: p.id,
        user_id: userId,
        item_id: p.source_id,
        parent_id: p.parent_id,
        post_url: p.post_url,
        canonical_url: p.canonical_url,
        author_name: p.author_name,
        handle: p.handle.replace(/^@/, ""),
        author_url: p.author_url,
        posted_at: p.posted_at === null ? null : isoDate(p.posted_at, "") || null,
        text: p.text,
        media: normalizeXMedia(p.media) as unknown as Json,
        position: int(p.position),
        created_at: isoDate(p.created_at),
      })),
    );
  }

  await insertRows(
    db,
    "highlights",
    highlights.map((h): TablesInsert<"highlights"> => ({
      id: h.id,
      user_id: userId,
      item_id: h.source_id,
      kind: h.kind,
      quote: h.quote.slice(0, 10_000),
      prefix: h.prefix.slice(0, 64),
      suffix: h.suffix.slice(0, 64),
      start_offset: h.start_offset,
      end_offset: h.end_offset,
      image_src: h.image_src,
      note: h.note?.slice(0, 5000) ?? null,
      seconds: h.seconds,
      cited: h.cited as Json,
      created_at: isoDate(h.created_at),
    })),
  );
  await insertRows(
    db,
    "outline_sections",
    sections.map((s): TablesInsert<"outline_sections"> => ({
      id: s.id,
      user_id: userId,
      project_id: projectId,
      title: clean(s.title, 200, "Untitled section"),
      position: s.position,
      created_at: isoDate(s.created_at),
    })),
  );
  await insertRows(
    db,
    "cards",
    cards.map((c): TablesInsert<"cards"> => ({
      id: c.id,
      user_id: userId,
      project_id: projectId,
      kind: c.kind,
      item_id: c.source_id,
      highlight_id: c.highlight_id,
      quote: c.quote.slice(0, 10_000),
      seconds: c.seconds,
      end_seconds: c.end_seconds,
      url: c.url?.slice(0, 2000) ?? null,
      note: c.note?.slice(0, 5000) ?? null,
      script_line: c.script_line?.slice(0, 5000) ?? null,
      section_id: c.section_id,
      position: c.position,
      created_at: isoDate(c.created_at),
    })),
  );

  return { name, done: body.done === true };
}
