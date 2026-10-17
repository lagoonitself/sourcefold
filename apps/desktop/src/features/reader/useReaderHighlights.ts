import * as React from "react";
import { toast } from "sonner";
import {
  copySourceFromItem,
  formatQuoteWithSource,
  HIGHLIGHT_LIMITS,
  type Highlight,
  type HighlightInput,
} from "@sourcefold/core";
import { deleteHighlight, getHighlights, putHighlight, updateHighlightNote } from "@/lib/api";
import {
  captureContext,
  locateHighlight,
  overlappingIds,
  trimRange,
  type Placement,
} from "./anchoring";
import {
  blockRange,
  firstVisibleBlock,
  highlightIdInBlock,
  listBlocks,
  setFocusedBlock,
} from "./blocks";
import {
  clearMarks,
  collectFootnotes,
  collectTimestamps,
  elementsForHighlight,
  findImage,
  highlightIdAt,
  MARK_ATTR,
  offsetBefore,
  rangeToOffsets,
  wrapOffsets,
} from "./dom-anchoring";
import { citationsInRange, secondsAt, type FootnoteDef } from "./extract";
import { openTargetFor } from "./open-decision";
import type { ReaderItem } from "./types";
import { createUndoStack, type UndoEntry } from "./undo-stack";
import { savedUrlKeys } from "./url-key";

const AUTO_KEY = "sourcefold:reader:autoHighlight";
const PANEL_KEY = "sourcefold:reader:highlightsPanel";

export type PanelTab = "highlights" | "cited";

export interface ReaderHighlightsArgs {
  item: ReaderItem | null;
  open: boolean;
  /** The rendered body; changes whenever the text on screen is replaced. */
  bodyHtml: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  groupItems?: ReaderItem[];
  onNavigate?: (item: ReaderItem) => void;
  initialHighlightId?: string | null;
  onSaveLinks?: (urls: string[], folderId: string) => void;
  onHighlightsChanged?: (itemId: string) => void;
}

export type ReaderReference = FootnoteDef;

export interface ReaderHighlightsController {
  highlights: Highlight[];
  loadState: "loading" | "ready" | "error";
  /** Ids placed in the text (or on an image). Null until the body has been measured. */
  anchored: ReadonlySet<string> | null;
  /** Reading-order start of each highlight, from where it was found in the current text. */
  starts: ReadonlyMap<string, number>;
  currentId: string | null;
  menu: { id: string; editing: boolean } | null;
  panelNoteId: string | null;
  autoHighlight: boolean;
  panelOpen: boolean;
  panelTab: PanelTab;
  hasReferences: boolean;
  references: ReaderReference[];
  savedKeys: ReadonlySet<string>;
  canSaveLinks: boolean;
  position: { index: number; total: number } | null;
  setAutoHighlight: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelTab: (tab: PanelTab) => void;
  togglePanel: () => void;
  openMenu: (id: string, editing?: boolean) => void;
  closeMenu: () => void;
  startPanelNote: (id: string | null) => void;
  saveNote: (id: string, note: string) => void;
  /** Closes a note field (menu or panel) and returns the keyboard to the text. */
  cancelNote: () => void;
  copyHighlight: (id: string) => void;
  removeHighlight: (id: string) => void;
  jumpTo: (id: string) => void;
  saveLinks: (urls: string[]) => void;
  navigate: (delta: 1 | -1) => void;
  handleBodyClick: (event: React.MouseEvent<HTMLElement>) => boolean;
  /** Returns true when the key was used. */
  handleKey: (event: KeyboardEvent) => boolean;
  /** Closes the innermost small layer; false when nothing was open. */
  handleEscape: () => boolean;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return fallback;
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sortHighlights(list: Highlight[]): Highlight[] {
  return [...list].sort(
    (a, b) =>
      a.start_offset - b.start_offset ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

function toInput(h: Highlight): HighlightInput {
  const { created_at: _created, updated_at: _updated, ...input } = h;
  return input;
}

function sameSet(a: ReadonlySet<string> | null, b: ReadonlySet<string>): boolean {
  if (!a || a.size !== b.size) return false;
  for (const v of b) if (!a.has(v)) return false;
  return true;
}

const CITING_KINDS = new Set(["grokipedia", "wikipedia"]);

export function useReaderHighlights(args: ReaderHighlightsArgs): ReaderHighlightsController {
  const { item, open, bodyHtml, bodyRef, scrollRef, groupItems, initialHighlightId } = args;
  const itemId = item?.id ?? null;

  const [highlights, setHighlights] = React.useState<Highlight[]>([]);
  const [loadState, setLoadState] = React.useState<"loading" | "ready" | "error">("loading");
  const [anchored, setAnchored] = React.useState<ReadonlySet<string> | null>(null);
  const [starts, setStarts] = React.useState<ReadonlyMap<string, number>>(new Map());
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<{ id: string; editing: boolean } | null>(null);
  const [panelNoteId, setPanelNoteId] = React.useState<string | null>(null);
  const [autoHighlight, setAutoState] = React.useState(() => readFlag(AUTO_KEY, true));
  const [panelOpen, setPanelState] = React.useState(() => readFlag(PANEL_KEY, false));
  const [panelTab, setPanelTab] = React.useState<PanelTab>("highlights");
  const [references, setReferences] = React.useState<ReaderReference[]>([]);

  const itemIdRef = React.useRef(itemId);
  itemIdRef.current = itemId;
  const undoRef = React.useRef(createUndoStack());
  const queueRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const failedRef = React.useRef(new Set<string>());
  const placementsRef = React.useRef(new Map<string, Placement>());
  const focusedRef = React.useRef<HTMLElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const handledInitialRef = React.useRef<string | null>(null);

  const kind = item?.kind ?? "";
  const cites = CITING_KINDS.has(kind);
  const highlightsRef = React.useRef(highlights);
  highlightsRef.current = highlights;

  // ---- loading -------------------------------------------------------------------------------
  React.useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    setHighlights([]);
    setLoadState("loading");
    setAnchored(null);
    setCurrentId(null);
    setMenu(null);
    setPanelNoteId(null);
    focusedRef.current = null;
    undoRef.current.clear();
    failedRef.current.clear();
    handledInitialRef.current = null;
    getHighlights({ itemId })
      .then((list) => {
        if (cancelled) return;
        setHighlights(sortHighlights(list));
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
        toast.error("Couldn't load your highlights. Close this source and open it again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, itemId]);

  // ---- marks on the page ---------------------------------------------------------------------
  React.useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || !open) return;
    clearMarks(root);
    const text = root.textContent ?? "";
    const placements = new Map<string, Placement>();
    const ok = new Set<string>();
    const startMap = new Map<string, number>();
    for (const h of highlights) {
      if (h.kind === "image") {
        const img = h.image_src ? findImage(root, h.image_src, h.start_offset) : null;
        if (img) {
          img.setAttribute(MARK_ATTR, h.id);
          img.classList.add("reader-image-highlight");
          ok.add(h.id);
          startMap.set(h.id, offsetBefore(root, img));
        }
        continue;
      }
      const placement = locateHighlight(text, h);
      if (!placement) continue;
      placements.set(h.id, placement);
      wrapOffsets(root, placement.start, placement.end, h.id, "reader-highlight");
      ok.add(h.id);
      startMap.set(h.id, placement.start);
    }
    placementsRef.current = placements;
    setAnchored((prev) => (sameSet(prev, ok) ? prev : ok));
    setStarts(startMap);
    if (currentId) {
      for (const el of elementsForHighlight(root, currentId)) el.classList.add("is-current");
    }
    // `currentId` only recolours; it must not rebuild the marks.
  }, [highlights, bodyHtml, open, bodyRef]);

  React.useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll(".is-current"))) {
      el.classList.remove("is-current");
    }
    if (currentId) {
      for (const el of elementsForHighlight(root, currentId)) el.classList.add("is-current");
    }
  }, [currentId, bodyRef]);

  // The article's reference list, for the "Cited sources" tab.
  React.useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || !cites) {
      setReferences([]);
      return;
    }
    setReferences(Array.from(collectFootnotes(root).defs.values()));
  }, [bodyHtml, cites, bodyRef]);

  // ---- saving, in order ----------------------------------------------------------------------
  const enqueue = React.useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const changed = React.useCallback(
    (id: string) => {
      args.onHighlightsChanged?.(id);
    },
    [args.onHighlightsChanged],
  );

  const addLocal = React.useCallback((h: Highlight) => {
    if (itemIdRef.current !== h.item_id) return;
    setHighlights((prev) => sortHighlights([...prev.filter((x) => x.id !== h.id), h]));
  }, []);

  const removeLocal = React.useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    setCurrentId((cur) => (cur === id ? null : cur));
    setMenu((cur) => (cur?.id === id ? null : cur));
    setPanelNoteId((cur) => (cur === id ? null : cur));
  }, []);

  const persistPut = React.useCallback(
    (h: Highlight, onFail: () => void) => {
      failedRef.current.delete(h.id);
      void enqueue(async () => {
        try {
          const saved = await putHighlight(toInput(h));
          if (itemIdRef.current === h.item_id) {
            setHighlights((prev) =>
              prev.map((x) =>
                x.id === saved.id
                  ? { ...x, created_at: saved.created_at, updated_at: saved.updated_at }
                  : x,
              ),
            );
          }
          changed(h.item_id);
        } catch {
          failedRef.current.add(h.id);
          onFail();
        }
      });
    },
    [enqueue, changed],
  );

  const persistDelete = React.useCallback(
    (h: Highlight, onFail: () => void) => {
      void enqueue(async () => {
        if (failedRef.current.has(h.id)) return;
        try {
          await deleteHighlight(h.id);
          changed(h.item_id);
        } catch {
          onFail();
        }
      });
    },
    [enqueue, changed],
  );

  const persistNote = React.useCallback(
    (h: Highlight, note: string | null, onFail: () => void) => {
      void enqueue(async () => {
        if (failedRef.current.has(h.id)) return;
        try {
          await updateHighlightNote(h.id, note);
          changed(h.item_id);
        } catch {
          onFail();
        }
      });
    },
    [enqueue, changed],
  );

  // ---- changes -------------------------------------------------------------------------------
  const createHighlight = React.useCallback(
    (draft: Omit<HighlightInput, "id" | "item_id" | "note">) => {
      if (!itemIdRef.current) return;
      const now = new Date().toISOString();
      const h: Highlight = {
        ...draft,
        id: newId(),
        item_id: itemIdRef.current,
        note: null,
        created_at: now,
        updated_at: now,
      };
      addLocal(h);
      setCurrentId(h.id);
      setMenu({ id: h.id, editing: false });
      undoRef.current.push({ kind: "create", highlight: h });
      persistPut(h, () => {
        removeLocal(h.id);
        undoRef.current.discard((e) =>
          e.kind === "note" ? e.id === h.id : e.highlight.id === h.id,
        );
        toast.error("Couldn't save the highlight. Select the passage again to retry.");
      });
    },
    [addLocal, persistPut, removeLocal],
  );

  const removeHighlight = React.useCallback(
    (id: string, record = true) => {
      const h = highlightsRef.current.find((x) => x.id === id);
      if (!h) return;
      removeLocal(id);
      if (record) {
        undoRef.current.push({ kind: "delete", highlight: h });
        toast.success("Highlight deleted. Press z to undo.");
      }
      persistDelete(h, () => {
        addLocal(h);
        toast.error("Couldn't delete the highlight. Try again.");
      });
    },
    [addLocal, persistDelete, removeLocal],
  );

  const setNote = React.useCallback(
    (id: string, raw: string, record = true) => {
      const h = highlightsRef.current.find((x) => x.id === id);
      if (!h) return;
      const note = raw.trim() ? raw.trim().slice(0, HIGHLIGHT_LIMITS.note) : null;
      if (note === h.note) return;
      setHighlights((prev) => prev.map((x) => (x.id === id ? { ...x, note } : x)));
      if (record) undoRef.current.push({ kind: "note", id, before: h.note, after: note });
      persistNote(h, note, () => {
        setHighlights((prev) => prev.map((x) => (x.id === id ? { ...x, note: h.note } : x)));
        toast.error("Couldn't save the note. Try again.");
      });
    },
    [persistNote],
  );

  const saveNote = React.useCallback(
    (id: string, note: string) => {
      setNote(id, note);
      setMenu((cur) => (cur?.id === id ? { id, editing: false } : cur));
      setPanelNoteId((cur) => (cur === id ? null : cur));
      scrollRef.current?.focus({ preventScroll: true });
    },
    [scrollRef, setNote],
  );

  const cancelNote = React.useCallback(() => {
    setMenu((cur) => (cur?.editing ? { id: cur.id, editing: false } : cur));
    setPanelNoteId(null);
    scrollRef.current?.focus({ preventScroll: true });
  }, [scrollRef]);

  const undo = React.useCallback(() => {
    const entry: UndoEntry | undefined = undoRef.current.pop();
    if (!entry) {
      toast.message("Nothing to undo");
      return;
    }
    if (entry.kind === "create") {
      removeHighlight(entry.highlight.id, false);
      toast.success("Highlight removed");
    } else if (entry.kind === "delete") {
      const h = entry.highlight;
      addLocal(h);
      setCurrentId(h.id);
      persistPut(h, () => {
        removeLocal(h.id);
        toast.error("Couldn't restore the highlight. Select the passage again.");
      });
      toast.success("Highlight restored");
    } else {
      setNote(entry.id, entry.before ?? "", false);
      toast.success("Note restored");
    }
  }, [addLocal, persistPut, removeHighlight, removeLocal, setNote]);

  const copyHighlight = React.useCallback(
    (id: string) => {
      const h = highlightsRef.current.find((x) => x.id === id);
      if (!h || !item) return;
      navigator.clipboard
        .writeText(formatQuoteWithSource(h, copySourceFromItem(item)))
        .then(() => toast.success("Copied with source"))
        .catch(() => toast.error("Couldn't copy. Allow clipboard access and try again."));
    },
    [item],
  );

  // ---- making highlights ---------------------------------------------------------------------
  const flash = React.useCallback(
    (id: string) => {
      const root = bodyRef.current;
      if (!root) return;
      const els = elementsForHighlight(root, id);
      for (const el of els) el.classList.add("is-flash");
      window.setTimeout(() => {
        for (const el of els) el.classList.remove("is-flash");
      }, 1200);
    },
    [bodyRef],
  );

  const jumpTo = React.useCallback(
    (id: string) => {
      const root = bodyRef.current;
      if (!root) return;
      const first = elementsForHighlight(root, id)[0];
      if (!first) return;
      first.scrollIntoView({
        block: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      setCurrentId(id);
      flash(id);
    },
    [bodyRef, flash],
  );

  const openMenu = React.useCallback((id: string, editing = false) => {
    setCurrentId(id);
    setMenu({ id, editing });
  }, []);

  const closeMenu = React.useCallback(() => setMenu(null), []);

  /** An existing highlight that the new range touches wins: overlaps are never merged or nested. */
  const existingAt = React.useCallback((start: number, end: number): string | null => {
    const placed = highlightsRef.current
      .filter((h) => h.kind === "text" && placementsRef.current.has(h.id))
      .map((h) => ({ id: h.id, ...(placementsRef.current.get(h.id) as Placement) }));
    return overlappingIds(placed, start, end)[0] ?? null;
  }, []);

  const createFromRange = React.useCallback(
    (root: HTMLElement, range: Range): boolean => {
      const offsets = rangeToOffsets(root, range);
      if (!offsets) return false;
      const text = root.textContent ?? "";
      const trimmed = trimRange(text, offsets.start, offsets.end);
      if (!trimmed) return false;
      window.getSelection()?.removeAllRanges();
      const existing = existingAt(trimmed.start, trimmed.end);
      if (existing) {
        openMenu(existing);
        return true;
      }
      if (trimmed.end - trimmed.start > HIGHLIGHT_LIMITS.quote) {
        toast.error("That passage is too long to highlight. Select less than 10,000 characters.");
        return true;
      }
      const context = captureContext(text, trimmed.start, trimmed.end);
      let seconds: number | null = null;
      if (kind === "youtube") {
        const transcript = collectTimestamps(root);
        seconds = secondsAt(transcript.marks, trimmed.start, transcript.end);
      }
      let cited: ReturnType<typeof citationsInRange> = [];
      if (cites) {
        const notes = collectFootnotes(root);
        cited = citationsInRange(
          notes.refs,
          notes.defs,
          trimmed.start,
          trimmed.end,
          HIGHLIGHT_LIMITS.cited,
        );
      }
      createHighlight({
        kind: "text",
        ...context,
        start_offset: trimmed.start,
        end_offset: trimmed.end,
        image_src: null,
        seconds,
        cited,
      });
      return true;
    },
    [cites, createHighlight, existingAt, kind, openMenu],
  );

  const createFromBlock = React.useCallback(
    (root: HTMLElement, block: HTMLElement): boolean => {
      if (block.tagName === "IMG") {
        const existing = highlightIdAt(block);
        if (existing) {
          openMenu(existing);
          return true;
        }
        const src = block.getAttribute("src");
        if (!src) return false;
        const at = offsetBefore(root, block);
        createHighlight({
          kind: "image",
          quote: (block.getAttribute("alt") ?? "").slice(0, HIGHLIGHT_LIMITS.quote),
          prefix: "",
          suffix: "",
          start_offset: at,
          end_offset: at,
          image_src: src,
          seconds: null,
          cited: [],
        });
        return true;
      }
      return createFromRange(root, blockRange(block));
    },
    [createFromRange, createHighlight, openMenu],
  );

  const selectionInBody = React.useCallback((): Range | null => {
    const root = bodyRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    return root.contains(range.startContainer) && root.contains(range.endContainer) ? range : null;
  }, [bodyRef]);

  // Mouse selection: highlight on release, unless Alt is held or auto-highlight is off.
  const autoRef = React.useRef(autoHighlight);
  autoRef.current = autoHighlight;
  React.useEffect(() => {
    if (!open || !itemId) return;
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-reader-ui]")) return;
      if (selectionInBody()) {
        // The click that follows a drag must not follow a link the drag ended on.
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
      }
      if (!autoRef.current || event.altKey) return;
      // Let the browser settle the selection (a click inside a selection collapses it on release).
      window.setTimeout(() => {
        const root = bodyRef.current;
        const range = selectionInBody();
        if (root && range) createFromRange(root, range);
      }, 0);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [open, itemId, bodyRef, createFromRange, selectionInBody]);

  const handleBodyClick = React.useCallback(
    (event: React.MouseEvent<HTMLElement>): boolean => {
      if (suppressClickRef.current) {
        event.preventDefault();
        return true;
      }
      const target = event.target as HTMLElement;
      if (target.closest("a")) return false;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return false;
      const id = highlightIdAt(target);
      if (!id) return false;
      openMenu(id);
      return true;
    },
    [openMenu],
  );

  // ---- keyboard focus on blocks --------------------------------------------------------------
  const focusBlock = React.useCallback((root: HTMLElement, block: HTMLElement) => {
    focusedRef.current = block;
    setFocusedBlock(root, block);
    block.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    setMenu(null);
    setCurrentId(highlightIdInBlock(block));
  }, []);

  const moveFocus = React.useCallback(
    (delta: 1 | -1) => {
      const root = bodyRef.current;
      const scroller = scrollRef.current;
      if (!root || !scroller) return;
      const blocks = listBlocks(root);
      if (blocks.length === 0) return;
      const current = focusedRef.current;
      const at = current && root.contains(current) ? blocks.indexOf(current) : -1;
      const next =
        at === -1
          ? (firstVisibleBlock(blocks, scroller.getBoundingClientRect().top) ?? blocks[0])
          : blocks[Math.min(blocks.length - 1, Math.max(0, at + delta))];
      focusBlock(root, next);
    },
    [bodyRef, focusBlock, scrollRef],
  );

  const highlightNow = React.useCallback(() => {
    const root = bodyRef.current;
    if (!root) return;
    const range = selectionInBody();
    if (range) {
      createFromRange(root, range);
      return;
    }
    const focused = focusedRef.current;
    if (focused && root.contains(focused)) {
      createFromBlock(root, focused);
      return;
    }
    toast.message("Select text, or press j to focus a paragraph, then press h.");
  }, [bodyRef, createFromBlock, createFromRange, selectionInBody]);

  // ---- panel, navigation ---------------------------------------------------------------------
  const setAutoHighlight = React.useCallback((on: boolean) => {
    setAutoState(on);
    writeFlag(AUTO_KEY, on);
  }, []);

  const setPanelOpen = React.useCallback((on: boolean) => {
    setPanelState(on);
    writeFlag(PANEL_KEY, on);
  }, []);

  const togglePanel = React.useCallback(() => {
    setPanelState((prev) => {
      writeFlag(PANEL_KEY, !prev);
      return !prev;
    });
  }, []);

  const navItems = React.useMemo(
    () => (groupItems ?? []).filter((g) => g.id === itemId || openTargetFor(g) === "reader"),
    [groupItems, itemId],
  );
  const navIndex = navItems.findIndex((g) => g.id === itemId);
  const position = navIndex === -1 ? null : { index: navIndex + 1, total: navItems.length };

  const navigate = React.useCallback(
    (delta: 1 | -1) => {
      if (!args.onNavigate || navIndex === -1) return;
      const next = navItems[navIndex + delta];
      if (next) args.onNavigate(next);
    },
    [args.onNavigate, navIndex, navItems],
  );

  const savedKeys = React.useMemo(() => savedUrlKeys(groupItems ?? []), [groupItems]);
  const canSaveLinks = Boolean(args.onSaveLinks && item?.folder_id);

  const saveLinks = React.useCallback(
    (urls: string[]) => {
      if (urls.length === 0 || !item?.folder_id) return;
      args.onSaveLinks?.(urls, item.folder_id);
    },
    [args.onSaveLinks, item?.folder_id],
  );

  // ---- jump to the highlight the group list asked for ----------------------------------------
  React.useEffect(() => {
    if (!initialHighlightId || anchored === null || loadState !== "ready") return;
    if (handledInitialRef.current === `${itemId}:${initialHighlightId}`) return;
    handledInitialRef.current = `${itemId}:${initialHighlightId}`;
    if (anchored.has(initialHighlightId)) {
      jumpTo(initialHighlightId);
    } else if (highlightsRef.current.some((h) => h.id === initialHighlightId)) {
      setPanelOpen(true);
      setPanelTab("highlights");
    }
  }, [initialHighlightId, anchored, loadState, itemId, jumpTo, setPanelOpen]);

  // ---- keys ----------------------------------------------------------------------------------
  const handleEscape = React.useCallback((): boolean => {
    if (menu) {
      setMenu(null);
      return true;
    }
    if (panelNoteId) {
      setPanelNoteId(null);
      return true;
    }
    return false;
  }, [menu, panelNoteId]);

  const handleKey = React.useCallback(
    (e: KeyboardEvent): boolean => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return true;
      }
      if (mod || e.altKey) return false;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const onControl =
        target instanceof HTMLButtonElement ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLAnchorElement;
      const key = e.key;
      const current = currentId && highlightsRef.current.some((h) => h.id === currentId);

      if (key === "H" && e.shiftKey) {
        e.preventDefault();
        togglePanel();
        return true;
      }
      if (key === "j" || key === "k") {
        e.preventDefault();
        moveFocus(key === "j" ? 1 : -1);
        return true;
      }
      if (key === "h") {
        e.preventDefault();
        highlightNow();
        return true;
      }
      if (key === "z") {
        e.preventDefault();
        undo();
        return true;
      }
      if (key === "[" || key === "]") {
        if (!args.onNavigate) return false;
        e.preventDefault();
        navigate(key === "]" ? 1 : -1);
        return true;
      }
      if (onControl && (key === "Backspace" || key === "Delete")) return false;
      if (current && currentId) {
        if (key === "n") {
          e.preventDefault();
          openMenu(currentId, true);
          return true;
        }
        if (key === "c") {
          e.preventDefault();
          copyHighlight(currentId);
          return true;
        }
        if (key === "Backspace" || key === "Delete") {
          e.preventDefault();
          removeHighlight(currentId);
          return true;
        }
      }
      return false;
    },
    [
      args.onNavigate,
      copyHighlight,
      currentId,
      highlightNow,
      moveFocus,
      navigate,
      openMenu,
      removeHighlight,
      togglePanel,
      undo,
    ],
  );

  return {
    highlights,
    loadState,
    anchored,
    starts,
    currentId,
    menu,
    panelNoteId,
    autoHighlight,
    panelOpen,
    panelTab,
    hasReferences: cites,
    references,
    savedKeys,
    canSaveLinks,
    position,
    setAutoHighlight,
    setPanelOpen,
    setPanelTab,
    togglePanel,
    openMenu,
    closeMenu,
    startPanelNote: setPanelNoteId,
    saveNote,
    cancelNote,
    copyHighlight,
    removeHighlight: (id: string) => removeHighlight(id),
    jumpTo,
    saveLinks,
    navigate,
    handleBodyClick,
    handleKey,
    handleEscape,
  };
}
