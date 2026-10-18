import type { Folder, Item } from "../types";
import type { WebApi } from "../web-api";
import { ApiError } from "../web-api";
import { indexFolders, type FolderIndex } from "./format";

// Loaders and checks shared by the library, organizing, notes and image tools.

/** What `GET /api/folders` sends: a project also carries `archived`, every folder `item_count`. */
type FolderWire = Folder & { archived?: boolean };

/** Every folder of the account, archived projects included, indexed. */
export async function loadFolderIndex(api: WebApi): Promise<FolderIndex> {
  const folders = await api.get<FolderWire[]>("/folders", { query: { includeArchived: true } });
  return indexFolders(Array.isArray(folders) ? folders : []);
}

export function isProject(folder: Folder): boolean {
  return !folder.parent_id;
}

/** True for an archived project and for any group inside one. */
export function isArchived(index: FolderIndex, folder: Folder): boolean {
  const project = index.projectOf(folder.id) as FolderWire | null;
  return Boolean(project && (project.archived === true || project.archived_at));
}

export async function loadFolderItems(api: WebApi, folderId: string): Promise<Item[]> {
  const items = await api.get<Item[]>("/items", { query: { folder: folderId } });
  return Array.isArray(items) ? items : [];
}

/** Runs `fn` over `values`, at most `limit` at a time; results keep the order of `values`. */
export async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await fn(values[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

export function noFolderMessage(id: string, what = "group"): string {
  return `No ${what} with id ${id}. Use list_projects and get_project_tree to find ids.`;
}

/** The folder, or an error that says what to do. `kind` "group" accepts only groups. */
export function requireFolder(
  index: FolderIndex,
  id: string,
  kind: "project" | "group" | "any" = "any",
): Folder {
  const folder = index.byId.get(id);
  if (!folder) {
    throw new Error(noFolderMessage(id, kind === "any" ? "project or group" : kind));
  }
  if (kind === "project" && !isProject(folder)) {
    const project = index.projectOf(id);
    throw new Error(
      `${id} is a group (${index.pathOf(id)}), not a project.` +
        (project ? ` Its project is "${project.name}" [${project.id}].` : ""),
    );
  }
  if (kind === "group" && isProject(folder)) {
    throw new Error(
      `${id} is the project "${folder.name}", and sources can't live directly in a project. Use get_project_tree to pick one of its groups, or create_group to make one.`,
    );
  }
  return folder;
}

/** Adds a hint to "not found" answers from the web app. Other errors pass through unchanged. */
export function withHint(err: unknown, hint: string): Error {
  if (err instanceof ApiError && (err.status === 404 || /no longer exists/i.test(err.message))) {
    return new ApiError(err.status, `${err.message} ${hint}`, err.code);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** `3 groups · 12 sources` style counts for a folder. */
export function sourcesIn(folder: Folder): number {
  return typeof folder.item_count === "number" ? folder.item_count : 0;
}
