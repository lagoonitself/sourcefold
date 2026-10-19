import * as React from "react";
import { Trash2 } from "lucide-react";
import { Kbd } from "@/components/ui/Kbd";
import type { ReaderCleanupController } from "./use-reader-cleanup";

/** The ✕ beside the block under the pointer, and the bubble under selected text. */
export function ReaderCleanupLayer({
  cleanup,
  articleRef,
}: {
  cleanup: ReaderCleanupController;
  articleRef: React.RefObject<HTMLElement | null>;
}) {
  const { active, hoverEl, selectionRange, busy } = cleanup;
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const [button, setButton] = React.useState<{ top: number; left: number } | null>(null);
  const [bubble, setBubble] = React.useState<{ top: number; left: number } | null>(null);

  // Coordinates are the article's own, so both scroll along with the text.
  React.useLayoutEffect(() => {
    const article = articleRef.current;
    if (!active || !article || !hoverEl || !hoverEl.isConnected) {
      setButton(null);
      return;
    }
    const box = article.getBoundingClientRect();
    const rect = hoverEl.getBoundingClientRect();
    const room = (article.parentElement?.getBoundingClientRect().right ?? box.right) - box.right;
    setButton({
      top: rect.top - box.top + 2,
      left: room >= 40 ? box.width + 8 : box.width - 32,
    });
  }, [active, hoverEl, articleRef]);

  React.useLayoutEffect(() => {
    const article = articleRef.current;
    const menu = bubbleRef.current;
    if (!active || !article || !selectionRange) {
      setBubble(null);
      return;
    }
    const rects = selectionRange.getClientRects();
    const rect = rects[rects.length - 1] ?? selectionRange.getBoundingClientRect();
    const box = article.getBoundingClientRect();
    const width = menu?.offsetWidth ?? 120;
    setBubble({
      top: rect.bottom - box.top + 6,
      left: Math.max(0, Math.min(rect.left - box.left, box.width - width)),
    });
  }, [active, selectionRange, articleRef]);

  if (!active) return null;

  return (
    <>
      {button && hoverEl && !selectionRange && (
        <button
          type="button"
          data-reader-ui
          onMouseDown={(event) => event.preventDefault()}
          onClick={cleanup.removeHovered}
          disabled={busy}
          title="Remove this from the source"
          aria-label="Remove this from the source"
          style={{ top: button.top, left: button.left }}
          className="animate-pop-in absolute z-20 flex size-7 cursor-pointer items-center justify-center rounded-full border border-border bg-popover text-destructive shadow-float transition-colors select-none hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      )}

      {selectionRange && (
        <div
          ref={bubbleRef}
          role="toolbar"
          aria-label="Remove the selected text"
          data-reader-ui
          onMouseDown={(event) => event.preventDefault()}
          style={{
            top: bubble?.top ?? 0,
            left: bubble?.left ?? 0,
            visibility: bubble ? "visible" : "hidden",
          }}
          className="animate-pop-in absolute z-30 flex items-center rounded-[10px] border border-border bg-popover p-1 font-sans shadow-float select-none"
        >
          <button
            type="button"
            onClick={cleanup.removeSelection}
            disabled={busy}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Remove</span>
            <Kbd className="ml-0.5">⌫</Kbd>
          </button>
        </div>
      )}
    </>
  );
}
