import "server-only";
import { DriveAuthError } from "./oauth";

export class DriveApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

export async function createFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<{ id: string; parents?: string[] }> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("fields", "id,parents");

  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    body.parents = [parentId];
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveAuthError("Google Drive authorization expired or invalid.");
    }
    let errorMsg = `Google Drive error (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      errorMsg = errJson.error?.message || errorMsg;
    } catch {
      // Non-JSON error
    }
    throw new DriveApiError(res.status, errorMsg);
  }

  return (await res.json()) as { id: string; parents?: string[] };
}

export async function updateFile(
  token: string,
  id: string,
  updates: {
    name?: string;
    addParents?: string;
    removeParents?: string;
    trashed?: boolean;
  },
): Promise<{ id: string; parents?: string[] }> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,parents");
  if (updates.addParents) {
    url.searchParams.set("addParents", updates.addParents);
  }
  if (updates.removeParents) {
    url.searchParams.set("removeParents", updates.removeParents);
  }

  const body: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    body.name = updates.name;
  }
  if (updates.trashed !== undefined) {
    body.trashed = updates.trashed;
  }

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveAuthError("Google Drive authorization expired or invalid.");
    }
    let errorMsg = `Google Drive error (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      errorMsg = errJson.error?.message || errorMsg;
    } catch {
      // Non-JSON error
    }
    throw new DriveApiError(res.status, errorMsg);
  }

  return (await res.json()) as { id: string; parents?: string[] };
}

export async function getFile(
  token: string,
  id: string,
): Promise<{ id: string; parents: string[]; trashed: boolean } | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,parents,trashed");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveAuthError("Google Drive authorization expired or invalid.");
    }
    let errorMsg = `Google Drive error (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      errorMsg = errJson.error?.message || errorMsg;
    } catch {
      // Non-JSON error
    }
    throw new DriveApiError(res.status, errorMsg);
  }

  const data = (await res.json()) as { id: string; parents?: string[]; trashed?: boolean };
  return {
    id: data.id,
    parents: data.parents ?? [],
    trashed: Boolean(data.trashed),
  };
}

export async function uploadFile(
  token: string,
  options: {
    id?: string;
    name: string;
    parentId?: string;
    mimeType: string;
    body: string | Uint8Array;
    addParents?: string;
    removeParents?: string;
  },
): Promise<{ id: string; parents?: string[] }> {
  const boundary = `-------SourcefoldUpload${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  const metadata: Record<string, unknown> = {
    name: options.name,
  };
  if (!options.id && options.parentId) {
    metadata.parents = [options.parentId];
  }

  const isUpdating = Boolean(options.id);
  const url = isUpdating
    ? new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(options.id!)}`)
    : new URL("https://www.googleapis.com/upload/drive/v3/files");

  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,parents");
  if (options.addParents) {
    url.searchParams.set("addParents", options.addParents);
  }
  if (options.removeParents) {
    url.searchParams.set("removeParents", options.removeParents);
  }

  const metadataJson = JSON.stringify(metadata);
  const part1 = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`;
  const part2Header = `--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`;
  const part2Footer = `\r\n--${boundary}--\r\n`;

  const part1Buffer = Buffer.from(part1, "utf-8");
  const part2HeaderBuffer = Buffer.from(part2Header, "utf-8");
  const part2BodyBuffer =
    typeof options.body === "string"
      ? Buffer.from(options.body, "utf-8")
      : Buffer.from(options.body.buffer, options.body.byteOffset, options.body.byteLength);
  const part2FooterBuffer = Buffer.from(part2Footer, "utf-8");

  const fullBody = Buffer.concat([
    part1Buffer,
    part2HeaderBuffer,
    part2BodyBuffer,
    part2FooterBuffer,
  ]);

  const res = await fetch(url.toString(), {
    method: isUpdating ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: fullBody,
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new DriveAuthError("Google Drive authorization expired or invalid.");
    }
    let errorMsg = `Google Drive upload error (${res.status})`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      errorMsg = errJson.error?.message || errorMsg;
    } catch {
      // Non-JSON error
    }
    throw new DriveApiError(res.status, errorMsg);
  }

  return (await res.json()) as { id: string; parents?: string[] };
}
