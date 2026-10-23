import { listChildren, updateFile, uploadFile } from "../../google/drive";
import { buildGoogleDocHtml } from "./google-doc";
import type { FileSpot } from "./post-images";

// A Google Doc next to every Markdown file in Drive, with the same name minus `.md`
// (docs/FILE-FORMAT.md, "Google Docs and Word copies"). The Doc is rebuilt from the Markdown
// each time the file is saved; the desktop's local copy exports it as .docx.

export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/** `Why AI Matters.md` → `Why AI Matters`. */
export function googleDocName(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

async function findDoc(token: string, spot: FileSpot): Promise<string | null> {
  const found = await listChildren(token, spot.parentId, {
    name: googleDocName(spot.fileName),
    mimeType: GOOGLE_DOC_MIME,
  });
  return found[0]?.id ?? null;
}

/**
 * Brings a file's Google Doc in line with its Markdown: creates it, follows a rename or move of
 * the file, and replaces its content. Only Google Docs with the file's name are ever touched.
 * Safe to run again after a partial run.
 */
export async function syncGoogleDoc(
  token: string,
  current: FileSpot,
  previous: FileSpot | null,
  markdown: string,
): Promise<string> {
  const name = googleDocName(current.fileName);
  const html = buildGoogleDocHtml(markdown);

  let docId = await findDoc(token, current);
  let moveFrom: string | null = null;
  if (
    !docId &&
    previous &&
    (previous.parentId !== current.parentId || previous.fileName !== current.fileName)
  ) {
    docId = await findDoc(token, previous);
    if (docId && previous.parentId !== current.parentId) moveFrom = previous.parentId;
  }

  const created = await uploadFile(token, {
    id: docId ?? undefined,
    name,
    parentId: current.parentId,
    mimeType: "text/html",
    convertTo: GOOGLE_DOC_MIME,
    body: html,
    addParents: moveFrom ? current.parentId : undefined,
    removeParents: moveFrom ?? undefined,
  });
  return created.id;
}

/** Trashes a deleted file's Google Doc, if it has one. */
export async function trashGoogleDoc(token: string, spot: FileSpot): Promise<void> {
  const docId = await findDoc(token, spot);
  if (docId) await updateFile(token, docId, { trashed: true });
}
