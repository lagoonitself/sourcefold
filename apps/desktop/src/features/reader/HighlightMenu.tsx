import * as React from "react";
import { Copy, Film, Quote, StickyNote, Trash2 } from "lucide-react";
import type { Highlight } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { cn, openUrl } from "@/lib/utils";
import { elementsForHighlight } from "./dom-anchoring";
import { domainOf } from "./extract";
import { NoteEditor } from "./NoteEditor";
import type { ReaderHighlightsController } from "./useReaderHighlights";
import { urlKey } from "./url-key";

/** The small menu under a highlight: Note, Copy with source, Delete, and the sources it cites. */
export function HighlightMenu({
  highlight,
  editing,
  controller,
  bodyRef,
  wrapperRef,
}: {
  highlight: Highlight;
  editing: boolean;
  controller: ReaderHighlightsController;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  wrapperRef: React.RefObject<HTMLElement | null>;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const { closeMenu, saveNote, copyHighlight, removeHighlight, saveLinks } = controller;

  // Sit under the last line of the highlight, in the wrapper's own coordinates so it scrolls along.
  React.useLayoutEffect(() => {
    const root = bodyRef.current;
    const wrapper = wrapperRef.current;
    const menu = menuRef.current;
    if (!root || !wrapper || !menu) return;
    const parts = elementsForHighlight(root, highlight.id);
    const last = parts[parts.length - 1];
    if (!last) {
      setPos(null);
      return;
    }
    const rects = last.getClientRects();
    const rect = rects[rects.length - 1] ?? last.getBoundingClientRect();
    const box = wrapper.getBoundingClientRect();
    const left = Math.max(0, Math.min(rect.left - box.left, box.width - menu.offsetWidth));
    setPos({ top: rect.bottom - box.top + 6, left });
  }, [highlight.id, highlight.note, controller.highlights, editing, bodyRef, wrapperRef]);

  React.useEffect(() => {
    if (pos) menuRef.current?.scrollIntoView({ block: "nearest" });
  }, [pos?.top, highlight.id]);

  // A press anywhere else closes it (a press on a highlight reopens the right menu on click).
  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      closeMenu();
    };
    window.addEventListener("mousedown", onDown, true);
    return () => window.removeEventListener("mousedown", onDown, true);
  }, [closeMenu]);

  const unsaved = highlight.cited.filter((c) => {
    const key = urlKey(c.url);
    return !key || !controller.savedKeys.has(key);
  });

  return (
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Highlight"
      data-reader-ui
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className="animate-pop-in absolute z-30 w-[340px] max-w-full rounded-[12px] border border-border bg-popover p-1.5 font-sans shadow-float text-popover-foreground select-none"
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <MenuButton
          label="Make card"
          hint="q"
          icon={<Quote className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          onClick={() => void controller.makeCard(highlight.id)}
        />
        {controller.isYouTube && highlight.seconds !== null && (
          <MenuButton
            label="B-roll"
            hint="b"
            icon={<Film className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            onClick={() => void controller.makeBroll(highlight.id)}
          />
        )}
        <MenuButton
          label="Note"
          hint="n"
          icon={<StickyNote className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          onClick={() => controller.openMenu(highlight.id, true)}
        />
        <MenuButton
          label="Copy with source"
          hint="c"
          icon={<Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />}
          onClick={() => copyHighlight(highlight.id)}
        />
        <MenuButton
          label="Delete"
          hint="⌫"
          icon={<Trash2 className="size-3.5" aria-hidden="true" />}
          onClick={() => removeHighlight(highlight.id)}
          danger
        />
      </div>

      {editing ? (
        <NoteEditor
          className="mt-1.5 px-1"
          initial={highlight.note}
          onSave={(note) => saveNote(highlight.id, note)}
          onCancel={controller.cancelNote}
        />
      ) : (
        highlight.note && (
          <p className="mt-1.5 whitespace-pre-wrap rounded-[6px] bg-muted/40 p-2 text-[12.5px] leading-[17px] text-foreground">
            {highlight.note}
          </p>
        )
      )}

      {highlight.cited.length > 0 && (
        <div className="mt-1.5 border-t border-border px-1 pt-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-medium leading-4 text-muted-foreground">Cited:</span>
            {highlight.cited.map((c) => (
              <button
                key={`${c.n}-${c.url}`}
                type="button"
                onClick={() => void openUrl(c.url)}
                title={c.title ?? c.url}
                className="max-w-[140px] cursor-pointer truncate rounded-[6px] border border-border bg-muted px-2 py-0.5 text-[12px] leading-4 text-foreground transition-colors hover:bg-accent"
              >
                {domainOf(c.url)}
              </button>
            ))}
          </div>
          {controller.canSaveLinks &&
            (unsaved.length > 0 ? (
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveLinks(unsaved.map((c) => c.url))}
                  className="text-xs"
                >
                  Save to group
                </Button>
              </div>
            ) : (
              <p className="mt-1.5 px-1 text-[12px] leading-4 text-muted-foreground">
                Saved in this group
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function MenuButton({
  label,
  hint,
  icon,
  onClick,
  danger,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} (${hint})`}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[8px] px-2 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
      <Kbd className="ml-0.5">{hint}</Kbd>
    </button>
  );
}
