import { canonicalWikipediaUrl, parseWikipediaUrl } from "@sourcefold/core";
import {
  WIKIPEDIA_ERROR_MESSAGES,
  WIKIPEDIA_USER_AGENT,
  WikipediaError,
  fetchWikipediaCapture,
} from "@sourcefold/core/capture";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";
import type { Host } from "../../host";
import {
  elsewhereError,
  findDuplicate,
  findDuplicateElsewhere,
  formatDuplicateMessage,
  invalidFolderMessage,
  nextPosition,
} from "./find-duplicate";
import type { SavedCaptureItem } from "./save-substack";

export interface WikipediaCaptureInput {
  url: string;
  title: string;
  summary?: string | null;
  language?: string | null;
  revision?: string | null;
  lastEdited?: string | null;
  markdown: string;
}

export interface SaveWikipediaOptions {
  /** Save it even though the link is already in another group of the project. */
  allowDuplicate?: boolean;
}

export type SaveWikipediaResult =
  | { success: true; status: 201; item: SavedCaptureItem }
  | {
      success: false;
      status: 409;
      error: {
        code: "duplicate";
        message: string;
        item_id: string;
        folder_id: string;
        folder_name: string;
      };
    }
  | {
      success: false;
      status: 400 | 404 | 422 | 500 | 502;
      error: { code: string; message: string };
    };

const FAILURE_STATUS = {
  invalid_url: 422,
  not_article: 422,
  disambiguation: 422,
  not_found: 404,
  fetch_failed: 502,
  parse_failed: 422,
} as const;

const SELECT_ITEM = "id, folder_id, kind, title, source_url, status, created_at";

function duplicateResult(
  existing: { item_id: string; folder_id: string; folder_name: string } | null,
  folderId: string,
): SaveWikipediaResult {
  const folderName = existing?.folder_name ?? "another folder";
  return {
    success: false,
    status: 409,
    error: {
      code: "duplicate",
      message: formatDuplicateMessage(folderName),
      item_id: existing?.item_id ?? "",
      folder_id: existing?.folder_id ?? folderId,
      folder_name: folderName,
    },
  };
}

/**
 * Saves an article that was already fetched and converted (by the desktop app, or by
 * `saveWikipediaLink` below) as a `wikipedia` item.
 */
export async function saveWikipediaCapture(
  db: SupabaseClient<Database>,
  userId: string,
  folderId: string,
  capture: WikipediaCaptureInput,
  options: SaveWikipediaOptions = {},
): Promise<SaveWikipediaResult> {
  const ref = parseWikipediaUrl(capture.url);
  if (!ref) {
    return {
      success: false,
      status: 400,
      error: { code: "invalid_url", message: WIKIPEDIA_ERROR_MESSAGES.invalid_url },
    };
  }
  const canonical = ref.url;

  const existing = await findDuplicate(db, userId, canonical, folderId);
  if (existing) return duplicateResult(existing, folderId);
  if (!options.allowDuplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folderId);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  const position = await nextPosition(db, userId, folderId);
  const title = capture.title.trim().slice(0, 500) || ref.title.replace(/_/g, " ");

  const { data: item, error: insertError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id: folderId,
      kind: "wikipedia",
      status: "saved",
      title,
      source_url: canonical,
      canonical_url: canonical,
      markdown: `${capture.markdown.trim()}\n`,
      meta: {
        summary: capture.summary ?? null,
        language: capture.language ?? ref.language,
        revision: capture.revision ?? null,
        last_edited: capture.lastEdited ?? null,
      },
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
      return duplicateResult(await findDuplicate(db, userId, canonical, folderId), folderId);
    }
    return {
      success: false,
      status: 500,
      error: { code: "save_failed", message: insertError.message || "Failed to save article." },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: { code: "unknown", message: "Failed to save article." },
    };
  }

  return { success: true, status: 201, item };
}

/** Fetches a Wikipedia article from Wikimedia's API and saves it. */
export async function saveWikipediaLink(
  db: SupabaseClient<Database>,
  userId: string,
  { url, folderId, allowDuplicate }: { url: string; folderId: string; allowDuplicate?: boolean },
  host: Pick<Host, "fetchUrl" | "parseHtml">,
): Promise<SaveWikipediaResult> {
  const canonical = canonicalWikipediaUrl(url);
  if (!canonical) {
    return {
      success: false,
      status: 422,
      error: { code: "invalid_url", message: WIKIPEDIA_ERROR_MESSAGES.invalid_url },
    };
  }

  // Check the pasted link first so a duplicate costs no request. A redirect is checked again
  // once the real title is known.
  const existing = await findDuplicate(db, userId, canonical, folderId);
  if (existing) return duplicateResult(existing, folderId);
  if (!allowDuplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folderId);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  let capture;
  try {
    capture = await fetchWikipediaCapture(canonical, {
      parseHtml: host.parseHtml,
      headers: { "User-Agent": WIKIPEDIA_USER_AGENT },
      fetch: host.fetchUrl as typeof fetch,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (err instanceof WikipediaError) {
      return {
        success: false,
        status: FAILURE_STATUS[err.code],
        error: { code: err.code, message: err.message },
      };
    }
    return {
      success: false,
      status: 502,
      error: { code: "fetch_failed", message: WIKIPEDIA_ERROR_MESSAGES.fetch_failed },
    };
  }

  return saveWikipediaCapture(db, userId, folderId, capture, { allowDuplicate });
}
