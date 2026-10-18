// Search by meaning: EmbeddingGemma 2 in a Web Worker (docs/handoff-search.md, "Embedding").

import * as React from "react";
import { isTauri } from "@/lib/api";
import { EMBEDDING_MODEL_KEY, getSearchStatus, nextEmbedJobs, putEmbeddings } from "../search-api";
import { describeEmbeddingError } from "./errors";
import { createIndexerLoop, type IndexerLoop } from "./indexer-loop";
import { MODEL_CACHE_NAME } from "./protocol";
import { getInfo, patchInfo, setEnabled, subscribe } from "./store";
import type { MeaningSearchInfo, MeaningState } from "./types";
import { getEmbedClient, terminateEmbedClient } from "./worker-client";

export type { MeaningSearchInfo, MeaningState };
export { MEANING_STORAGE_KEY } from "./store";

const QUERY_PREFIX = "task: search result | query: ";

/** Live status of search by meaning, for Settings and the search box footer. */
export function useMeaningSearch(): MeaningSearchInfo {
  return React.useSyncExternalStore(subscribe, getInfo, getInfo);
}

/** The owner's switch. Turning it off stops the worker, which frees the model's memory. */
export function setMeaningEnabled(enabled: boolean): void {
  setEnabled(enabled);
  if (!enabled) terminateEmbedClient();
}

/** The query's 256-value vector, or null when search by meaning is off or not ready yet. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const info = getInfo();
  if (!info.enabled || info.state !== "ready") return null;
  const query = text.trim();
  if (!query) return null;
  try {
    const vector = await getEmbedClient().query(QUERY_PREFIX + query);
    return Array.from(vector);
  } catch {
    return null; // The search then runs on keywords alone.
  }
}

function yieldToUi(): Promise<void> {
  if (typeof MessageChannel === "undefined") return new Promise((r) => setTimeout(r, 0));
  // Unlike a zero-delay timer, this isn't slowed to once a second when the window is hidden.
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function sleep(ms: number, wake: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void wake.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let activeLoop: IndexerLoop | null = null;

/** Checks for passages without vectors now, instead of waiting for the next 30 s check. */
export function wakeIndexer(): void {
  activeLoop?.wake();
}

function createLoop(getProjectId: () => string | null): IndexerLoop {
  const client = getEmbedClient();
  return createIndexerLoop({
    model: EMBEDDING_MODEL_KEY,
    isEnabled: () => getInfo().enabled,
    getProjectId,
    ensureReady: async () => {
      await client.load();
    },
    isPaused: async () => (await getSearchStatus(null, EMBEDDING_MODEL_KEY)).state === "paused",
    nextJobs: nextEmbedJobs,
    embed: (texts) => client.embed(texts),
    putVectors: putEmbeddings,
    yieldToUi,
    sleep,
    now: () => performance.now(),
    onSpeed: (passagesPerSecond) => patchInfo({ passagesPerSecond }),
    onError: (message) => patchInfo(client.isReady() ? { message } : { state: "error", message }),
    onOk: () => {
      const { state, message } = getInfo();
      if (message !== null && state !== "error") patchInfo({ message: null });
    },
    describeError: describeEmbeddingError,
  });
}

/** Mounted once in App: runs the background loop that embeds passages while meaning is on. */
export function MeaningIndexer({
  currentProjectId = null,
}: { currentProjectId?: string | null } = {}): null {
  const { enabled } = useMeaningSearch();
  const projectId = React.useRef<string | null>(currentProjectId);

  React.useEffect(() => {
    projectId.current = currentProjectId;
    wakeIndexer(); // The open project's passages go first.
  }, [currentProjectId]);

  React.useEffect(() => {
    if (!enabled || !isTauri()) return;
    const loop = createLoop(() => projectId.current);
    activeLoop = loop;
    loop.start();
    return () => {
      loop.stop();
      if (activeLoop === loop) activeLoop = null;
    };
  }, [enabled]);

  return null;
}

/**
 * Clears the downloaded model from the webview's cache and stops the worker. Search by meaning
 * is switched off too, or the background loop would download the model again at once.
 */
export async function deleteModel(): Promise<void> {
  setMeaningEnabled(false);
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(MODEL_CACHE_NAME);
  } catch {
    throw new Error("Couldn't delete the model. Close other Sourcefold windows and try again.");
  }
}
