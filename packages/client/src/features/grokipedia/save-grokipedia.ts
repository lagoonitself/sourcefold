import { canonicalizeUrl, detectSource, formatDate } from "@sourcefold/core";
import {
  parseGrokipediaHtml,
  grokipediaToMarkdown,
  GrokipediaParseError,
  type GrokipediaArticle,
} from "@sourcefold/core/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../database.types";
import type { Host } from "../../host";
import {
  elsewhereError,
  findDuplicateElsewhere,
  invalidFolderMessage,
  nextPosition,
} from "../capture/find-duplicate";
import {
  GROKIPEDIA_ERROR_MESSAGES,
  formatDuplicateMessage,
  type GrokipediaErrorCode,
  type GrokipediaDuplicateErrorPayload,
} from "./grokipedia-errors";

export interface SaveGrokipediaParams {
  url: string;
  folderId: string;
  /** Save it even though the link is already in another group of the project. */
  allowDuplicate?: boolean;
}

export type SavedGrokipediaItem = Pick<
  Tables<"items">,
  "id" | "folder_id" | "kind" | "title" | "source_url" | "status" | "created_at"
>;

export type SaveGrokipediaSuccess = {
  success: true;
  item: SavedGrokipediaItem;
};

export type SaveGrokipediaDuplicateError = {
  success: false;
  status: 409;
  error: GrokipediaDuplicateErrorPayload;
};

export type SaveGrokipediaGeneralError = {
  success: false;
  status: 400 | 404 | 422 | 500 | 502;
  error: {
    code: Exclude<GrokipediaErrorCode, "duplicate">;
    message: string;
  };
};

export type SaveGrokipediaError = SaveGrokipediaDuplicateError | SaveGrokipediaGeneralError;

export type SaveGrokipediaResult = SaveGrokipediaSuccess | SaveGrokipediaError;

export async function findExistingItemByCanonicalUrl(
  db: SupabaseClient<Database>,
  userId: string,
  canonicalUrl: string,
  folderId: string,
): Promise<{ id: string; folder_id: string; folder_name: string } | null> {
  const { data: item, error } = await db
    .from("items")
    .select("id, folder_id, folders!items_folder_id_fkey(name, deleted_at)")
    .eq("user_id", userId)
    .eq("canonical_url", canonicalUrl)
    .eq("folder_id", folderId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !item) {
    return null;
  }

  const folder = Array.isArray(item.folders) ? item.folders[0] : item.folders;
  const folderName = folder && !folder.deleted_at && folder.name ? folder.name : "another folder";

  return {
    id: item.id,
    folder_id: item.folder_id,
    folder_name: folderName,
  };
}

export async function saveGrokipediaLink(
  db: SupabaseClient<Database>,
  userId: string,
  { url, folderId, allowDuplicate }: SaveGrokipediaParams,
  host: Pick<Host, "fetchUrl">,
): Promise<SaveGrokipediaResult> {
  // Step 1: Canonicalize URL and detect source
  let canonical: string;
  try {
    canonical = canonicalizeUrl(url);
  } catch {
    return {
      success: false,
      status: 400,
      error: {
        code: "invalid_url",
        message: GROKIPEDIA_ERROR_MESSAGES.invalid_url,
      },
    };
  }

  if (detectSource(canonical) !== "grokipedia") {
    return {
      success: false,
      status: 422,
      error: {
        code: "not_grokipedia",
        message: GROKIPEDIA_ERROR_MESSAGES.not_grokipedia,
      },
    };
  }

  // Step 2: Duplicate check
  const existing = await findExistingItemByCanonicalUrl(db, userId, canonical, folderId);
  if (existing) {
    return {
      success: false,
      status: 409,
      error: {
        code: "duplicate",
        message: formatDuplicateMessage(existing.folder_name),
        item_id: existing.id,
        folder_id: existing.folder_id,
        folder_name: existing.folder_name,
      },
    };
  }

  // The same link in another group of the project is refused too, unless the caller allows it.
  if (!allowDuplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folderId);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  // Step 3: Fetch canonical HTML
  let response: Response;
  try {
    response = await host.fetchUrl(canonical, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Sourcefold/0.1; +https://github.com/lagoonitself/sourcefold)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return {
      success: false,
      status: 502,
      error: {
        code: "fetch_failed",
        message: GROKIPEDIA_ERROR_MESSAGES.fetch_failed,
      },
    };
  }

  if (response.status === 404) {
    return {
      success: false,
      status: 404,
      error: {
        code: "not_found",
        message: GROKIPEDIA_ERROR_MESSAGES.not_found,
      },
    };
  }

  if (!response.ok) {
    return {
      success: false,
      status: 502,
      error: {
        code: "fetch_failed",
        message: GROKIPEDIA_ERROR_MESSAGES.fetch_failed,
      },
    };
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return {
      success: false,
      status: 502,
      error: {
        code: "fetch_failed",
        message: GROKIPEDIA_ERROR_MESSAGES.fetch_failed,
      },
    };
  }

  // Step 4: Parse Grokipedia HTML
  let article: GrokipediaArticle;
  try {
    article = parseGrokipediaHtml(html, canonical);
  } catch (err) {
    if (err instanceof GrokipediaParseError) {
      return {
        success: false,
        status: 422,
        error: {
          code: "parse_failed",
          message: GROKIPEDIA_ERROR_MESSAGES.parse_failed,
        },
      };
    }
    return {
      success: false,
      status: 422,
      error: {
        code: "parse_failed",
        message: GROKIPEDIA_ERROR_MESSAGES.parse_failed,
      },
    };
  }

  // Step 5: Calculate next position in target folder
  const position = await nextPosition(db, userId, folderId);

  // Step 6: Convert to markdown and insert item
  const markdown = grokipediaToMarkdown(article, {
    savedAt: formatDate(new Date()),
  });

  const urlSlug = new URL(canonical).pathname.split("/").filter(Boolean).pop() || "grokipedia";
  let title = article.title.trim().slice(0, 500);
  if (!title) {
    title = urlSlug.slice(0, 500);
  }

  const { data: insertedItem, error: insertError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id: folderId,
      kind: "grokipedia",
      title,
      source_url: canonical,
      canonical_url: canonical,
      status: "saved",
      markdown,
      meta: {
        summary: article.summary,
        fact_checked_at: article.factCheckedAt,
        reference_count: article.references.length,
        saved_at: new Date().toISOString(),
      },
      position,
    })
    .select("id, folder_id, kind, title, source_url, status, created_at")
    .single();

  if (insertError) {
    // Postgres unique violation (code 23505) or unique constraint clash
    if (
      insertError.code === "23505" ||
      insertError.message.includes("items_folder_canonical_url_key") ||
      insertError.message.includes("duplicate key")
    ) {
      const raceExisting = await findExistingItemByCanonicalUrl(db, userId, canonical, folderId);
      const folderName = raceExisting?.folder_name ?? "another folder";
      return {
        success: false,
        status: 409,
        error: {
          code: "duplicate",
          message: formatDuplicateMessage(folderName),
          item_id: raceExisting?.id ?? "",
          folder_id: raceExisting?.folder_id ?? folderId,
          folder_name: folderName,
        },
      };
    }

    // Trigger check_item_folder raises exception 'invalid folder'
    if (insertError.message.includes("invalid folder")) {
      return {
        success: false,
        status: 400,
        error: {
          code: "invalid_folder",
          message: invalidFolderMessage(insertError.message),
        },
      };
    }

    return {
      success: false,
      status: 500,
      error: {
        code: "unknown",
        message: insertError.message || GROKIPEDIA_ERROR_MESSAGES.unknown,
      },
    };
  }

  if (!insertedItem) {
    return {
      success: false,
      status: 500,
      error: {
        code: "unknown",
        message: GROKIPEDIA_ERROR_MESSAGES.unknown,
      },
    };
  }

  // Step 7: Success
  return {
    success: true,
    item: insertedItem,
  };
}
