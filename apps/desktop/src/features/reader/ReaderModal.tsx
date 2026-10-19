import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { registerModalLayer } from "@/components/ui/Dialog";
import { loadReaderText } from "@/lib/api";
import { errorMessage, openUrl } from "@/lib/utils";
import { ReaderView } from "./ReaderView";
import { canEditText } from "./removal";
import type { ReaderLoadState, ReaderModalProps } from "./types";
import { useReaderCleanup } from "./use-reader-cleanup";
import { useReaderContent } from "./use-reader-content";
import { useReaderFind } from "./use-reader-find";
import { useReaderHighlights } from "./useReaderHighlights";
import { useItemProjectId, useItemResearch, type SourceInfoSignals } from "../research/source-info";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

/**
 * Full-sheet reader modal for a single source.
 * Opens as a full-window sheet over the app: the desk shows as an 8px frame (like the main sheet),
 * and the sheet rises in (y 16px -> 0, opacity, 320ms spring).
 * Close reverses quickly via motion AnimatePresence.
 */
export function ReaderModal({
  item,
  open,
  onOpenChange,
  onClose,
  className,
  initialTypography = "serif",
  groupItems,
  onNavigate,
  initialHighlightId,
  initialSearch,
  onSaveLinks,
  onHighlightsChanged,
}: ReaderModalProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const [state, setState] = React.useState<ReaderLoadState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  // The list refreshes its items often; only a different source (or Retry) reloads the text.
  const itemRef = React.useRef(item);
  itemRef.current = item;
  const itemId = item?.id ?? null;

  // Preserve the last non-null item so exit animation can render cleanly without null pointer issues
  const [displayItem, setDisplayItem] = React.useState(item);
  if (item && item !== displayItem) {
    setDisplayItem(item);
  }
  const currentItem = item ?? displayItem;
  const isShown = open && item !== null;

  const projectId = useItemProjectId(currentItem, isShown);
  const research = useItemResearch({
    onSynced: () => {
      if (currentItem?.id) onHighlightsChanged?.(currentItem.id);
    },
  });
  const currentItemWithResearch = currentItem ? research.withResearch(currentItem) : null;
  const [researchSignals, setResearchSignals] = React.useState<SourceInfoSignals>({
    tags: 0,
    summary: 0,
  });

  React.useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadReaderText(itemId)
      .then((text) => {
        if (!cancelled) setState({ status: "ready", text, itemId });
      })
      .catch((err) => {
        if (cancelled) return;
        // Text the list already holds (a note) beats an error.
        const fallback = itemRef.current?.markdown;
        if (fallback && fallback.trim()) {
          setState({ status: "ready", text: fallback, itemId });
        } else {
          setState({ status: "error", message: errorMessage(err, "Couldn't load this source.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, itemId, attempt]);

  // Closed: forget the text, so the next time this source opens it is not shown stale while the
  // fresh copy loads (the search landing waits for the fresh one).
  React.useEffect(() => {
    if (!open) setState({ status: "loading" });
  }, [open]);

  // Loads the text again after it was changed here, keeping the page and scroll position.
  const reloadText = React.useCallback(async (id: string) => {
    const text = await loadReaderText(id);
    if (itemRef.current?.id === id) setState({ status: "ready", text, itemId: id });
  }, []);

  const content = useReaderContent(state.status === "ready" ? state.text : null);

  const [removing, setRemoving] = React.useState(false);

  const highlights = useReaderHighlights({
    item: currentItemWithResearch,
    open,
    bodyHtml: content.bodyHtml,
    bodyRef,
    scrollRef,
    groupItems,
    onNavigate,
    initialHighlightId,
    onSaveLinks,
    onHighlightsChanged,
    suspended: removing,
    projectId,
  });

  const cleanup = useReaderCleanup({
    open,
    itemId,
    enabled: Boolean(
      item && canEditText(item.kind) && state.status === "ready" && content.bodyHtml,
    ),
    body: content.parsed?.body ?? null,
    bodyHtml: content.bodyHtml,
    bodyRef,
    highlights,
    reloadText,
    active: removing,
    setActive: setRemoving,
  });

  const find = useReaderFind({
    open,
    itemId,
    readyItemId: state.status === "ready" ? (state.itemId ?? null) : null,
    bodyHtml: content.bodyHtml,
    noteHtml: content.noteHtml,
    bodyRef,
    scrollRef,
    initialSearch,
  });

  const handleClose = React.useCallback(() => {
    onClose?.();
    onOpenChange(false);
  }, [onClose, onOpenChange]);

  // Keep latest handlers in refs for the global key listener
  const highlightsRef = React.useRef(highlights);
  highlightsRef.current = highlights;
  const findRef = React.useRef(find);
  findRef.current = find;
  const cleanupRef = React.useRef(cleanup);
  cleanupRef.current = cleanup;

  // Focus the scroll container when the modal opens so j/k/Space shortcuts work immediately
  React.useEffect(() => {
    if (open && itemId) {
      const timer = setTimeout(() => {
        scrollRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, itemId, state.status]);

  // Register on the modal stack so overlays (search, command palette) pause background actions
  React.useEffect(() => {
    if (!isShown) return;
    return registerModalLayer();
  }, [isShown]);

  // Keyboard shortcuts (the highlight keys live in useReaderHighlights):
  // - Mod+F: find in this source; Enter / Shift+Enter move between matches while the bar is open
  // - Escape: close the small menu, then a panel note field, then the find bar, then the reader
  // - e: Remove text mode (select text or press the trash button to take it out of the source)
  // - o / O: open original source URL in browser
  // - 1 / 2 / 3 / 0: Keep, Maybe, Cut, clear status
  // - t: focus tags
  // - u: focus summary
  // - ArrowDown / ArrowUp: scroll
  // - Space / Shift+Space: page down / page up
  React.useEffect(() => {
    if (!isShown) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        findRef.current.openBar();
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (cleanupRef.current.handleEscape()) return;
        if (highlightsRef.current.handleEscape()) return;
        if (findRef.current.barOpen) {
          findRef.current.closeBar();
          return;
        }
        handleClose();
        return;
      }

      if (cleanupRef.current.handleKey(e)) return;
      if (highlightsRef.current.handleKey(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Research shortcuts: 1 Keep, 2 Maybe, 3 Cut, 0 clear, t tags, u summary
      if (e.key === "1") {
        e.preventDefault();
        if (currentItemWithResearch) {
          void research.update([currentItemWithResearch], { triage: "keep" });
        }
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        if (currentItemWithResearch) {
          void research.update([currentItemWithResearch], { triage: "maybe" });
        }
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        if (currentItemWithResearch) {
          void research.update([currentItemWithResearch], { triage: "cut" });
        }
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        if (currentItemWithResearch) {
          void research.update([currentItemWithResearch], { triage: null });
        }
        return;
      }
      if (e.key === "t") {
        e.preventDefault();
        setResearchSignals((prev) => ({ ...prev, tags: prev.tags + 1 }));
        return;
      }
      if (e.key === "u") {
        e.preventDefault();
        setResearchSignals((prev) => ({ ...prev, summary: prev.summary + 1 }));
        return;
      }

      if (
        e.key === "Enter" &&
        findRef.current.barOpen &&
        !(e.target instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        if (e.shiftKey) findRef.current.previous();
        else findRef.current.next();
        return;
      }

      // Space and Enter on a focused button press that button.
      if (e.target instanceof HTMLButtonElement && (e.key === " " || e.key === "Enter")) return;

      if (e.key === "o" || e.key === "O") {
        const url = itemRef.current?.source_url || itemRef.current?.canonical_url;
        if (url) {
          e.preventDefault();
          void openUrl(url);
          return;
        }
      }

      const scroller = scrollRef.current;
      if (!scroller) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scroller.scrollBy({ top: 80, behavior: "smooth" });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        scroller.scrollBy({ top: -80, behavior: "smooth" });
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        const delta = (scroller.clientHeight - 80) * (e.shiftKey ? -1 : 1);
        scroller.scrollBy({ top: delta, behavior: "smooth" });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isShown, handleClose, currentItemWithResearch, research]);

  return createPortal(
    <AnimatePresence>
      {isShown && currentItemWithResearch && (
        <motion.div
          key="reader-desk-backdrop"
          className="desk-grain fixed inset-0 z-50 flex flex-col p-2 select-none bg-desk"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12, ease: [0.16, 1, 0.3, 1] } }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            key="reader-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Reader: ${currentItemWithResearch.title}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12, ease: [0.16, 1, 0.3, 1] } }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-background text-foreground shadow-sheet"
          >
            <ReaderView
              item={currentItemWithResearch}
              state={state}
              onRetry={() => setAttempt((n) => n + 1)}
              onClose={handleClose}
              scrollRef={scrollRef}
              className={className}
              initialTypography={initialTypography}
              content={content}
              highlights={highlights}
              bodyRef={bodyRef}
              find={find}
              cleanup={cleanup}
              projectId={projectId}
              onUpdateResearch={(patch) => {
                if (currentItemWithResearch) {
                  void research.update([currentItemWithResearch], patch);
                }
              }}
              researchSignals={researchSignals}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
