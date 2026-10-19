import * as React from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical, MoreHorizontal, Pencil, Tags, Trash2 } from "lucide-react";
import type { OutlineSection } from "@sourcefold/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Kbd } from "@/components/ui/Kbd";
import { getSourceKind, SourceTile } from "@/features/items/source-kinds";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InlineText } from "../shared/InlineText";
import { Popover } from "../shared/Popover";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** "3 sources tagged"; click it for the list. */
function TaggedSources({
  title,
  sources,
  onOpenSource,
}: {
  title: string;
  sources: Item[];
  onOpenSource: (item: Item) => void;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      wrapperClassName="shrink-0"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={`Sources tagged “${title}”`}
          className="flex h-6 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Tags className="size-3" aria-hidden="true" />
          {plural(sources.length, "source", "sources")} tagged
        </button>
      }
    >
      <p className="px-1 pb-2 text-[12px] font-medium leading-4 text-muted-foreground">
        Tagged “{title}”
      </p>
      {sources.length === 0 ? (
        <p className="px-1 pb-1 text-[13px] leading-[19px] text-muted-foreground">
          No sources have this tag yet. Press t on a source to tag it.
        </p>
      ) : (
        <ul role="list" className="-mx-1.5 flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
          {sources.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenSource(item);
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <SourceTile kind={item.kind} className="size-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[14px] font-medium leading-5 text-foreground">
                    {item.title}
                  </span>
                  <span className="block truncate text-[12px] leading-4 text-muted-foreground">
                    {getSourceKind(item.kind).name}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

export interface SectionBlockProps {
  section: OutlineSection;
  cardCount: number;
  taggedSources: Item[];
  focused: boolean;
  regionFocused: boolean;
  renaming: boolean;
  /** Something is being dragged over this section's cards: a card (drop inside) or a section. */
  dropActive: boolean;
  /** A dragged section lands before or after this one. */
  sectionIndicator: "before" | "after" | null;
  onFocus: () => void;
  onRenameStart: () => void;
  onRenameSave: (title: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  onOpenSource: (item: Item) => void;
  children: React.ReactNode;
}

/** A section of the outline: its title, the sources tagged with it, and its cards. */
export function SectionBlock({
  section,
  cardCount,
  taggedSources,
  focused,
  regionFocused,
  renaming,
  dropActive,
  sectionIndicator,
  onFocus,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  onDelete,
  onOpenSource,
  children,
}: SectionBlockProps) {
  const id = `section:${section.id}`;
  const data = { type: "section", sectionId: section.id };
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({ id, data, disabled: renaming });
  const { setNodeRef: setDropRef } = useDroppable({ id, data });
  const setRef = React.useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <section
      ref={setRef}
      data-focus-id={section.id}
      aria-label={section.title}
      onClick={onFocus}
      className={cn(
        "relative -mx-2.5 rounded-[12px] px-2.5 pb-2 pt-1 transition-[background-color,opacity] duration-150",
        dropActive && "bg-accent",
        isDragging && "opacity-40",
      )}
    >
      {sectionIndicator && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2.5 z-10 h-[2px] rounded-full bg-foreground",
            sectionIndicator === "before" ? "-top-px" : "-bottom-px",
          )}
        />
      )}
      <div
        className={cn(
          "group/header relative -mx-1 flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-1",
          focused && regionFocused && "bg-accent",
        )}
      >
        {focused && regionFocused && (
          <span
            aria-hidden="true"
            className="absolute inset-y-2 -left-1.5 w-[2px] rounded-full bg-foreground"
          />
        )}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          tabIndex={-1}
          aria-label={`Drag section ${section.title}`}
          title="Drag to reorder"
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-[6px] text-muted-foreground opacity-0 transition-[opacity,background-color] duration-150 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/header:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 flex-1">
          {renaming ? (
            <InlineText
              initial={section.title}
              label="Section name"
              placeholder="Section name"
              className="font-serif text-[18px] font-medium leading-[26px]"
              onSave={onRenameSave}
              onCancel={onRenameCancel}
            />
          ) : (
            <h3
              onDoubleClick={onRenameStart}
              title="Double-click to rename (r)"
              className="truncate font-serif text-[20px] font-medium leading-[28px] tracking-[-0.012em] text-foreground"
            >
              {section.title}
            </h3>
          )}
        </div>

        <TaggedSources
          title={section.title}
          sources={taggedSources}
          onOpenSource={onOpenSource}
        />
        <span className="hidden shrink-0 font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums @[560px]/view:inline">
          {plural(cardCount, "card", "cards")}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`Section actions for ${section.title}`}
            title="Section actions"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onRenameStart}>
              <Pencil className="size-3.5" aria-hidden="true" />
              <span>Rename</span>
              <Kbd>r</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Delete section</span>
              <Kbd>Del</Kbd>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div role="list" aria-label={`Cards in ${section.title}`} className="min-h-[44px]">
        {children}
        {cardCount === 0 && (
          <p className="px-1 py-3 text-[13px] leading-[19px] text-muted-foreground">
            Drag cards here from the pile.
          </p>
        )}
      </div>
    </section>
  );
}
