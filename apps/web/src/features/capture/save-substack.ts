import { canonicalizeUrl, InvalidUrlError } from "@sourcefold/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  elsewhereError,
  findDuplicate,
  findDuplicateElsewhere,
  formatDuplicateMessage,
  invalidFolderMessage,
  nextPosition,
} from "./find-duplicate";

export type SavedCaptureItem = {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  source_url: string | null;
  status: string;
  created_at: string;
};

export type SaveSubstackSuccess = {
  success: true;
  status: 201;
  item: SavedCaptureItem;
  unavailable?: true;
};

export type SaveSubstackDuplicateError = {
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

export type SaveSubstackGeneralError = {
  success: false;
  status: 400 | 500;
  error: {
    code: string;
    message: string;
  };
};

export type SaveSubstackResult =
  SaveSubstackSuccess | SaveSubstackDuplicateError | SaveSubstackGeneralError;

export interface SaveSubstackParams {
  folder_id: string;
  /** Save it even though the link is already in another group of the project. */
  allow_duplicate?: boolean;
  capture: {
    url: string;
    title: string;
    subtitle?: string | null;
    author?: string | null;
    authorUrl?: string | null;
    publication?: string | null;
    publicationUrl?: string | null;
    published?: string | null;
    access: "free" | "paid";
    markdown: string;
  };
}

export interface SaveSubstackUnavailableParams {
  folder_id: string;
  allow_duplicate?: boolean;
  url: string;
  title: string;
}

export async function saveSubstack(
  db: SupabaseClient<Database>,
  userId: string,
  params: SaveSubstackParams,
): Promise<SaveSubstackResult> {
  const { folder_id, capture } = params;

  let canonical: string;
  try {
    canonical = canonicalizeUrl(capture.url);
  } catch (err) {
    if (err instanceof InvalidUrlError) {
      return {
        success: false,
        status: 400,
        error: { code: "invalid_url", message: "That isn't a valid link." },
      };
    }
    return {
      success: false,
      status: 400,
      error: { code: "invalid_url", message: "That isn't a valid link." },
    };
  }

  const existing = await findDuplicate(db, userId, canonical, folder_id);
  if (existing) {
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
  if (!params.allow_duplicate) {
    const elsewhere = await findDuplicateElsewhere(db, userId, canonical, folder_id);
    if (elsewhere) return { success: false, status: 409, error: elsewhereError(elsewhere) };
  }

  const position = await nextPosition(db, userId, folder_id);
  const title = capture.title;
  const markdown = "# " + title + "\n\n" + capture.markdown.trim() + "\n";
  const meta = {
    subtitle: capture.subtitle ?? null,
    author: capture.author ?? null,
    author_url: capture.authorUrl ?? null,
    publication: capture.publication ?? null,
    publication_url: capture.publicationUrl ?? null,
    published: capture.published ?? null,
    access: capture.access ?? null,
  };

  const { data: item, error: insertError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id,
      kind: "substack",
      status: "saved",
      title,
      source_url: capture.url,
      canonical_url: canonical,
      markdown,
      meta,
      position,
    })
    .select("id, folder_id, kind, title, source_url, status, created_at")
    .single();

  if (insertError) {
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

    if (insertError.code === "23505" || insertError.message.includes("duplicate key")) {
      const raceExisting = await findDuplicate(db, userId, canonical, folder_id);
      const folderName = raceExisting?.folder_name ?? "another folder";
      return {
        success: false,
        status: 409,
        error: {
          code: "duplicate",
          message: formatDuplicateMessage(folderName),
          item_id: raceExisting?.item_id ?? "",
          folder_id: raceExisting?.folder_id ?? folder_id,
          folder_name: folderName,
        },
      };
    }

    return {
      success: false,
      status: 500,
      error: {
        code: "save_failed",
        message: insertError.message || "Failed to save post.",
      },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: {
        code: "unknown",
        message: "Failed to save post.",
      },
    };
  }

  return {
    success: true,
    status: 201,
    item,
  };
}

export async function saveSubstackUnavailable(
  db: SupabaseClient<Database>,
  userId: string,
  params: SaveSubstackUnavailableParams,
): Promise<SaveSubstackResult> {
  const { folder_id, url, title } = params;

  let canonical: string;
  try {
    canonical = canonicalizeUrl(url);
  } catch (err) {
    if (err instanceof InvalidUrlError) {
      return {
        success: false,
        status: 400,
        error: { code: "invalid_url", message: "That isn't a valid link." },
      };
    }
    return {
      success: false,
      status: 400,
      error: { code: "invalid_url", message: "That isn't a valid link." },
    };
  }

  const existing = await findDuplicate(db, userId, canonical, folder_id);
  if (existing) {
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
      kind: "substack",
      status: "unavailable",
      error: "Paid post, not saved",
      title,
      source_url: url,
      canonical_url: canonical,
      markdown: null,
      meta: { access: "paid" },
      position,
    })
    .select("id, folder_id, kind, title, source_url, status, created_at")
    .single();

  if (insertError) {
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

    if (insertError.code === "23505" || insertError.message.includes("duplicate key")) {
      const raceExisting = await findDuplicate(db, userId, canonical, folder_id);
      const folderName = raceExisting?.folder_name ?? "another folder";
      return {
        success: false,
        status: 409,
        error: {
          code: "duplicate",
          message: formatDuplicateMessage(folderName),
          item_id: raceExisting?.item_id ?? "",
          folder_id: raceExisting?.folder_id ?? folder_id,
          folder_name: folderName,
        },
      };
    }

    return {
      success: false,
      status: 500,
      error: {
        code: "save_failed",
        message: insertError.message || "Failed to save post.",
      },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: {
        code: "unknown",
        message: "Failed to save post.",
      },
    };
  }

  return {
    success: true,
    status: 201,
    item,
    unavailable: true,
  };
}
