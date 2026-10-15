import "server-only";
import { markdownImageUrls, postImageFileNames, postImagesFolderName } from "@sourcefold/core";
import { createFolder, listChildren, updateFile, uploadFile } from "@/lib/google/drive";

// A copy of each image in a post, in `<file name>_files/` next to its file in Drive
// (docs/FILE-FORMAT.md, "Post images"). The Markdown keeps linking to the web copy.

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const CONCURRENCY = 3;

export interface FileSpot {
  parentId: string;
  fileName: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Only public web addresses: never a bare IP or a local name, so a crafted post can't make the
// server fetch something private.
function isFetchable(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname;
    if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchImage(url: string): Promise<{ body: Uint8Array; mimeType: string } | null> {
  if (!isFetchable(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (mimeType && !mimeType.startsWith("image/") && mimeType !== "application/octet-stream") {
      return null;
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const body = new Uint8Array(await res.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) return null;
    return { body, mimeType: mimeType || "application/octet-stream" };
  } catch {
    // The image is gone or slow; the Markdown still links to it.
    return null;
  }
}

// `groupFolderIds`: Drive folders that are groups. A subgroup that happens to be called
// "<title>_files" is never taken for an image folder.
async function findFolder(
  token: string,
  spot: FileSpot,
  groupFolderIds: ReadonlySet<string>,
): Promise<string | null> {
  const name = postImagesFolderName(spot.fileName);
  const found = await listChildren(token, spot.parentId, { name, foldersOnly: true });
  return found.find((f) => !groupFolderIds.has(f.id))?.id ?? null;
}

async function inBatches<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(run));
  }
}

/**
 * Brings a post's image folder in line with its Markdown: follows a rename or move of the post,
 * uploads images it doesn't have yet, trashes ones the post no longer uses, and trashes the
 * folder when the post has no images. Safe to run again after a partial run.
 */
export async function syncPostImages(
  token: string,
  current: FileSpot,
  previous: FileSpot | null,
  markdown: string,
  groupFolderIds: ReadonlySet<string>,
): Promise<void> {
  const urls = markdownImageUrls(markdown);
  const wantedName = postImagesFolderName(current.fileName);

  let folderId = await findFolder(token, current, groupFolderIds);
  if (
    !folderId &&
    previous &&
    (previous.parentId !== current.parentId || previous.fileName !== current.fileName)
  ) {
    folderId = await findFolder(token, previous, groupFolderIds);
    if (folderId) {
      const moving = previous.parentId !== current.parentId;
      await updateFile(token, folderId, {
        name: wantedName,
        addParents: moving ? current.parentId : undefined,
        removeParents: moving ? previous.parentId : undefined,
      });
    }
  }

  if (urls.length === 0) {
    if (folderId) await updateFile(token, folderId, { trashed: true });
    return;
  }

  if (!folderId) {
    folderId = (await createFolder(token, wantedName, current.parentId)).id;
  }
  const parentId = folderId;

  const names = postImageFileNames(urls);
  const wanted = new Map(names.map((name, i) => [name, urls[i]!]));
  const existing = await listChildren(token, parentId);
  const have = new Set(existing.map((f) => f.name));

  // Only image files Sourcefold put there are removed; anything else in the folder stays.
  await inBatches(
    existing.filter((f) => f.mimeType !== FOLDER_MIME && !wanted.has(f.name)),
    async (f) => {
      await updateFile(token, f.id, { trashed: true });
    },
  );
  await inBatches(
    [...wanted].filter(([name]) => !have.has(name)),
    async ([name, url]) => {
      const image = await fetchImage(url);
      if (image)
        await uploadFile(token, { name, parentId, mimeType: image.mimeType, body: image.body });
    },
  );
}

/** Trashes a deleted post's image folder, if it has one. */
export async function trashPostImages(
  token: string,
  spot: FileSpot,
  groupFolderIds: ReadonlySet<string>,
): Promise<void> {
  const folderId = await findFolder(token, spot, groupFolderIds);
  if (folderId) await updateFile(token, folderId, { trashed: true });
}
