import type { Highlight } from "@sourcefold/core";

/** What the last changes were, newest on top, so `z` can take them back. */
export type UndoEntry =
  | { kind: "create"; highlight: Highlight }
  | { kind: "delete"; highlight: Highlight }
  | { kind: "note"; id: string; before: string | null; after: string | null };

export interface UndoStack {
  push(entry: UndoEntry): void;
  pop(): UndoEntry | undefined;
  /** Drops entries that can no longer be applied (for example after a failed create). */
  discard(predicate: (entry: UndoEntry) => boolean): void;
  clear(): void;
  readonly size: number;
}

export function createUndoStack(limit = 50): UndoStack {
  let entries: UndoEntry[] = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > limit) entries = entries.slice(entries.length - limit);
    },
    pop: () => entries.pop(),
    discard(predicate) {
      entries = entries.filter((e) => !predicate(e));
    },
    clear() {
      entries = [];
    },
    get size() {
      return entries.length;
    },
  };
}
