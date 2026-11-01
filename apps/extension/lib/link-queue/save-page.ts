import type { CaptureRequest, XPostCapture } from "@sourcefold/core";
import { ApiError, capture, saveGrokipedia, type SavedItem } from "../api";
import type { CaptureResult } from "../capture-page";
import { pageKindOf } from "../page-kind";
import { enrichXPostsMedia } from "../x/media";
import {
  ALREADY_SAVED_MESSAGE,
  CANNOT_SAVE_MESSAGE,
  PAID_POST_MESSAGE,
  SAVE_FAILED_MESSAGE,
  clip,
} from "./copy";
import type { SaveOutcome } from "./outcome";
import type { LinkQueuePatch } from "./types";

export type { SaveOutcome } from "./outcome";

export interface PageSaver {
  saveGrokipedia(url: string, folderId: string): Promise<{ item: Pick<SavedItem, "id" | "title"> }>;
  capture(body: CaptureRequest): Promise<{ item: Pick<SavedItem, "id" | "title"> }>;
  enrichXPostsMedia(posts: XPostCapture[]): Promise<XPostCapture[]>;
}

const defaultSaver: PageSaver = {
  saveGrokipedia: (url, folderId) => saveGrokipedia(url, folderId),
  capture: (body) => capture(body),
  enrichXPostsMedia: (posts) => enrichXPostsMedia(posts),
};

function saved(item: Pick<SavedItem, "id" | "title">, title?: string | null): SaveOutcome {
  return { status: "saved", itemId: item.id, title: title || item.title || null };
}

function failed(message: string): SaveOutcome {
  return { status: "failed", message: message || SAVE_FAILED_MESSAGE };
}

/**
 * Turns a capture-script result into the same `/api/capture` (or Grokipedia) call the popup's
 * Save button makes, and reports it the way the queue row wants.
 */
export async function saveQueuePage(
  url: string,
  folderId: string,
  captured: CaptureResult,
  saver: PageSaver = defaultSaver,
): Promise<SaveOutcome> {
  try {
    if (pageKindOf(url) === "grokipedia") {
      const { item } = await saver.saveGrokipedia(url, folderId);
      return saved(item, item.title);
    }

    if (captured.kind === "unsupported") return failed(CANNOT_SAVE_MESSAGE);
    if (captured.kind === "error") return failed(captured.message);

    if (captured.kind === "substack") {
      const res = captured.result;
      if (res.status === "not_substack") return failed(CANNOT_SAVE_MESSAGE);
      if (res.status === "paywalled") {
        const { item } = await saver.capture({
          kind: "substack_unavailable",
          folder_id: folderId,
          url: res.url,
          title: res.title,
        });
        return {
          status: "unavailable",
          itemId: item.id,
          title: res.title || item.title || null,
          message: PAID_POST_MESSAGE,
        };
      }
      const { item } = await saver.capture({
        kind: "substack",
        folder_id: folderId,
        capture: res.capture,
      });
      return saved(item, res.capture.title);
    }

    if (captured.kind === "source") {
      const res = captured.result;
      if (res.status === "unavailable") {
        const { item } = await saver.capture({
          kind: "source_unavailable",
          folder_id: folderId,
          source: res.kind,
          url: res.url,
          title: res.title,
          reason: res.reason,
        });
        return {
          status: "unavailable",
          itemId: item.id,
          title: res.title || item.title || null,
          message: res.reason,
        };
      }
      const { item } = await saver.capture({
        kind: res.kind,
        folder_id: folderId,
        capture: res.capture,
      });
      return saved(item, res.capture.title);
    }

    const res = captured.result;
    if (res.status === "error") return failed(res.message);
    if (!res.posts.length) {
      return failed("Couldn't find the post on this page. Scroll to it and try again.");
    }
    const posts = await saver.enrichXPostsMedia(res.posts);
    const { item } = await saver.capture({
      kind: "x",
      folder_id: folderId,
      posts: posts.length ? posts : res.posts,
    });
    return saved(item, item.title);
  } catch (err: unknown) {
    if (err instanceof ApiError && (err.status === 409 || err.code === "duplicate")) {
      return { status: "duplicate", message: ALREADY_SAVED_MESSAGE };
    }
    const message = err instanceof Error && err.message ? err.message : SAVE_FAILED_MESSAGE;
    return failed(message);
  }
}

export function patchBodyForOutcome(outcome: SaveOutcome): LinkQueuePatch {
  const message = outcome.message ? clip(outcome.message) : undefined;
  if (outcome.status === "failed") {
    return { status: "failed", message: message ?? SAVE_FAILED_MESSAGE };
  }
  const body: LinkQueuePatch = { status: outcome.status };
  if (message) body.message = message;
  if (outcome.title) body.title = clip(outcome.title);
  if (outcome.itemId) body.item_id = outcome.itemId;
  return body;
}
