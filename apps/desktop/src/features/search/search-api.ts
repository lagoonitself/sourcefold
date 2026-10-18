// The desktop search index (docs/handoff-search.md). It always lives on this computer, so these
// calls go to the Rust side in both modes, signed in or offline. One index per project: a project
// search never reads another project's index; "All projects" asks each one and merges.

/** Which model and size the vectors are for. Vectors made with another key are ignored. */
export const EMBEDDING_MODEL_KEY = "embeddinggemma-2/q4/256";
export const EMBEDDING_DIMS = 256;

export type SearchScope = "project" | "all";

export interface SearchQueryArgs {
  query: string;
  scope: SearchScope;
  /** The open project. Required when scope is "project". */
  projectId: string | null;
  /** The query's vector from the embedding worker; without it the search is keywords only. */
  queryVector?: number[] | null;
  model?: string | null;
  limit?: number;
}

/**
 * `snippet` marks each matched word as `\u0002word\u0003` (keyword matches only). The UI splits on
 * these and shows the words in bold; it never renders the snippet as HTML.
 */
export interface PassageHit {
  item_id: string;
  project_id: string;
  folder_id: string;
  title: string;
  kind: string;
  url: string | null;
  /** Headings above the passage, joined with " › ". Empty when there is none. */
  heading: string;
  snippet: string;
  /** The passage's first words (about 12), as plain text, for the reader to find it. */
  passage_start: string;
  /** YouTube: the passage's first timestamp. */
  seconds: number | null;
  /** "keyword", "meaning" (found only by meaning: shows "Similar meaning") or "both". */
  matched: "keyword" | "meaning" | "both";
  score: number;
}

export interface NoteHit {
  item_id: string;
  project_id: string;
  folder_id: string;
  title: string;
  kind: string;
  url: string | null;
  /** "highlight" (from the file's `## My highlights`) or "note" (`## My note`, or a note item). */
  source: "highlight" | "note";
  snippet: string;
  /** The quote or note's first words, for the reader to find it. */
  passage_start: string;
  seconds: number | null;
  matched: "keyword" | "meaning" | "both";
  score: number;
}

export interface SearchResponse {
  passages: PassageHit[];
  notes: NoteHit[];
  /** Whether meaning results are in this answer. */
  meaning: "used" | "off";
  took_ms: number;
}

export type IndexState =
  | "idle"
  | "indexing"
  | "paused"
  /** Signed in with Local copy off: there are no files to read. */
  | "needs_local_copy"
  /** Signed in, but the web app's file list has no project ids yet (deploy the web app). */
  | "needs_web_update"
  | "error";

export interface SearchStatus {
  state: IndexState;
  message: string | null;
  /** Sources in scope (the project given, or every project). */
  sources_total: number;
  sources_indexed: number;
  passages_total: number;
  /** Passages that have a vector for `model` (0 when no model was given). */
  passages_embedded: number;
  /** Size of the index files on disk, all projects. */
  disk_bytes: number;
}

export interface EmbedJob {
  project_id: string;
  text_hash: string;
  /** Ready to embed, prefix included: `title: <title> | text: <passage>`. */
  input: string;
}

export interface EmbedVector {
  project_id: string;
  text_hash: string;
  vector: number[];
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export function searchQuery(args: SearchQueryArgs): Promise<SearchResponse> {
  return tauriInvoke<SearchResponse>("search_query", {
    request: {
      query: args.query,
      scope: args.scope,
      project_id: args.projectId,
      query_vector: args.queryVector ?? null,
      model: args.model ?? null,
      limit: args.limit ?? null,
    },
  });
}

export function getSearchStatus(
  projectId: string | null,
  model: string | null,
): Promise<SearchStatus> {
  return tauriInvoke<SearchStatus>("search_status", { projectId, model });
}

/** Wakes the indexer now (after a save, a local copy pass, or the window gaining focus). */
export function reindexNow(): Promise<void> {
  return tauriInvoke<void>("search_reindex_now");
}

export function setIndexPaused(paused: boolean): Promise<void> {
  return tauriInvoke<void>("search_set_paused", { paused });
}

/** Deletes every project's index (passages and vectors). The indexer then rebuilds the keyword
 * index; vectors come back only if search by meaning is on. */
export function deleteSearchIndex(): Promise<void> {
  return tauriInvoke<void>("search_delete_index");
}

/** Passages without a vector for `model`, the given project's first. */
export function nextEmbedJobs(
  model: string,
  limit: number,
  preferProjectId: string | null,
): Promise<EmbedJob[]> {
  return tauriInvoke<EmbedJob[]>("search_embed_jobs", { model, limit, preferProjectId });
}

export function putEmbeddings(model: string, vectors: EmbedVector[]): Promise<void> {
  return tauriInvoke<void>("search_put_vectors", { model, vectors });
}

/** Removes every stored vector (any model). Passages and the keyword index stay. */
export function deleteEmbeddings(): Promise<void> {
  return tauriInvoke<void>("search_delete_vectors");
}
