import { browser } from "wxt/browser";

const LAST_FOLDER_KEY = "lastFolderId";
const LAST_PROJECT_KEY = "lastProjectId";
const GROUP_BY_PROJECT_KEY = "lastGroupByProject";

export async function getLastFolderId(): Promise<string | null> {
  const result = await browser.storage.local.get([LAST_FOLDER_KEY]);
  const id = result[LAST_FOLDER_KEY];
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function setLastFolderId(folderId: string): Promise<void> {
  await browser.storage.local.set({ [LAST_FOLDER_KEY]: folderId });
}

export async function clearLastFolderId(): Promise<void> {
  await browser.storage.local.remove([LAST_FOLDER_KEY]);
}

/** Where the popup opens: the project the user works in and the group they used last in each. */
export interface LastPlaces {
  groupId: string | null;
  projectId: string | null;
  groupByProject: Record<string, string>;
}

export async function getLastPlaces(): Promise<LastPlaces> {
  const result = await browser.storage.local.get([
    LAST_FOLDER_KEY,
    LAST_PROJECT_KEY,
    GROUP_BY_PROJECT_KEY,
  ]);
  const groupId = result[LAST_FOLDER_KEY];
  const projectId = result[LAST_PROJECT_KEY];
  const groupByProject = result[GROUP_BY_PROJECT_KEY];
  return {
    groupId: typeof groupId === "string" && groupId ? groupId : null,
    projectId: typeof projectId === "string" && projectId ? projectId : null,
    groupByProject:
      groupByProject && typeof groupByProject === "object"
        ? (groupByProject as Record<string, string>)
        : {},
  };
}

/** Remembers the open project and, when there is one, the group picked in it. */
export async function rememberPlace(
  places: LastPlaces,
  projectId: string,
  groupId: string | null,
): Promise<LastPlaces> {
  const next: LastPlaces = {
    projectId,
    groupId: groupId ?? places.groupId,
    groupByProject: groupId
      ? { ...places.groupByProject, [projectId]: groupId }
      : places.groupByProject,
  };
  await browser.storage.local.set({
    [LAST_PROJECT_KEY]: projectId,
    [GROUP_BY_PROJECT_KEY]: next.groupByProject,
    ...(groupId ? { [LAST_FOLDER_KEY]: groupId } : {}),
  });
  return next;
}
