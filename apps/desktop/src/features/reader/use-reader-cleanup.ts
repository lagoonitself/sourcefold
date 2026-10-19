import * as React from "react";
import { toast } from "sonner";
import type { Highlight } from "@sourcefold/core";
import {
  SOURCE_SPAN_ATTR,
  removeFromBody,
  renderMarkdown,
  type RemoveTarget,
} from "@sourcefold/core/reader";
import { updateItemBody } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import {
  describeHtml,
  lostHighlights,
  removalMessage,
  targetForBlock,
  targetsForRange,
} from "./removal";
import type { ReaderHighlightsController } from "./useReaderHighlights";

export const REMOVE_HOVER_CLASS = "reader-remove-hover";

export interface ReaderCleanupArgs {
  open: boolean;
  itemId: string | null;
  /** The source's kind allows editing and its text has loaded. */
  enabled: boolean;
  /** The body as saved (the file without front matter, title, source line and note). */
  body: string | null;
  bodyHtml: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  highlights: ReaderHighlightsController;
  /** Loads the source's file again after a change, without the loading screen. */
  reloadText: (itemId: string) => Promise<void>;
  active: boolean;
  setActive: (on: boolean) => void;
}

export interface ReaderCleanupController {
  enabled: boolean;
  /** "Remove text" mode: selecting text offers to remove it instead of highlighting it. */
  active: boolean;
  setActive: (on: boolean) => void;
  toggle: () => void;
  busy: boolean;
  /** The block under the pointer, which the ✕ button beside it would remove. */
  hoverEl: HTMLElement | null;
  /** The selected text in the body, which the bubble would remove. */
  selectionRange: Range | null;
  removeHovered: () => void;
  removeSelection: () => void;
  editing: boolean;
  openEditor: () => void;
  closeEditor: () => void;
  saveEditor: (text: string) => Promise<void>;
  /** The body as saved, for the editor. */
  body: string;
  /** Returns true when the key was used. */
  handleKey: (event: KeyboardEvent) => boolean;
  /** Closes the innermost layer (selection, then the mode); false when nothing was open. */
  handleEscape: () => boolean;
}

interface LastChange {
  itemId: string;
  previous: string;
  lost: Highlight[];
}

export function useReaderCleanup(args: ReaderCleanupArgs): ReaderCleanupController {
  const { open, itemId, enabled, body, bodyHtml, bodyRef, highlights, reloadText } = args;
  const { active, setActive } = args;

  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [hoverEl, setHoverEl] = React.useState<HTMLElement | null>(null);
  const [selectionRange, setSelectionRange] = React.useState<Range | null>(null);
  const lastChangeRef = React.useRef<LastChange | null>(null);
  const busyRef = React.useRef(false);

  const latest = React.useRef({ body, highlights, itemId, reloadText });
  latest.current = { body, highlights, itemId, reloadText };

  // A different source starts clean.
  React.useEffect(() => {
    setActive(false);
    setEditing(false);
    setHoverEl(null);
    setSelectionRange(null);
    lastChangeRef.current = null;
  }, [itemId, open, setActive]);

  React.useEffect(() => {
    if (!enabled) {
      setActive(false);
      setEditing(false);
    }
  }, [enabled, setActive]);

  // The block under the pointer, tinted so it is clear what the ✕ would take away.
  React.useEffect(() => {
    if (!active) {
      setHoverEl(null);
      setSelectionRange(null);
      return;
    }
    const root = bodyRef.current;
    if (!root) return;

    const onOver = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const block = target?.closest<HTMLElement>(`[${SOURCE_SPAN_ATTR}]`) ?? null;
      if (block && root.contains(block)) setHoverEl(block);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-reader-ui]")) return;
      setSelectionRange(null);
    };
    const readSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      setSelectionRange(range.cloneRange());
    };
    // Let the browser settle the selection before reading it (a click inside it collapses it).
    const onUp = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-reader-ui]")) return;
      window.setTimeout(readSelection, 0);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.shiftKey) readSelection();
    };

    root.addEventListener("mouseover", onOver);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      root.removeEventListener("mouseover", onOver);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, bodyRef, bodyHtml]);

  React.useEffect(() => {
    hoverEl?.classList.add(REMOVE_HOVER_CLASS);
    return () => hoverEl?.classList.remove(REMOVE_HOVER_CLASS);
  }, [hoverEl]);

  // New text on the page: the block and the selection pointed into the old one.
  React.useEffect(() => {
    setHoverEl(null);
    setSelectionRange(null);
  }, [bodyHtml]);

  const undo = React.useCallback(async () => {
    const change = lastChangeRef.current;
    if (!change || busyRef.current) return;
    lastChangeRef.current = null;
    busyRef.current = true;
    setBusy(true);
    try {
      await updateItemBody(change.itemId, change.previous);
    } catch (err) {
      lastChangeRef.current = change;
      toast.error(errorMessage(err, "Couldn't put the text back. Try again."));
      return;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    latest.current.highlights.restoreHighlights(change.lost);
    try {
      await latest.current.reloadText(change.itemId);
      toast.success("Put the text back.");
    } catch {
      toast.error("Put back. Close this source and open it again to see it.");
    }
  }, []);

  /** Saves `next` as the source's text, then shows it. Undo puts the old text back. */
  const commit = React.useCallback(
    async (next: string, message: (lost: number) => string): Promise<boolean> => {
      const { body: previous, highlights: marks, itemId: id } = latest.current;
      const root = bodyRef.current;
      if (previous === null || !id || !root || busyRef.current) return false;

      const nextHtml = renderMarkdown(next, { sourceMap: true });
      const lost = lostHighlights(
        marks.highlights,
        describeHtml(root.innerHTML),
        describeHtml(nextHtml),
      );

      busyRef.current = true;
      setBusy(true);
      try {
        await updateItemBody(id, next);
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't save the change. Nothing was removed."));
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }

      marks.dropHighlights(lost.map((h) => h.id));
      lastChangeRef.current = { itemId: id, previous, lost };
      try {
        await latest.current.reloadText(id);
      } catch {
        toast.error("Saved. Close this source and open it again to see the change.");
        return true;
      }
      toast(message(lost.length), {
        duration: 10000,
        action: { label: "Undo", onClick: () => void undo() },
      });
      return true;
    },
    [bodyRef, undo],
  );

  const removeTargets = React.useCallback(
    async (targets: RemoveTarget[]) => {
      const { body: current } = latest.current;
      if (current === null || targets.length === 0) return;
      const result = removeFromBody(current, targets);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      await commit(result.markdown, (lost) => removalMessage(targets.length, lost));
    },
    [commit],
  );

  const removeHovered = React.useCallback(() => {
    const target = hoverEl ? targetForBlock(hoverEl) : null;
    if (!target) return;
    setHoverEl(null);
    void removeTargets([target]);
  }, [hoverEl, removeTargets]);

  const removeSelection = React.useCallback(() => {
    const root = bodyRef.current;
    if (!root || !selectionRange) return;
    const targets = targetsForRange(root, selectionRange);
    window.getSelection()?.removeAllRanges();
    setSelectionRange(null);
    if (targets.length === 0) {
      toast.message("Select some of the text first.");
      return;
    }
    void removeTargets(targets);
  }, [bodyRef, removeTargets, selectionRange]);

  const saveEditor = React.useCallback(
    async (text: string) => {
      const next = text.replace(/\r\n?/g, "\n").trim();
      if (next === (latest.current.body ?? "").trim()) {
        setEditing(false);
        return;
      }
      const saved = await commit(next, (lost) =>
        lost === 0
          ? "Saved your edits to this source."
          : `Saved your edits. ${lost === 1 ? "1 highlight" : `${lost} highlights`} in removed text went with it.`,
      );
      if (saved) setEditing(false);
    },
    [commit],
  );

  const toggle = React.useCallback(() => {
    if (!enabled) return;
    setActive(!active);
  }, [active, enabled, setActive]);

  const handleEscape = React.useCallback((): boolean => {
    if (editing) {
      setEditing(false);
      return true;
    }
    if (selectionRange) {
      window.getSelection()?.removeAllRanges();
      setSelectionRange(null);
      return true;
    }
    if (active) {
      setActive(false);
      return true;
    }
    return false;
  }, [active, editing, selectionRange, setActive]);

  const handleKey = React.useCallback(
    (event: KeyboardEvent): boolean => {
      const mod = event.ctrlKey || event.metaKey;
      if (!enabled || event.altKey) return false;
      if (!mod && event.key === "e") {
        event.preventDefault();
        setActive(!active);
        return true;
      }
      if (!active) return false;
      if (!mod && (event.key === "Backspace" || event.key === "Delete") && selectionRange) {
        event.preventDefault();
        removeSelection();
        return true;
      }
      if (event.key.toLowerCase() === "z" && !event.shiftKey && lastChangeRef.current) {
        event.preventDefault();
        void undo();
        return true;
      }
      // Highlighting is off while removing text.
      if (!mod && event.key === "h") return true;
      return false;
    },
    [active, enabled, removeSelection, selectionRange, setActive, undo],
  );

  return {
    enabled,
    active,
    setActive,
    toggle,
    busy,
    hoverEl,
    selectionRange,
    removeHovered,
    removeSelection,
    editing,
    openEditor: () => setEditing(true),
    closeEditor: () => setEditing(false),
    saveEditor,
    body: body ?? "",
    handleKey,
    handleEscape,
  };
}
