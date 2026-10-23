import type { ProjectFileApi } from "@sourcefold/core/project-file";

// How the website reaches `/api` for a project file: same-origin fetch with the browser session.

async function failure(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return new Error(body.error.message);
  } catch {
    // Not JSON; fall through.
  }
  return new Error(`The request failed (${res.status}).`);
}

export function createWebProjectFileApi(signal?: AbortSignal): ProjectFileApi {
  return {
    async json<T>(path: string, init?: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
      const hasBody = init?.body !== undefined;
      const res = await fetch(`/api${path}`, {
        method: init?.method ?? "GET",
        headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        body: hasBody ? JSON.stringify(init.body) : undefined,
        signal,
      });
      if (!res.ok) throw await failure(res);
      const json = (await res.json()) as { data: T };
      return json.data;
    },
    async bytes(path: string): Promise<Uint8Array> {
      const res = await fetch(`/api${path}`, { signal });
      if (!res.ok) throw await failure(res);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
