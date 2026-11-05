// Where a source's text and an image's bytes are read from. Order: the row itself, then R2 (the
// content Worker), then, for the owner only, the Drive copy older sources still have.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bodyFromDriveFile } from "@sourcefold/core";
import type { Database } from "../../database.types";
import { downloadFileBytes, downloadFileText } from "../../google/drive";
import type { Host } from "../../host";

export class ContentNotReadyError extends Error {
  constructor() {
    super(
      "This source is still being moved to the new storage by its owner's computer. Try again in a minute.",
    );
    this.name = "ContentNotReadyError";
  }
}

/** Drive held the only copy and it was deleted there. */
export class ContentGoneError extends Error {
  constructor() {
    super("Its Drive file was deleted, and Drive held the only copy.");
    this.name = "ContentGoneError";
  }
}

export interface BodyItem {
  id: string;
  kind: string;
  markdown: string | null;
  content_sha256: string | null;
  drive_file_id: string | null;
  user_id: string;
}

type BodyHost = Pick<Host, "drive" | "content">;

/**
 * The text of a source. Throws `ContentNotReadyError` when it exists but isn't reachable yet
 * (still on the owner's computer or in the owner's Drive), `ContentGoneError` when its only
 * copy was deleted from Drive.
 */
export async function loadItemBody(
  _db: SupabaseClient<Database>,
  host: BodyHost,
  userId: string,
  item: BodyItem,
): Promise<string> {
  if (item.markdown !== null) return item.markdown;
  if (item.kind === "note") return "";

  if (item.content_sha256 && host.content) {
    const text = await host.content.getText(item.id);
    if (text !== null) return text;
  }

  if (item.drive_file_id && item.user_id === userId) {
    const text = await downloadFileText(
      await host.drive.getAccessToken(userId),
      item.drive_file_id,
    );
    if (text === null) throw new ContentGoneError();
    return bodyFromDriveFile(text);
  }

  // Text is only cleared once another store has it, so having neither means it never had text
  // (an empty capture).
  if (!item.content_sha256 && !item.drive_file_id) return "";
  throw new ContentNotReadyError();
}

export interface FileItem {
  id: string;
  storage_path: string | null;
  content_sha256: string | null;
  drive_file_id: string | null;
  user_id: string;
}

/**
 * An image's bytes: Supabase Storage, then R2, then the owner's Drive. Null when no store has it.
 * Throws `ContentNotReadyError` when it exists but isn't reachable yet.
 */
export async function loadItemFile(
  db: SupabaseClient<Database>,
  host: BodyHost,
  userId: string,
  item: FileItem,
): Promise<{ bytes: Uint8Array; mimeType: string | null } | null> {
  if (item.storage_path) {
    const { data: blob } = await db.storage.from("images").download(item.storage_path);
    if (blob)
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type || null };
  }

  if (item.content_sha256 && host.content) {
    const file = await host.content.getFile(item.id);
    if (file) return file;
  }

  if (item.drive_file_id && item.user_id === userId) {
    const bytes = await downloadFileBytes(
      await host.drive.getAccessToken(userId),
      item.drive_file_id,
    );
    return bytes ? { bytes, mimeType: null } : null;
  }

  if (item.content_sha256 || item.drive_file_id) throw new ContentNotReadyError();
  return null;
}
