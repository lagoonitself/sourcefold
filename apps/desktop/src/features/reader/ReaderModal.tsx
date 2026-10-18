import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { registerModalLayer } from "@/components/ui/Dialog";
import { loadReaderText } from "@/lib/api";
import { errorMessage, openUrl } from "@/lib/utils";
import { ReaderView } from "./ReaderView";
import type { ReaderLoadState, ReaderModalProps } from "./types";
import { useReaderContent } from "./use-reader-content";
import { useReaderFind } from "./use-reader-find";
import { useReaderHighlights } from "./useReaderHighlights";

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

  const content = useReaderContent(state.status === "ready" ? state.text : null);

  const highlights = useReaderHighlights({
    item,
    open,
    bodyHtml: content.bodyHtml,
    bodyRef,
    scrollRef,
    groupItems,
    onNavigate,
    initialHighlightId,
    onSaveLinks,
    onHighlightsChanged,
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

  const isShown = open && item !== null;

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
  // - o / O: open original source URL in browser
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
        if (highlightsRef.current.handleEscape()) return;
        if (findRef.current.barOpen) {
          findRef.current.closeBar();
          return;
        }
        handleClose();
        return;
      }

      if (highlightsRef.current.handleKey(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

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
  }, [isShown, handleClose]);

  return createPortal(
    <AnimatePresence>
      {isShown && currentItem && (
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
            aria-label={`Reader: ${currentItem.title}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.12, ease: [0.16, 1, 0.3, 1] } }}
            transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-background text-foreground shadow-sheet"
          >
            <ReaderView
              item={currentItem}
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
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
