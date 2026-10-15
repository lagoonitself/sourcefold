import * as React from "react";
import { createPortal } from "react-dom";
import { getItem } from "@/lib/api";
import { registerModalLayer } from "@/components/ui/Dialog";
import { openUrl } from "@/lib/utils";
import { ReaderView } from "./ReaderView";
import type { ReaderItem, ReaderModalProps } from "./types";

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
}: ReaderModalProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [loadedItem, setLoadedItem] = React.useState<ReaderItem | null>(item);

  React.useEffect(() => {
    setLoadedItem(item);
    if (open && item && !item.markdown) {
      getItem(item.id)
        .then((full) => {
          if (full && full.id === item.id) {
            setLoadedItem((prev) => (prev ? { ...prev, ...full } : full));
          }
        })
        .catch(() => {});
    }
  }, [open, item]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
    onClose?.();
  }, [onOpenChange, onClose]);

  // Focus the scroll container when the modal opens so j/k/Space shortcuts work immediately
  React.useEffect(() => {
    if (open && loadedItem) {
      const timer = setTimeout(() => {
        scrollRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, loadedItem]);

  const isShown = open && loadedItem !== null;
  React.useEffect(() => {
    if (!isShown) return;
    return registerModalLayer();
  }, [isShown]);

  // Keyboard navigation shortcuts:
  // - Escape: close reader
  // - o / O: open original source URL in browser
  // - j / ArrowDown: scroll down
  // - k / ArrowUp: scroll up
  // - Space / Shift+Space: page down / page up
  React.useEffect(() => {
    if (!open || !loadedItem) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === "o" || e.key === "O") {
        const url = loadedItem.source_url || loadedItem.canonical_url;
        if (url) {
          e.preventDefault();
          void openUrl(url);
        }
        return;
      }

      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
        e.preventDefault();
        scrollRef.current?.scrollBy({ top: 160, behavior: "smooth" });
        return;
      }

      if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
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
  }, [open, loadedItem, handleClose]);

  if (!open || !loadedItem) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Reader: ${loadedItem.title}`}
      className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in duration-150"
    >
      <ReaderView
        item={loadedItem}
        onClose={handleClose}
        scrollRef={scrollRef}
        className={className}
        initialTypography={initialTypography}
      />
    </div>,
    document.body,
  );
}
