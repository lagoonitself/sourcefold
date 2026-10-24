// The app's one TL;DR writer and the hooks that read it.
import * as React from "react";
import type { ItemTldr } from "@sourcefold/core";
import { loadReaderText } from "@/lib/api";
import { TldrEngine, type TldrItemState, type TldrPause } from "./tldr-engine";
import { aiComplete, getAiStatus, putTldr, type AiStatus } from "./tldr-api";

/** Called with the engine's picked groups whenever they change (set by TldrProvider). */
let groupsChangedHandler: ((groupIds: string[]) => void) | null = null;

export function setGroupsChangedHandler(handler: ((groupIds: string[]) => void) | null) {
  groupsChangedHandler = handler;
}

export const tldrEngine = new TldrEngine({
  loadText: (item) => loadReaderText(item.id),
  complete: aiComplete,
  save: putTldr,
  aiStatus: getAiStatus,
  onGroupsChanged: (ids) => groupsChangedHandler?.(ids),
});

/** Re-renders on every change of the writer. */
export function useTldrVersion(): number {
  return React.useSyncExternalStore(
    tldrEngine.subscribe,
    tldrEngine.getVersion,
    tldrEngine.getVersion,
  );
}

export interface TldrView {
  tldr: ItemTldr | null;
  state: TldrItemState | null;
}

export function useTldr(itemId: string | null | undefined): TldrView {
  useTldrVersion();
  if (!itemId) return { tldr: null, state: null };
  return {
    tldr: tldrEngine.tldrs.get(itemId) ?? null,
    state: tldrEngine.states.get(itemId) ?? null,
  };
}

export function useTldrPause(): TldrPause | null {
  useTldrVersion();
  return tldrEngine.pause;
}

export function useAiStatus(): AiStatus | null {
  useTldrVersion();
  return tldrEngine.ai;
}

export function useGroupRemaining(groupId: string): number | null {
  useTldrVersion();
  return tldrEngine.groupRemaining(groupId);
}

// ----------------- Events -----------------

export const AI_CHANGED_EVENT = "sourcefold:ai-changed";
export const PICK_GROUP_EVENT = "sourcefold:tldr-pick-group";
export const TOGGLE_PANE_EVENT = "sourcefold:tldr-toggle-pane";

/** Settings changed the provider, model, key or sign-in. */
export function notifyAiChanged() {
  window.dispatchEvent(new Event(AI_CHANGED_EVENT));
}

/** "Write TL;DRs for this group": TldrProvider counts, asks when it's many, and queues them. */
export function requestGroupTldrs(groupId: string) {
  window.dispatchEvent(
    new CustomEvent<{ groupId: string }>(PICK_GROUP_EVENT, { detail: { groupId } }),
  );
}
