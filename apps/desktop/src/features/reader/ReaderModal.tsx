import * as React from "react";
import { createPortal } from "react-dom";
import { loadReaderText } from "@/lib/api";
import { registerModalLayer } from "@/components/ui/Dialog";
import { errorMessage, openUrl } from "@/lib/utils";
import { ReaderView } from "./ReaderView";
import type { ReaderLoadState, ReaderModalProps } from "./types";
import { useReaderContent } from "./use-reader-content";
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
        if (!cancelled) setState({ status: "ready", text });
      })
      .catch((err) => {
        if (cancelled) return;
        // Text the list already holds (a note) beats an error.
        const fallback = itemRef.current?.markdown;
        if (fallback && fallback.trim()) {
          setState({ status: "ready", text: fallback });
        } else {
          setState({ status: "error", message: errorMessage(err, "Couldn't load this source.") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, itemId, attempt]);

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
  // - Escape: close the small menu, then a panel note field, then the reader
  // - o / O: open original source URL in browser
  // - ArrowDown / ArrowUp: scroll
  // - Space / Shift+Space: page down / page up
  React.useEffect(() => {
    if (!open || !item) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (!highlightsRef.current.handleEscape()) handleClose();
        return;
      }

      if (highlightsRef.current.handleKey(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

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
      />
    </div>,
    document.body,
  );
}
