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

// The `project` guard on tools that change things: the model names the project it means to change,
// and anything found outside it is refused before it is touched. It makes the call say where it
// acts, and makes a mixed-up id harmless.

export const PROJECT_GUARD_DESCRIPTION =
  "Name or id of the project you mean to change. When given, anything outside that project is refused and left untouched. Pass it whenever the user has asked you to keep away from other projects.";

/** The project a `project` guard names, by id or by its exact name (case doesn't matter). */
export function resolveProject(index: FolderIndex, nameOrId: string): Folder {
  const byId = index.byId.get(nameOrId);
  if (byId) {
    if (isProject(byId)) return byId;
    throw new Error(
      `${nameOrId} is the group ${index.pathOf(nameOrId)}, not a project. Give the project's name or id.`,
    );
  }
  const wanted = nameOrId.trim().toLowerCase();
  const projects = index.children(null);
  const named = projects.filter((p) => p.name.trim().toLowerCase() === wanted);
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    throw new Error(
      `Several projects are named "${nameOrId}": ${named.map((p) => `[${p.id}]`).join(", ")}. Give the project's id instead.`,
    );
  }
  throw new Error(
    `No project is named "${nameOrId}". The projects are: ${projects.map((p) => `"${p.name}" [${p.id}]`).join(", ")}.`,
  );
}

/** Throws unless `folderId` is the project or inside it. `what` starts the message. */
export function requireInProject(
  index: FolderIndex,
  project: Folder | null,
  folderId: string,
  what: string,
): void {
  if (!project || index.projectOf(folderId)?.id === project.id) return;
  const where = index.byId.has(folderId) ? `in ${index.pathOf(folderId)}` : "in another project";
  throw new Error(
    `${what} is ${where}, outside the project "${project.name}", so it was left untouched.`,
  );
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
