import * as React from "react";
import { toast } from "sonner";
import type { ItemResearchPatch } from "@sourcefold/core";
import { updateItemResearch } from "@/lib/api";
import { applyResearch, effectivePatch, researchBefore, type ResearchItem } from "./research-logic";

export interface UseItemResearchOptions {
  /** Called after a change was saved, so the owner of the item list can reload it. */
  onSynced?: () => void | Promise<void>;
  /**
   * Drop the local copy of a change once `onSynced` finished (the list now holds the saved
   * value). Leave off when the owner's copy is not reloaded (the reader's open source).
   */
  clearAfterSync?: boolean;
}

export type PatchFor<T> = ItemResearchPatch | ((item: T) => ItemResearchPatch);

export interface ItemResearchController {
  /** The item with the changes that are saving or saved, laid over what the owner holds. */
  withResearch: <T extends ResearchItem>(item: T) => T;
  /**
   * Changes status, tags, summary, author or author type on sources. Shows the change at once,
   * saves it, and puts it back with a toast when saving fails. Resolves true when every change
   * that was needed saved.
   */
  update: <T extends ResearchItem>(targets: readonly T[], patch: PatchFor<T>) => Promise<boolean>;
  /** Forgets every local change (another source opened, or the owner reloaded its items). */
  reset: () => void;
}

/** Optimistic edits of a source's research fields, shared by the list and the reader. */
export function useItemResearch(options: UseItemResearchOptions = {}): ItemResearchController {
  const [overlay, setOverlay] = React.useState<Record<string, ItemResearchPatch>>({});
  const overlayRef = React.useRef(overlay);
  overlayRef.current = overlay;
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const versionsRef = React.useRef(new Map<string, number>());
  const counterRef = React.useRef(0);

  const withResearch = React.useCallback(
    <T extends ResearchItem>(item: T): T => {
      const changes = overlay[item.id];
      return changes ? applyResearch(item, changes) : item;
    },
    [overlay],
  );

  const update = React.useCallback(
    async <T extends ResearchItem>(targets: readonly T[], patch: PatchFor<T>): Promise<boolean> => {
      const jobs: Array<{ id: string; patch: ItemResearchPatch; before: ItemResearchPatch }> = [];
      for (const base of targets) {
        const changes = overlayRef.current[base.id];
        const item = changes ? applyResearch(base, changes) : base;
        const wanted = effectivePatch(item, typeof patch === "function" ? patch(item) : patch);
        if (wanted) jobs.push({ id: base.id, patch: wanted, before: researchBefore(item, wanted) });
      }
      if (jobs.length === 0) return true;

      const version = ++counterRef.current;
      for (const job of jobs) versionsRef.current.set(job.id, version);
      setOverlay((prev) => {
        const next = { ...prev };
        for (const job of jobs) next[job.id] = { ...prev[job.id], ...job.patch };
        return next;
      });

      const results = await Promise.allSettled(jobs.map((j) => updateItemResearch(j.id, j.patch)));
      const failed = jobs.filter((_, i) => results[i].status === "rejected");
      const saved = jobs.filter((_, i) => results[i].status === "fulfilled");
      const { onSynced, clearAfterSync } = optionsRef.current;

      if (saved.length > 0 && onSynced) {
        try {
          await onSynced();
        } catch {
          // The reload reports its own errors.
        }
      }

      const stillOurs = (id: string) => versionsRef.current.get(id) === version;
      setOverlay((prev) => {
        const next = { ...prev };
        for (const job of saved) {
          if (clearAfterSync && stillOurs(job.id)) delete next[job.id];
        }
        for (const job of failed) {
          if (!stillOurs(job.id)) continue;
          if (clearAfterSync) delete next[job.id];
          else next[job.id] = { ...prev[job.id], ...job.before };
        }
        return next;
      });

      if (failed.length > 0) {
        toast.error(
          jobs.length === 1
            ? "Couldn't save that change. Try again."
            : `Couldn't save the change on ${failed.length} of ${jobs.length} sources. Try again.`,
        );
      }
      return failed.length === 0;
    },
    [],
  );

  const reset = React.useCallback(() => {
    versionsRef.current.clear();
    setOverlay((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  return React.useMemo(() => ({ withResearch, update, reset }), [withResearch, update, reset]);
}
