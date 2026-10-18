import type { Folder } from "@/lib/types";
import type { SearchStatus } from "./search-api";

export interface FolderNames {
  /** The group's name, or "Group" when it is not in the list. */
  groupName: (folderId: string) => string;
  /** The project's name for a project id from the index ("unsorted" is the desktop Unsorted). */
  projectName: (projectId: string) => string;
  /** The top-level project a group sits in, or null when unknown. */
  projectOf: (folderId: string) => string | null;
}

export function buildFolderNames(folders: readonly Folder[]): FolderNames {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const projectOf = (folderId: string): string | null => {
    let current = byId.get(folderId);
    for (let depth = 0; current && depth < 1000; depth++) {
      if (!current.parent_id) return current.id;
      current = byId.get(current.parent_id);
    }
    return null;
  };
  return {
    groupName: (folderId) => byId.get(folderId)?.name ?? "Group",
    projectName: (projectId) =>
      projectId === "unsorted" ? "Unsorted" : (byId.get(projectId)?.name ?? "Project"),
    projectOf,
  };
}

export const LOCAL_COPY_MESSAGE = "Turn on Local copy in Settings to search inside sources.";
export const WEB_UPDATE_MESSAGE = "Update the web app to search inside sources.";

/** A line to show above the results when the index cannot be searched, else null. */
export function indexNotice(status: SearchStatus | null): string | null {
  if (!status) return null;
  switch (status.state) {
    case "needs_local_copy":
      return LOCAL_COPY_MESSAGE;
    case "needs_web_update":
      return WEB_UPDATE_MESSAGE;
    case "error":
      return status.message ?? "Couldn't search inside sources. Try again in a moment.";
    default:
      return null;
  }
}

function sources(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "source" : "sources"}`;
}

/** The footer's two status lines: where the keyword index stands, and the meaning vectors. */
export function footerStatus(
  status: SearchStatus | null,
  meaningEnabled: boolean,
): { index: string | null; meaning: string | null } {
  if (!status || indexNotice(status) !== null) return { index: null, meaning: null };
  const { sources_total: total, sources_indexed: indexed } = status;
  let index: string;
  if (status.state === "indexing" && indexed < total) {
    index = `Indexing ${indexed.toLocaleString("en-US")} of ${sources(total)}`;
  } else if (status.state === "paused") {
    index = `Indexing paused, ${indexed.toLocaleString("en-US")} of ${sources(total)}`;
  } else {
    index = `Searching ${sources(total)}`;
  }
  const vectorsPending =
    meaningEnabled && status.passages_total > 0 && status.passages_embedded < status.passages_total;
  return {
    index,
    meaning: vectorsPending
      ? `Search by meaning: ${status.passages_embedded.toLocaleString("en-US")} of ${status.passages_total.toLocaleString("en-US")} passages`
      : null,
  };
}
