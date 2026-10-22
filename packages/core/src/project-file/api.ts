// Export and import a project through the Sourcefold web API (docs/PROJECT-FILE.md, "Over the
// web API"). The website and the signed-in desktop app both run this; the offline desktop app
// does the same in Rust. The routes are in apps/web/src/app/api/projects/[id]/export and
// …/import, apps/web/src/app/api/items/[id]/media and apps/web/src/app/api/uploads/sign.

import { bodyFromDriveFile } from "../drive-file";
import { markdownImageUrls } from "../post-images";
import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileError,
  type ProjectFileCard,
  type ProjectFileGroup,
  type ProjectFileHighlight,
  type ProjectFileManifest,
  type ProjectFileOutlineSection,
  type ProjectFileSource,
  type ProjectFileXPost,
} from "./manifest";
import { projectFilePaths, projectFileMediaType } from "./paths";
import { groupsParentsFirst, remapProjectIds } from "./remap";
import { ProjectFileWriter, mediaInFolder, textOf, type ProjectFileContents } from "./zip";

// ---------------------------------------------------------------------------------------------
// The route contract

/** Tables `GET /api/projects/{id}/export?table=…&from=…` pages through. */
export const PROJECT_EXPORT_TABLES = [
  "groups",
  "sources",
  "x_posts",
  "highlights",
  "outline_sections",
  "cards",
] as const;
export type ProjectExportTable = (typeof PROJECT_EXPORT_TABLES)[number];

/** A source as the export route returns it: the manifest row without paths. */
export type ProjectExportSource = Omit<ProjectFileSource, "file" | "media_folder"> & {
  /** `md`, or the image's extension for `image` sources. */
  extension: string;
  /** False when the source has no saved file (a failed capture, an empty note). */
  has_file: boolean;
};

export interface ProjectExportRowsByTable {
  groups: ProjectFileGroup;
  sources: ProjectExportSource;
  x_posts: ProjectFileXPost;
  highlights: ProjectFileHighlight;
  outline_sections: ProjectFileOutlineSection;
  cards: ProjectFileCard;
}

/** `{ data }` of the export route. `next` is the `from` for the next page, null at the end. */
export interface ProjectExportPage<T extends ProjectExportTable> {
  project: { id: string; name: string; created_at: string };
  rows: ProjectExportRowsByTable[T][];
  next: number | null;
}

/** `{ data }` of `GET /api/items/{id}/media`: the files in the post's `_files` folder in Drive. */
export interface ItemMediaList {
  files: { name: string; size: number; too_large: boolean }[];
}

/** A source in `POST /api/projects/{id}/import`. */
export type ProjectImportSource = Omit<ProjectFileSource, "file" | "media_folder"> & {
  /** The body (what `items.markdown` holds); null for images and sources without a file. */
  markdown: string | null;
  /** Image sources: where the image was uploaded with `POST /api/uploads/sign`. */
  storage_path: string | null;
};

/**
 * Body of `POST /api/projects/{id}/import`, `{id}` being the new project's id (made by the
 * client). The first call carries `project` and creates it; later calls add rows to it. Rows
 * already have their new ids, and every reference points at a row sent in this call or earlier.
 * The last call has `done: true`, which starts the Drive push.
 */
export interface ProjectImportRequest {
  project?: { name: string };
  groups?: ProjectFileGroup[];
  sources?: ProjectImportSource[];
  x_posts?: ProjectFileXPost[];
  highlights?: ProjectFileHighlight[];
  outline_sections?: ProjectFileOutlineSection[];
  cards?: ProjectFileCard[];
  done?: boolean;
}

/** `{ data }` of the import route: the project's name as created ("Cars (2)" if "Cars" was taken). */
export interface ProjectImportResponse {
  name: string;
}

/** Body of `POST /api/uploads/sign` (`item_id` lets the import keep the id it chose). */
export interface UploadSignRequest {
  folder_id: string;
  file_name: string;
  mime_type: string;
  size: number;
  item_id?: string;
}

export interface UploadSignResponse {
  item_id: string;
  storage_path: string;
  signed_url: string;
  apikey: string | null;
}

/** Image types `POST /api/uploads/sign` accepts, and its size cap. */
export const UPLOADABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const UPLOADABLE_IMAGE_BYTES = 10 * 1024 * 1024;

/** Vercel refuses request bodies over 4.5 MB; import batches stay under this. */
export const IMPORT_BATCH_BYTES = 3_500_000;

// ---------------------------------------------------------------------------------------------
// Talking to the API

/**
 * How the caller reaches `/api`. The website passes same-origin `fetch`; the desktop passes its
 * signed-in remote client. Paths start with `/` and leave out `/api`.
 */
export interface ProjectFileApi {
  /** A JSON request; resolves to the response's `data`, throws an Error with its message. */
  json<T>(path: string, init?: { method: "GET" | "POST"; body?: unknown }): Promise<T>;
  /** A GET whose answer is a file (Markdown or image bytes). */
  bytes(path: string): Promise<Uint8Array>;
  /** Uploads to a signed Storage URL. Defaults to `fetch` with the request supabase-js makes. */
  putSigned?(signed: UploadSignResponse, data: Uint8Array, mimeType: string): Promise<void>;
}

export interface ProjectFileProgress {
  phase: "reading" | "files" | "packing" | "uploading" | "saving";
  done: number;
  total: number;
}

export interface SkippedSource {
  title: string;
  reason: string;
}

export interface ProjectFileRunOptions {
  onProgress?: (progress: ProjectFileProgress) => void;
  signal?: AbortSignal;
}

const CONCURRENCY = 4;

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  run: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      signal?.throwIfAborted();
      const index = next++;
      await run(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------------------------
// Export

export interface ProjectExportResult {
  /** The zip, in pieces: `new Blob(chunks, { type: "application/zip" })`. */
  chunks: Uint8Array[];
  /** "Cars.sourcefold" */
  fileName: string;
  manifest: ProjectFileManifest;
  /** Sources whose file couldn't be read; they're in the file without their text. */
  skipped: SkippedSource[];
}

async function loadTable<T extends ProjectExportTable>(
  api: ProjectFileApi,
  projectId: string,
  table: T,
  signal: AbortSignal | undefined,
): Promise<ProjectExportPage<T>> {
  const rows: ProjectExportRowsByTable[T][] = [];
  let from: number | null = 0;
  let project: ProjectExportPage<T>["project"] | null = null;
  while (from !== null) {
    signal?.throwIfAborted();
    const page: ProjectExportPage<T> = await api.json<ProjectExportPage<T>>(
      `/projects/${encodeURIComponent(projectId)}/export?table=${table}&from=${from}`,
    );
    project = page.project;
    rows.push(...page.rows);
    from = page.next;
  }
  return { project: project!, rows, next: null };
}

export async function exportProjectViaApi(
  api: ProjectFileApi,
  projectId: string,
  options: ProjectFileRunOptions & { app: string },
): Promise<ProjectExportResult> {
  const { onProgress, signal } = options;
  onProgress?.({ phase: "reading", done: 0, total: PROJECT_EXPORT_TABLES.length });
  const groups = await loadTable(api, projectId, "groups", signal);
  onProgress?.({ phase: "reading", done: 1, total: PROJECT_EXPORT_TABLES.length });
  const sources = await loadTable(api, projectId, "sources", signal);
  onProgress?.({ phase: "reading", done: 2, total: PROJECT_EXPORT_TABLES.length });
  const xPosts = await loadTable(api, projectId, "x_posts", signal);
  onProgress?.({ phase: "reading", done: 3, total: PROJECT_EXPORT_TABLES.length });
  const highlights = await loadTable(api, projectId, "highlights", signal);
  onProgress?.({ phase: "reading", done: 4, total: PROJECT_EXPORT_TABLES.length });
  const sections = await loadTable(api, projectId, "outline_sections", signal);
  onProgress?.({ phase: "reading", done: 5, total: PROJECT_EXPORT_TABLES.length });
  const cards = await loadTable(api, projectId, "cards", signal);
  onProgress?.({ phase: "reading", done: 6, total: PROJECT_EXPORT_TABLES.length });

  const project = groups.project;
  const paths = projectFilePaths(project.name, groups.rows, sources.rows);
  const postsWithMedia = new Set(
    xPosts.rows.filter((p) => Array.isArray(p.media) && p.media.length > 0).map((p) => p.source_id),
  );

  const writer = new ProjectFileWriter();
  const skipped: SkippedSource[] = [];
  const fileOf = new Map<string, string | null>();
  const mediaOf = new Map<string, string | null>();
  let done = 0;
  const withFiles = sources.rows.filter((s) => s.has_file);
  onProgress?.({ phase: "files", done, total: withFiles.length });

  await eachLimited(withFiles, CONCURRENCY, signal, async (source) => {
    const spot = paths.get(source.id)!;
    try {
      const data = await api.bytes(`/items/${encodeURIComponent(source.id)}/content`);
      writer.add(spot.file, data);
      fileOf.set(source.id, spot.file);

      const hasImages =
        source.kind !== "image" &&
        (postsWithMedia.has(source.id) || markdownImageUrls(textOf(data)).length > 0);
      if (hasImages) {
        const list = await api.json<ItemMediaList>(`/items/${encodeURIComponent(source.id)}/media`);
        let copied = 0;
        for (const file of list.files) {
          if (file.too_large || projectFileMediaType(file.name) === null) continue;
          const path = `${spot.media_folder}/${file.name}`;
          if (writer.has(path)) continue;
          try {
            const bytes = await api.bytes(
              `/items/${encodeURIComponent(source.id)}/media/${encodeURIComponent(file.name)}`,
            );
            writer.add(path, bytes);
            copied += 1;
          } catch {
            // The Markdown still links to the web copy of the image.
          }
        }
        if (copied > 0) mediaOf.set(source.id, spot.media_folder);
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      skipped.push({ title: source.title, reason: errorText(err) });
    }
    done += 1;
    onProgress?.({ phase: "files", done, total: withFiles.length });
  });

  onProgress?.({ phase: "packing", done: 0, total: 1 });
  const manifest: ProjectFileManifest = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    exported_at: new Date().toISOString(),
    app: options.app,
    project,
    groups: groups.rows,
    sources: sources.rows.map(({ extension: _extension, has_file: _hasFile, ...source }) => ({
      ...source,
      file: fileOf.get(source.id) ?? null,
      media_folder: mediaOf.get(source.id) ?? null,
    })),
    x_posts: xPosts.rows,
    highlights: highlights.rows,
    outline_sections: sections.rows,
    cards: cards.rows,
  };
  const chunks = await writer.finish(manifest);
  onProgress?.({ phase: "packing", done: 1, total: 1 });
  return { chunks, fileName: projectFileName(project.name), manifest, skipped };
}

/** "Cars" → "Cars.sourcefold", with characters file systems reject taken out. */
export function projectFileName(projectName: string): string {
  const base = projectName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return `${base || "Project"}.sourcefold`;
}

// ---------------------------------------------------------------------------------------------
// Import

export interface ProjectImportResult {
  projectId: string;
  name: string;
  skipped: SkippedSource[];
}

async function defaultPutSigned(
  signed: UploadSignResponse,
  data: Uint8Array,
  mimeType: string,
): Promise<void> {
  // The same request supabase-js makes for uploadToSignedUrl with a Blob.
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeType }));
  const headers: Record<string, string> = { "x-upsert": "false" };
  if (signed.apikey) headers.apikey = signed.apikey;
  const res = await fetch(signed.signed_url, { method: "PUT", headers, body: form });
  if (!res.ok) throw new Error(`The image upload failed (${res.status}).`);
}

function jsonSize(value: unknown): number {
  // UTF-16 length is close enough to the UTF-8 size for text that's mostly ASCII; doubled to be safe
  // for the rest.
  const s = JSON.stringify(value);
  return s.length + (s.length - s.replace(/[^\x00-\x7f]/g, "").length);
}

/** Splits rows into batches whose JSON stays under `limit` bytes. */
export function batchBySize<T>(rows: readonly T[], limit: number, maxRows = 500): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const row of rows) {
    const rowSize = jsonSize(row) + 1;
    if (current.length > 0 && (size + rowSize > limit || current.length >= maxRows)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += rowSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function importProjectViaApi(
  api: ProjectFileApi,
  contents: ProjectFileContents,
  options: ProjectFileRunOptions = {},
): Promise<ProjectImportResult> {
  const { onProgress, signal } = options;
  const { manifest } = remapProjectIds(contents.manifest);
  const projectId = manifest.project.id;
  const importPath = `/projects/${encodeURIComponent(projectId)}/import`;
  const post = (body: ProjectImportRequest) =>
    api.json<ProjectImportResponse>(importPath, { method: "POST", body });
  const putSigned = api.putSigned ?? defaultPutSigned;
  const skipped: SkippedSource[] = [];

  // 1. The project and its groups, parents first.
  const groups = groupsParentsFirst(manifest.groups);
  const groupBatches = batchBySize(groups, IMPORT_BATCH_BYTES);
  const created = await post({ project: { name: manifest.project.name }, groups: groupBatches[0] ?? [] });
  for (const batch of groupBatches.slice(1)) {
    signal?.throwIfAborted();
    await post({ groups: batch });
  }

  // 2. Image sources: upload each to Storage first, under the id the import gave it.
  const dropped = new Set<string>();
  const storagePath = new Map<string, string>();
  const images = manifest.sources.filter((s) => s.kind === "image" && s.file !== null);
  let uploaded = 0;
  onProgress?.({ phase: "uploading", done: 0, total: images.length });
  await eachLimited(images, CONCURRENCY, signal, async (source) => {
    const data = contents.entries.get(source.file!)!;
    const mimeType = projectFileMediaType(source.file!) ?? "";
    try {
      if (!UPLOADABLE_IMAGE_TYPES.includes(mimeType)) {
        throw new Error("Only PNG, JPEG, GIF and WebP images can be imported.");
      }
      if (data.byteLength > UPLOADABLE_IMAGE_BYTES) throw new Error("Images can be up to 10 MB.");
      const fileName = source.file!.slice(source.file!.lastIndexOf("/") + 1);
      const signed = await api.json<UploadSignResponse>("/uploads/sign", {
        method: "POST",
        body: {
          folder_id: source.group_id,
          file_name: fileName,
          mime_type: mimeType,
          size: data.byteLength,
          item_id: source.id,
        } satisfies UploadSignRequest,
      });
      await putSigned(signed, data, mimeType);
      storagePath.set(source.id, signed.storage_path);
    } catch (err) {
      if (signal?.aborted) throw err;
      dropped.add(source.id);
      skipped.push({ title: source.title, reason: errorText(err) });
    }
    uploaded += 1;
    onProgress?.({ phase: "uploading", done: uploaded, total: images.length });
  });

  // 3. Sources, with their text.
  const rows: ProjectImportSource[] = [];
  for (const source of manifest.sources) {
    if (dropped.has(source.id)) continue;
    const { file, media_folder: _media, ...row } = source;
    const markdown =
      source.kind !== "image" && file !== null ? bodyFromDriveFile(textOf(contents.entries.get(file)!)) : null;
    const importRow: ProjectImportSource = {
      ...row,
      markdown,
      storage_path: storagePath.get(source.id) ?? null,
    };
    if (jsonSize(importRow) > IMPORT_BATCH_BYTES) {
      dropped.add(source.id);
      skipped.push({ title: source.title, reason: "Its text is too long to import here." });
      continue;
    }
    rows.push(importRow);
  }
  const sourceBatches = batchBySize(rows, IMPORT_BATCH_BYTES, 200);
  let saved = 0;
  onProgress?.({ phase: "saving", done: 0, total: rows.length });
  for (const batch of sourceBatches) {
    signal?.throwIfAborted();
    await post({ sources: batch });
    saved += batch.length;
    onProgress?.({ phase: "saving", done: saved, total: rows.length });
  }

  // 4. What hangs off the sources. Anything tied to a skipped source is left out or unlinked.
  const xPosts = manifest.x_posts.filter((p) => !dropped.has(p.source_id));
  const highlights = manifest.highlights.filter((h) => !dropped.has(h.source_id));
  const keptHighlights = new Set(highlights.map((h) => h.id));
  const cards = manifest.cards.map((c) => ({
    ...c,
    source_id: c.source_id !== null && dropped.has(c.source_id) ? null : c.source_id,
    highlight_id: c.highlight_id !== null && !keptHighlights.has(c.highlight_id) ? null : c.highlight_id,
  }));
  // A quote card always points at a source; one whose source was skipped goes too.
  const keptCards = cards.filter((c) => c.kind === "line" || c.kind === "broll" || c.source_id !== null);

  for (const batch of batchBySize(groupsParentsFirst(xPosts), IMPORT_BATCH_BYTES)) {
    signal?.throwIfAborted();
    await post({ x_posts: batch });
  }
  for (const batch of batchBySize(highlights, IMPORT_BATCH_BYTES)) {
    signal?.throwIfAborted();
    await post({ highlights: batch });
  }
  for (const batch of batchBySize(manifest.outline_sections, IMPORT_BATCH_BYTES)) {
    signal?.throwIfAborted();
    await post({ outline_sections: batch });
  }
  for (const batch of batchBySize(keptCards, IMPORT_BATCH_BYTES)) {
    signal?.throwIfAborted();
    await post({ cards: batch });
  }
  await post({ done: true });

  return { projectId, name: created.name, skipped };
}

/** Throws a `ProjectFileError` unless this looks like a project file name. */
export function assertProjectFileName(name: string): void {
  if (!/\.(sourcefold|zip)$/i.test(name)) {
    throw new ProjectFileError("Choose a .sourcefold project file.");
  }
}
