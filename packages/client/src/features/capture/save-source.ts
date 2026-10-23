import { canonicalizeUrl, type SourceCapture, type SourceCaptureKind } from "@sourcefold/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import {
  elsewhereError,
  findDuplicate,
  findDuplicateElsewhere,
  formatDuplicateMessage,
  invalidFolderMessage,
  nextPosition,
} from "./find-duplicate";
import type { SavedCaptureItem } from "./save-substack";

export type SaveSourceSuccess = {
  success: true;
  status: 201;
  item: SavedCaptureItem;
  unavailable?: true;
};

export type SaveSourceDuplicateError = {
  success: false;
  status: 409;
  error: {
    code: "duplicate";
    message: string;
    item_id: string;
    folder_id: string;
    folder_name: string;
  };
};

export type SaveSourceGeneralError = {
  success: false;
  status: 400 | 422 | 500;
  error: { code: string; message: string };
};

export type SaveSourceResult =
  SaveSourceSuccess | SaveSourceDuplicateError | SaveSourceGeneralError;

export interface SaveSourceUnavailableParams {
  folder_id: string;
  source: SourceCaptureKind;
  url: string;
  title: string;
  reason: string;
  /** Save it even though the link is already in another group of the project. */
  allow_duplicate?: boolean;
}

export interface SaveSourceOptions {
  allowDuplicate?: boolean;
}

const SELECT_ITEM = "id, folder_id, kind, title, source_url, status, created_at";

/**
 * A source may be saved once per group. Canonicalization is best-effort: a link that does
 * not parse is still saved, using the capture's own address.
 */
async function canonicalOrOriginal(url: string): Promise<string> {
  try {
    return canonicalizeUrl(url);
  } catch {
    return url;
  }
}

function duplicateResult(existing: {
  item_id: string;
  folder_id: string;
  folder_name: string;
}): SaveSourceDuplicateError {
  return {
    success: false,
    status: 409,
    error: {
      code: "duplicate",
      message: formatDuplicateMessage(existing.folder_name),
      item_id: existing.item_id,
      folder_id: existing.folder_id,
      folder_name: existing.folder_name,
    },
  };
}

function raceDuplicateResult(
  existing: { item_id: string; folder_id: string; folder_name: string } | null,
  folderId: string,
): SaveSourceDuplicateError {
  return duplicateResult(
    existing ?? { item_id: "", folder_id: folderId, folder_name: "another folder" },
  );
}

/**
 * Saves a source that was already fetched and converted (by the desktop app or the
 * extension) as an item of its own kind. The kind's front matter fields travel in `meta`.
 */
export async function saveSource(
  db: SupabaseClient<Database>,
  userId: string,
  kind: SourceCaptureKind,
  folderId: string,
  capture: SourceCapture,
  options: SaveSourceOptions = {},
): Promise<SaveSourceResult> {
  // A source with no text would be "saved" with nothing in it, and nothing for Drive to keep.
  if (!capture.markdown.trim()) {
    return {
      success: false,
      status: 422,
      error: { code: "no_content", message: "There's no text on this page to save." },
    };
  }

  const canonical = await canonicalOrOriginal(capture.url);

  const existing = await findDuplicate(db, userId, canonical, folderId);
  if (existing) return duplicateResult(existing);
  if (!options.allowDuplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folderId);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  const position = await nextPosition(db, userId, folderId);
  const title = capture.title.trim().slice(0, 500) || capture.url;
  const markdown = `${capture.markdown.trim()}\n`;

  const { data: item, error: insertError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id: folderId,
      kind,
      status: "saved",
      title,
      source_url: capture.url,
      canonical_url: canonical,
      meta: capture.meta,
      markdown,
      position,
    })
    .select(SELECT_ITEM)
    .single();

  if (insertError) {
    if (insertError.message.includes("invalid folder")) {
      return {
        success: false,
        status: 400,
        error: { code: "invalid_folder", message: invalidFolderMessage(insertError.message) },
      };
    }
    if (insertError.code === "23505" || insertError.message.includes("duplicate key")) {
      return raceDuplicateResult(await findDuplicate(db, userId, canonical, folderId), folderId);
    }
    return {
      success: false,
      status: 500,
      error: { code: "save_failed", message: insertError.message || "Failed to save item." },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: { code: "unknown", message: "Failed to save item." },
    };
  }

  return { success: true, status: 201, item };
}

/**
 * A source that was found but has nothing to save (a YouTube video without captions) is
 * stored as an `unavailable` item so the list explains why, like a locked paid post.
 */
export async function saveSourceUnavailable(
  db: SupabaseClient<Database>,
  userId: string,
  params: SaveSourceUnavailableParams,
): Promise<SaveSourceResult> {
  const { folder_id, source, url, title, reason } = params;
  const canonical = await canonicalOrOriginal(url);

  const existing = await findDuplicate(db, userId, canonical, folder_id);
  if (existing) return duplicateResult(existing);
  if (!params.allow_duplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folder_id);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  const position = await nextPosition(db, userId, folder_id);

  const { data: item, error: insertError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id,
      kind: source,
      status: "unavailable",
      error: reason,
      title: title.trim().slice(0, 500) || url,
      source_url: url,
      canonical_url: canonical,
      markdown: null,
      meta: {},
      position,
    })
    .select(SELECT_ITEM)
    .single();

  if (insertError) {
    if (insertError.message.includes("invalid folder")) {
      return {
        success: false,
        status: 400,
        error: { code: "invalid_folder", message: invalidFolderMessage(insertError.message) },
      };
    }
    if (insertError.code === "23505" || insertError.message.includes("duplicate key")) {
      return raceDuplicateResult(await findDuplicate(db, userId, canonical, folder_id), folder_id);
    }
    return {
      success: false,
      status: 500,
      error: { code: "save_failed", message: insertError.message || "Failed to save item." },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: { code: "unknown", message: "Failed to save item." },
    };
  }

  return { success: true, status: 201, item, unavailable: true };
}
