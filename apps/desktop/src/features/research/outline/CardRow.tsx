import * as React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  BookOpen,
  Film,
  FolderInput,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Quote,
  Trash2,
  Type,
} from "lucide-react";
import type { Card } from "@sourcefold/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Kbd } from "@/components/ui/Kbd";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cardBodyText, cardSourceLine } from "../shared/card-display";
import { InlineText } from "../shared/InlineText";

export type CardField = "note" | "line";

const KIND_ICON = { quote: Quote, broll: Film, line: Type } as const;

/** The card's text, its source and time, and its note. Shared by the row and the drag preview. */
export function CardContent({
  card,
  itemsById,
  editingField,
  onSaveNote,
  onSaveLine,
  onStopEditing,
}: {
  card: Card;
  itemsById: ReadonlyMap<string, Item>;
  editingField?: CardField | null;
  onSaveNote?: (text: string) => void;
  onSaveLine?: (text: string) => void;
  onStopEditing?: () => void;
}) {
  const Icon = KIND_ICON[card.kind];
  const body = cardBodyText(card);
  const note = card.note?.trim() ?? "";
  return (
    <>
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground"
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {editingField === "line" ? (
          <InlineText
            initial={card.script_line ?? ""}
            label="Script line"
            placeholder="Write the line"
            onSave={(text) => {
              onSaveLine?.(text);
            }}
            onCancel={() => onStopEditing?.()}
          />
        ) : (
          <p
            className={cn(
              "line-clamp-3 font-serif text-[15px] font-medium leading-[22px] tracking-[-0.005em] text-foreground",
              card.kind === "broll" && "italic",
            )}
          >
            {card.kind === "broll" && <span className="not-italic">B-roll: </span>}
            {body || (card.kind === "broll" ? "Clip" : "")}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1.5 truncate font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums">
          {card.kind !== "line" && <BookOpen className="size-3 shrink-0" aria-hidden="true" />}
          <span className="truncate">{cardSourceLine(card, itemsById)}</span>
        </p>
        {editingField === "note" ? (
          <div className="mt-1.5">
            <InlineText
              initial={card.note ?? ""}
              label="Note"
              placeholder="Add a note"
              onSave={(text) => onSaveNote?.(text)}
              onCancel={() => onStopEditing?.()}
            />
          </div>
        ) : (
          note && (
            <p className="mt-1 line-clamp-3 flex items-start gap-1.5 font-sans text-[12.5px] leading-[18px] text-muted-foreground">
              <NotebookPen className="mt-[3px] size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0">{note}</span>
            </p>
          )
        )}
      </div>
    </>
  );
}

/** The card as it looks while it is carried. */
export function CardPreview({
  card,
  itemsById,
}: {
  card: Card;
  itemsById: ReadonlyMap<string, Item>;
}) {
  return (
    <div className="flex w-[min(360px,80vw)] cursor-grabbing items-start gap-3 rounded-[10px] bg-popover px-2.5 py-2.5 shadow-float">
      <CardContent card={card} itemsById={itemsById} />
    </div>
  );
}

export interface CardRowProps {
  card: Card;
  itemsById: ReadonlyMap<string, Item>;
  focused: boolean;
  /** The keyboard is in the outline, so the focused row shows its bar. */
  regionFocused: boolean;
  editingField: CardField | null;
  /** A drop here lands before or after this card. */
  dropIndicator: "before" | "after" | null;
  onFocus: () => void;
  onOpen: () => void;
  onEditField: (field: CardField | null) => void;
  onSaveNote: (text: string) => void;
  onSaveLine: (text: string) => void;
  onMove: () => void;
  onDelete: () => void;
}

/** One card in the pile or a section: draggable, and a drop target for other cards. */
export function CardRow({
  card,
  itemsById,
  focused,
  regionFocused,
  editingField,
  dropIndicator,
  onFocus,
  onOpen,
  onEditField,
  onSaveNote,
  onSaveLine,
  onMove,
  onDelete,
}: CardRowProps) {
  const id = `card:${card.id}`;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id,
    data: { type: "card", cardId: card.id },
    disabled: editingField !== null,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id, data: { type: "card", cardId: card.id } });
  const setRef = React.useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <div
      ref={setRef}
      data-focus-id={card.id}
      {...attributes}
      {...listeners}
      role="listitem"
      tabIndex={-1}
      onClick={onFocus}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, textarea, input, [role=menuitem]")) return;
        onOpen();
      }}
      className={cn(
        "group relative -mx-2.5 flex cursor-grab select-none items-start gap-3 rounded-[10px] px-2.5 py-2.5 outline-none transition-[background-color,opacity] duration-150 active:cursor-grabbing",
        focused && regionFocused ? "bg-accent" : focused ? "bg-muted/60" : "hover:bg-muted",
        isDragging && "opacity-40",
      )}
    >
      {focused && regionFocused && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-foreground"
        />
      )}
      {dropIndicator && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2.5 z-10 h-[2px] rounded-full bg-foreground",
            dropIndicator === "before" ? "-top-px" : "-bottom-px",
          )}
        />
      )}
      <CardContent
        card={card}
        itemsById={itemsById}
        editingField={editingField}
        onSaveNote={onSaveNote}
        onSaveLine={onSaveLine}
        onStopEditing={() => onEditField(null)}
      />
      <div
        className="shrink-0 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Card actions"
            title="Card actions"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onOpen}>
              <BookOpen className="size-3.5" aria-hidden="true" />
              <span>{card.item_id ? "Open in reader" : "Open"}</span>
              <Kbd>Enter</Kbd>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditField("note")}>
              <NotebookPen className="size-3.5" aria-hidden="true" />
              <span>{card.note?.trim() ? "Edit note" : "Add note"}</span>
            </DropdownMenuItem>
            {card.kind === "line" && (
              <DropdownMenuItem onClick={() => onEditField("line")}>
                <Pencil className="size-3.5" aria-hidden="true" />
                <span>Edit line</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onMove}>
              <FolderInput className="size-3.5" aria-hidden="true" />
              <span>Move to section</span>
              <Kbd>m</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Delete card</span>
              <Kbd>Del</Kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
