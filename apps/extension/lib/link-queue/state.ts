import { browser } from "wxt/browser";
import { EMPTY_LINK_QUEUE_STATE, type LinkQueueState } from "./types";

export const LINK_QUEUE_STATE_KEY = "linkQueueState";
/** Tab left open when the service worker died mid-save. Closed on the next start. */
export const LINK_QUEUE_TAB_KEY = "linkQueueOpenTabId";
export const LINK_QUEUE_WORKER_KEY = "linkQueueWorkerId";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readPermission(value: unknown): LinkQueueState["permission"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as { count?: unknown; hosts?: unknown; origins?: unknown };
  if (typeof raw.count !== "number" || raw.count < 1) return null;
  if (!isStringArray(raw.hosts) || !isStringArray(raw.origins)) return null;
  return { count: raw.count, hosts: raw.hosts, origins: raw.origins };
}

function readProgress(value: unknown): LinkQueueState["progress"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as { index?: unknown; total?: unknown; addedBy?: unknown };
  if (typeof raw.index !== "number" || typeof raw.total !== "number") return null;
  return {
    index: raw.index,
    total: raw.total,
    addedBy: typeof raw.addedBy === "string" ? raw.addedBy : null,
  };
}

function readFailed(value: unknown): LinkQueueState["failed"] {
  if (!value || typeof value !== "object") return null;
  const raw = value as { count?: unknown; message?: unknown };
  if (typeof raw.count !== "number" || raw.count < 1) return null;
  return { count: raw.count, message: typeof raw.message === "string" ? raw.message : null };
}

export function normalizeLinkQueueState(value: unknown): LinkQueueState {
  if (!value || typeof value !== "object") return EMPTY_LINK_QUEUE_STATE;
  const raw = value as Partial<LinkQueueState>;
  return {
    permission: readPermission(raw.permission),
    progress: readProgress(raw.progress),
    failed: readFailed(raw.failed),
  };
}

export async function readLinkQueueState(): Promise<LinkQueueState> {
  const stored = await browser.storage.local.get(LINK_QUEUE_STATE_KEY);
  return normalizeLinkQueueState(stored[LINK_QUEUE_STATE_KEY]);
}

export async function writeLinkQueueState(state: LinkQueueState): Promise<void> {
  await browser.storage.local.set({ [LINK_QUEUE_STATE_KEY]: state });
}

/** Stable id for `claimed_by`, so two browsers don't look like one worker. */
export async function extensionWorkerId(): Promise<string> {
  const stored = await browser.storage.local.get(LINK_QUEUE_WORKER_KEY);
  const existing = stored[LINK_QUEUE_WORKER_KEY];
  if (typeof existing === "string" && existing.startsWith("extension:") && existing.length <= 100) {
    return existing;
  }
  const id = `extension:${crypto.randomUUID()}`;
  await browser.storage.local.set({ [LINK_QUEUE_WORKER_KEY]: id });
  return id;
}
