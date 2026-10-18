import * as React from "react";
import { createPortal } from "react-dom";
import { loadReaderText } from "@/lib/api";
import { registerModalLayer } from "@/components/ui/Dialog";
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
  const highlightsRef = React.useRef(highlights);
  highlightsRef.current = highlights;
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
  const findRef = React.useRef(find);
  findRef.current = find;

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    onClose?.();
  }, [onOpenChange, onClose]);

  // Focus the scroll container when the modal opens so j/k/Space shortcuts work immediately
  React.useEffect(() => {
    if (open && itemId) {
      const timer = setTimeout(() => {
        scrollRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, itemId, state.status]);

  const isShown = open && item !== null;
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
    if (!open || !item) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        findRef.current.openBar();
        return;
      }

      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (highlightsRef.current.handleEscape()) return;
        if (findRef.current.barOpen) findRef.current.closeBar();
        else handleClose();
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
        const url = item.source_url || item.canonical_url;
        if (url) {
          e.preventDefault();
          void openUrl(url);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: 160, behavior: "smooth" });
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: -160, behavior: "smooth" });
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        const delta = e.shiftKey ? -350 : 350;
        scrollRef.current?.scrollBy({ top: delta, behavior: "smooth" });
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, item, handleClose]);

  if (!open || !item) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reader: ${item.title}`}
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-150"
    >
      <ReaderView
        item={item}
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
    </div>,
    document.body,
  );
}
