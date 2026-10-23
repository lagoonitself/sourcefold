import {
  exportProjectViaApi,
  importProjectViaApi,
  projectFileName,
  readProjectFile,
  summarizeProjectFile,
  type ProjectFileApi,
  type ProjectFileContents,
  type ProjectFileProgress,
  type ProjectFileSummary,
  type SkippedSource,
} from "@sourcefold/core/project-file";
import { shouldUseTauri } from "@/lib/api";
import {
  getRemoteConfig,
  isSessionExpiredError,
  remoteFetch,
  SessionExpiredError,
} from "@/lib/remote-client";

// Download and import a project file (docs/PROJECT-FILE.md). Offline, Rust reads and writes the
// local database and the files on disk. Signed in, the webview talks to the web API with the
// shared code in @sourcefold/core and Rust only reads or writes the file the user picked.

const FILTERS = [{ name: "Sourcefold project", extensions: ["sourcefold", "zip"] }];

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** The signed-in web API, as the shared export and import code wants it. */
function remoteProjectFileApi(signal: AbortSignal): ProjectFileApi {
  return {
    json<T>(path: string, init?: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
      return remoteFetch<T>(`/api${path}`, {
        method: init?.method ?? "GET",
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal,
      });
    },
    async bytes(path: string): Promise<Uint8Array> {
      const { remoteApiUrl, apiToken } = getRemoteConfig();
      const endpoint = `/api${path}`;
      const res = await fetch(`${remoteApiUrl.replace(/\/+$/, "")}${endpoint}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal,
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      if (res.status === 401) {
        // remoteFetch signs the session out and tells the app when the token is the problem.
        try {
          await remoteFetch<unknown>(endpoint, { signal });
        } catch (err) {
          if (isSessionExpiredError(err)) throw err;
        }
        throw new SessionExpiredError();
      }
      const body = await res.json().catch(() => null);
      const message = body?.error?.message ?? body?.message;
      throw new Error(
        typeof message === "string" && message ? message : `The request failed (${res.status}).`,
      );
    },
  };
}

/** Asks where to save the file. Null when the user cancels. */
export async function chooseExportPath(projectName: string): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  return await save({ defaultPath: projectFileName(projectName), filters: FILTERS });
}

/** Asks which file to import. Null when the user cancels. */
export async function chooseImportPath(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, filters: FILTERS });
  return typeof picked === "string" ? picked : null;
}

export interface ExportOutcome {
  skipped: SkippedSource[];
}

export interface RunOptions {
  signal: AbortSignal;
  onProgress: (progress: ProjectFileProgress) => void;
}

export async function exportProjectFile(
  projectId: string,
  path: string,
  { signal, onProgress }: RunOptions,
): Promise<ExportOutcome> {
  if (shouldUseTauri()) {
    const report = await tauriInvoke<{ file_name: string; skipped: SkippedSource[] }>(
      "project_file_export",
      { projectId, path },
    );
    return { skipped: report.skipped };
  }

  const result = await exportProjectViaApi(remoteProjectFileApi(signal), projectId, {
    app: "Sourcefold desktop",
    signal,
    onProgress,
  });
  signal.throwIfAborted();
  const bytes = new Uint8Array(
    await new Blob(result.chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer(),
  );
  // Raw bytes go as the request body; the path rides in a header (commands/project_file.rs).
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("project_file_write", bytes, {
    headers: { "x-project-file-path": encodeURIComponent(path) },
  });
  return { skipped: result.skipped };
}

/** A file picked for import, checked and ready to preview. */
export type OpenedProjectFile =
  | { mode: "offline"; path: string; summary: ProjectFileSummary }
  | { mode: "remote"; path: string; summary: ProjectFileSummary; contents: ProjectFileContents };

/** Reads and checks the whole file before anything is imported. Throws with the reason it can't. */
export async function openProjectFile(path: string): Promise<OpenedProjectFile> {
  if (shouldUseTauri()) {
    const summary = await tauriInvoke<ProjectFileSummary>("project_file_inspect", { path });
    return { mode: "offline", path, summary };
  }
  const data = await tauriInvoke<ArrayBuffer>("project_file_read", { path });
  const contents = readProjectFile(new Uint8Array(data));
  return {
    mode: "remote",
    path,
    summary: summarizeProjectFile(contents.manifest, contents.bytes),
    contents,
  };
}

export interface ImportOutcome {
  projectId: string;
  name: string;
  skipped: SkippedSource[];
}

export async function importProjectFile(
  file: OpenedProjectFile,
  { signal, onProgress }: RunOptions,
): Promise<ImportOutcome> {
  if (file.mode === "offline") {
    const report = await tauriInvoke<{
      project_id: string;
      name: string;
      skipped: SkippedSource[];
    }>("project_file_import", { path: file.path });
    return { projectId: report.project_id, name: report.name, skipped: report.skipped };
  }
  return await importProjectViaApi(remoteProjectFileApi(signal), file.contents, {
    signal,
    onProgress,
  });
}

/** Offline the work happens in one Rust call, which can't be stopped part way. */
export function canCancel(): boolean {
  return !shouldUseTauri();
}
