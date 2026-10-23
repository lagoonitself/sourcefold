import { DriveAuthError } from "./errors";

export class DriveApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
  }
}

function isRateLimit403(errJson: unknown): boolean {
  if (typeof errJson !== "object" || errJson === null) return false;
  const error = (errJson as { error?: { errors?: { reason?: string }[]; message?: string } }).error;
  if (!error) return false;
  if (Array.isArray(error.errors)) {
    if (
      error.errors.some(
        (e) => e.reason === "rateLimitExceeded" || e.reason === "userRateLimitExceeded",
      )
    ) {
      return true;
    }
  }
  if (typeof error.message === "string") {
    if (
      error.message.includes("rateLimitExceeded") ||
      error.message.includes("userRateLimitExceeded")
    ) {
      return true;
    }
  }
  return false;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null) {
    const err = (data as { error?: { message?: string } }).error;
    if (err && typeof err.message === "string") {
      return err.message;
    }
  }
  return fallback;
}

async function driveFetch(
  url: string,
  init: RequestInit,
): Promise<{ status: number; ok: boolean; data: unknown; text: string }> {
  const maxRetries = 3;
  const baseDelay = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);

    if (res.status === 401) {
      throw new DriveAuthError("Google Drive authorization expired or invalid.");
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response
    }

    const is5xx = res.status >= 500 && res.status <= 599;
    const is429 = res.status === 429;
    const isRateLimit = res.status === 403 && isRateLimit403(data);

    if ((is429 || is5xx || isRateLimit) && attempt < maxRetries) {
      const jitter = Math.random() * baseDelay;
      const delay = baseDelay * Math.pow(2, attempt) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return { status: res.status, ok: res.ok, data, text };
  }

  throw new Error("Google Drive request failed after retries.");
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

  const res = await driveFetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      extractErrorMessage(res.data, `Google Drive error (${res.status})`),
    );
  }

  return res.data as { id: string; parents?: string[] };
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

  const res = await driveFetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      extractErrorMessage(res.data, `Google Drive error (${res.status})`),
    );
  }

  return res.data as { id: string; parents?: string[] };
}

export async function getFile(
  token: string,
  id: string,
): Promise<{
  id: string;
  name?: string;
  parents: string[];
  trashed: boolean;
  explicitlyTrashed?: boolean;
} | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("fields", "id,name,parents,trashed,explicitlyTrashed");

  const res = await driveFetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      extractErrorMessage(res.data, `Google Drive error (${res.status})`),
    );
  }

  const data = res.data as {
    id: string;
    name?: string;
    parents?: string[];
    trashed?: boolean;
    explicitlyTrashed?: boolean;
  };
  return {
    id: data.id,
    name: data.name,
    parents: data.parents ?? [],
    trashed: Boolean(data.trashed || data.explicitlyTrashed),
    explicitlyTrashed: Boolean(data.explicitlyTrashed),
  };
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function queryString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Files (not trashed) directly inside a folder, optionally only those with one exact name. */
export async function listChildren(
  token: string,
  parentId: string,
  options: { name?: string; foldersOnly?: boolean; mimeType?: string } = {},
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const terms = [`${queryString(parentId)} in parents`, "trashed = false"];
  if (options.name !== undefined) terms.push(`name = ${queryString(options.name)}`);
  if (options.foldersOnly) terms.push(`mimeType = '${FOLDER_MIME}'`);
  if (options.mimeType !== undefined) terms.push(`mimeType = ${queryString(options.mimeType)}`);

  const files: { id: string; name: string; mimeType: string }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", terms.join(" and "));
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await driveFetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new DriveApiError(
        res.status,
        extractErrorMessage(res.data, `Google Drive error (${res.status})`),
      );
    }
    const data = res.data as {
      nextPageToken?: string;
      files?: { id: string; name: string; mimeType: string }[];
    };
    files.push(...(data.files ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

// Returns null when the file no longer exists. Works for trashed files too.
export async function downloadFileText(token: string, id: string): Promise<string | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("alt", "media");

  const res = await driveFetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      extractErrorMessage(res.data, `Google Drive error (${res.status})`),
    );
  }

  return res.text;
}

// Binary-safe download (images). Returns null when the file no longer exists.
export async function downloadFileBytes(token: string, id: string): Promise<Uint8Array | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set("alt", "media");

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    throw new DriveAuthError("Google Drive authorization expired or invalid.");
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response
    }
    throw new DriveApiError(
      res.status,
      extractErrorMessage(data, `Google Drive error (${res.status})`),
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function uploadFile(
  token: string,
  options: {
    id?: string;
    name: string;
    parentId?: string;
    mimeType: string;
    /** Convert the upload into this Google type, e.g. HTML into a Google Doc. */
    convertTo?: string;
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
  if (options.convertTo) {
    metadata.mimeType = options.convertTo;
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

  let mediaMimeType = options.mimeType;
  if (mediaMimeType.startsWith("text/") && !mediaMimeType.toLowerCase().includes("charset")) {
    mediaMimeType += "; charset=UTF-8";
  }

  const metadataJson = JSON.stringify(metadata);
  const part1 = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`;
  const part2Header = `--${boundary}\r\nContent-Type: ${mediaMimeType}\r\n\r\n`;
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

  const res = await driveFetch(url.toString(), {
    method: isUpdating ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: fullBody,
  });

  if (!res.ok) {
    throw new DriveApiError(
      res.status,
      extractErrorMessage(res.data, `Google Drive upload error (${res.status})`),
    );
  }

  return res.data as { id: string; parents?: string[] };
}

// A Google Doc (or Sheet, Slide) in another format, e.g. a .docx. Returns null when the file no
// longer exists. Drive refuses exports over 10 MB.
export async function exportFile(
  token: string,
  id: string,
  mimeType: string,
): Promise<Uint8Array | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export`);
  url.searchParams.set("mimeType", mimeType);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    throw new DriveAuthError("Google Drive authorization expired or invalid.");
  }
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON response
    }
    throw new DriveApiError(
      res.status,
      extractErrorMessage(data, `Google Drive error (${res.status})`),
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
