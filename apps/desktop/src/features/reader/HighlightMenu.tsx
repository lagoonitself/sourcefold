import * as React from "react";
import { Copy, StickyNote, Trash2 } from "lucide-react";
import type { Highlight } from "@sourcefold/core";
import { openUrl } from "@/lib/utils";
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
      className="absolute z-30 w-[340px] max-w-full rounded-[10px] border border-border bg-background p-1.5 font-sans shadow-float"
    >
      <div className="flex items-center gap-0.5">
        <MenuButton
          label="Note"
          hint="n"
          icon={<StickyNote className="size-3.5" aria-hidden="true" />}
          onClick={() => controller.openMenu(highlight.id, true)}
        />
        <MenuButton
          label="Copy with source"
          hint="c"
          icon={<Copy className="size-3.5" aria-hidden="true" />}
          onClick={() => copyHighlight(highlight.id)}
        />
        <MenuButton
          label="Delete"
          hint="Backspace"
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
          <p className="mt-1.5 whitespace-pre-wrap px-2 text-[13px] leading-[18px] text-foreground">
            {highlight.note}
          </p>
        )
      )}

      {highlight.cited.length > 0 && (
        <div className="mt-1.5 border-t border-border px-1 pt-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[12px] font-medium leading-4 text-muted-foreground">Cited:</span>
            {highlight.cited.map((c) => (
              <button
                key={`${c.n}-${c.url}`}
                type="button"
                onClick={() => void openUrl(c.url)}
                title={c.title ?? c.url}
                className="max-w-[140px] cursor-pointer truncate rounded-[4px] border border-border bg-muted px-1.5 py-0.5 text-[12px] leading-4 text-foreground hover:bg-accent"
              >
                {domainOf(c.url)}
              </button>
            ))}
          </div>
          {controller.canSaveLinks &&
            (unsaved.length > 0 ? (
              <button
                type="button"
                onClick={() => saveLinks(unsaved.map((c) => c.url))}
                className="mt-1.5 cursor-pointer rounded-[6px] px-1.5 py-1 text-[13px] font-medium text-primary hover:bg-accent"
              >
                Save to group
              </button>
            ) : (
              <p className="mt-1.5 px-1.5 text-[12px] leading-4 text-muted-foreground">
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
      className={
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[13px] font-medium hover:bg-muted " +
        (danger ? "text-destructive" : "text-foreground")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
