import { checkUrl, saveGrokipedia } from "@/lib/api";
import { saveSourceLink } from "../sources/source-client";
import { saveSubstackPost } from "../substack/substack-client";
import { saveWikipediaArticle } from "../wikipedia/wikipedia-client";
import { classifyQueuedLink } from "./links";
import type { SavedLink } from "./types";

// The same branches as Add links (`AddLinksDialog` `saveOne`). Extractors stay in the
// source, Wikipedia, Substack and Grokipedia clients; this only reports the outcome.

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("The save was stopped.");
  error.name = "AbortError";
  throw error;
}

function alreadySaved(folderName: string | null | undefined): string {
  return `Already saved in ${folderName || "this group"}`;
}

async function saveGrokipediaLink(
  url: string,
  folderId: string,
  signal: AbortSignal,
): Promise<SavedLink> {
  throwIfAborted(signal);
  const check = await checkUrl(url, folderId);
  throwIfAborted(signal);
  if (check.exists) {
    return { kind: "duplicate", title: null, message: alreadySaved(check.folder_name) };
  }
  const saved = await saveGrokipedia(url, folderId);
  return { kind: "saved", title: saved.title || url, itemId: saved.id };
}

async function saveWikipediaLink(
  url: string,
  folderId: string,
  signal: AbortSignal,
): Promise<SavedLink> {
  throwIfAborted(signal);
  const outcome = await saveWikipediaArticle(url, folderId);
  if (outcome.kind === "saved") {
    return { kind: "saved", title: outcome.title, itemId: outcome.item.id };
  }
  return { kind: "duplicate", title: outcome.title, message: outcome.message };
}

async function saveSource(url: string, folderId: string, signal: AbortSignal): Promise<SavedLink> {
  throwIfAborted(signal);
  const outcome = await saveSourceLink(url, folderId, signal);
  if (outcome.kind === "saved") {
    return { kind: "saved", title: outcome.title, itemId: outcome.item.id };
  }
  if (outcome.kind === "unavailable") {
    return { kind: "unavailable", title: outcome.title, message: outcome.reason };
  }
  return { kind: "duplicate", title: outcome.title, message: outcome.message };
}

async function saveSubstackLink(
  url: string,
  folderId: string,
  signal: AbortSignal,
): Promise<SavedLink> {
  throwIfAborted(signal);
  const outcome = await saveSubstackPost(url, folderId);
  if (outcome.kind === "saved") {
    return {
      kind: "saved",
      title: outcome.title,
      itemId: outcome.item.id,
      message: outcome.paid ? "Paid post" : undefined,
    };
  }
  if (outcome.kind === "paid_locked") {
    return { kind: "unavailable", title: outcome.title, message: outcome.reason };
  }
  return { kind: "duplicate", title: outcome.title, message: outcome.message };
}

/** Saves one link the way Add links would. Playlists and publications are expanded by the drain. */
export async function saveQueuedLink(
  url: string,
  folderId: string,
  signal: AbortSignal,
): Promise<SavedLink> {
  throwIfAborted(signal);
  const kind = classifyQueuedLink(url, null);
  if (kind === "grokipedia") return saveGrokipediaLink(url, folderId, signal);
  if (kind === "wikipedia") return saveWikipediaLink(url, folderId, signal);
  if (kind === "substack") return saveSubstackLink(url, folderId, signal);
  if (kind === "source") return saveSource(url, folderId, signal);
  if (kind === "unknown") throw new Error("That isn't a link Sourcefold can save.");
  throw new Error("That link should be expanded before it is saved.");
}
