import * as React from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronDown, Inbox, ListTree, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { SECTION_TITLE_MAX, sortSections, type Card, type OutlineSection } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  isAnyDialogOpen,
} from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { isTypingContext } from "@/features/shortcuts/key-utils";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { cardsIn, sourcesWithTag, sourceTitleFor } from "../project-data/project-data-model";
import type { ProjectData } from "../project-data/use-project-data";
import { InlineText } from "../shared/InlineText";
import { CardPreview, CardRow, type CardField } from "./CardRow";
import { MoveCardDialog } from "./MoveCardDialog";
import {
  computeCardDrop,
  computeSectionDrop,
  dropIsAfter,
  filterPile,
  focusAfterRemoval,
  focusOrder,
  moveCardByKey,
  moveSectionByKey,
  NO_PILE_FILTER,
  normalizeSectionTitle,
  pileFilterActive,
  pileSourceOptions,
  stepFocus,
  type CardDropTarget,
  type PileFilter,
} from "./outline-model";
import { SectionBlock } from "./SectionBlock";

/** What is under a dragged card or section right now, for the drop line. */
type Hover =
  | { kind: "card"; id: string; after: boolean }
  | { kind: "container"; sectionId: string | null }
  | { kind: "section"; id: string; after: boolean };

function sameHover(a: Hover | null, b: Hover | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "container" && b.kind === "container") return a.sectionId === b.sectionId;
  if (a.kind === "card" && b.kind === "card") return a.id === b.id && a.after === b.after;
  if (a.kind === "section" && b.kind === "section") return a.id === b.id && a.after === b.after;
  return false;
}

/** Cards are dropped on other cards first, else on a whole list; sections only on sections. */
const collisionDetection: CollisionDetection = (args) => {
  const dragged = args.active.data.current?.type;
  const others = args.droppableContainers.filter((c) => c.id !== args.active.id);
  const ofType = (...types: string[]) =>
    others.filter((c) => types.includes(String(c.data.current?.type)));
  const attempt = (containers: typeof others) =>
    containers.length === 0 ? [] : pointerWithin({ ...args, droppableContainers: containers });

  if (dragged === "section") {
    const sections = ofType("section");
    const hits = attempt(sections);
    return hits.length > 0 ? hits : closestCenter({ ...args, droppableContainers: sections });
  }
  const onCard = attempt(ofType("card"));
  if (onCard.length > 0) return onCard;
  const lists = ofType("section", "container");
  const onList = attempt(lists);
  return onList.length > 0 ? onList : closestCenter({ ...args, droppableContainers: lists });
};

export interface CardsModeProps {
  projectId: string;
  data: ProjectData;
  /** The keyboard is in the view. */
  isFocusedRegion: boolean;
  onOpenCard: (card: Card) => void;
  onOpenSource: (item: Item) => void;
}

/** The card pile on the left, the sections on the right, and drag and drop between them. */
export function CardsMode({
  projectId: _projectId,
  data,
  isFocusedRegion,
  onOpenCard,
  onOpenSource,
}: CardsModeProps) {
  const { cards, items } = data;
  const sections = React.useMemo(() => sortSections(data.sections), [data.sections]);
  const itemsById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const sourceTitleOf = React.useCallback(
    (card: Card) => sourceTitleFor(card, itemsById),
    [itemsById],
  );

  const [filter, setFilter] = React.useState<PileFilter>(NO_PILE_FILTER);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [drafting, setDrafting] = React.useState(false);
  const [editing, setEditing] = React.useState<{ cardId: string; field: CardField } | null>(null);
  const [moveCard, setMoveCard] = React.useState<Card | null>(null);
  const [sectionToDelete, setSectionToDelete] = React.useState<OutlineSection | null>(null);
  const [dragging, setDragging] = React.useState<{ kind: "card" | "section"; id: string } | null>(
    null,
  );
  const [hover, setHover] = React.useState<Hover | null>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const pile = React.useMemo(() => cardsIn(cards, null), [cards]);
  const filteredPile = React.useMemo(
    () => filterPile(pile, filter, sourceTitleOf),
    [pile, filter, sourceTitleOf],
  );
  const sourceOptions = React.useMemo(
    () => pileSourceOptions(pile, sourceTitleOf),
    [pile, sourceTitleOf],
  );
  const cardsBySection = React.useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const section of sections) map.set(section.id, cardsIn(cards, section.id));
    return map;
  }, [cards, sections]);
  const tagged = React.useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const section of sections) map.set(section.id, sourcesWithTag(items, section.title));
    return map;
  }, [items, sections]);
  const order = React.useMemo(
    () => focusOrder(filteredPile, sections, cards),
    [filteredPile, sections, cards],
  );
  const focusedTarget = order.find((t) => t.id === focusedId) ?? null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // A source filter whose source has no cards left in the pile no longer applies.
  React.useEffect(() => {
    if (filter.source === "all") return;
    if (!sourceOptions.some((o) => o.id === filter.source)) {
      setFilter((f) => ({ ...f, source: "all" }));
    }
  }, [filter.source, sourceOptions]);

  React.useEffect(() => {
    if (!focusedId) return;
    bodyRef.current
      ?.querySelector<HTMLElement>(`[data-focus-id="${focusedId}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [focusedId]);

  // ----- actions

  const startNewSection = React.useCallback(() => setDrafting(true), []);

  const createSection = async (raw: string) => {
    const result = normalizeSectionTitle(raw);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDrafting(false);
    const section = await data.createSection(result.title);
    if (section) setFocusedId(section.id);
  };

  const renameSection = async (section: OutlineSection, raw: string) => {
    const result = normalizeSectionTitle(raw);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setRenamingId(null);
    if (result.title !== section.title) await data.renameSection(section.id, result.title);
  };

  const deleteSection = async (section: OutlineSection) => {
    setSectionToDelete(null);
    const next = focusAfterRemoval(order, section.id);
    setFocusedId(next?.id ?? null);
    await data.removeSection(section.id);
  };

  const deleteCard = async (card: Card) => {
    const next = focusAfterRemoval(order, card.id);
    setFocusedId(next?.id ?? null);
    const removed = await data.removeCard(card.id);
    if (!removed) return;
    toast("Card deleted", {
      action: { label: "Undo", onClick: () => void data.restoreCard(removed) },
    });
  };

  const placeCard = async (card: Card, sectionId: string | null) => {
    setMoveCard(null);
    const patch = computeCardDrop(cards, card.id, { type: "container", sectionId });
    if (patch) await data.patchCard(card.id, patch);
  };

  const saveNote = (card: Card, text: string) => {
    setEditing(null);
    const note = text.trim();
    void data.patchCard(card.id, { note: note === "" ? null : note });
  };

  const saveLine = (card: Card, text: string) => {
    setEditing(null);
    const line = text.trim();
    if (line === "") return;
    void data.patchCard(card.id, { script_line: line });
  };

  // ----- keyboard

  React.useEffect(() => {
    if (!isFocusedRegion) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingContext(e.target) || isAnyDialogOpen()) return;
      const noMods = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      const card = focusedTarget?.kind === "card" ? cards.find((c) => c.id === focusedTarget.id) : null;
      const section =
        focusedTarget?.kind === "section"
          ? sections.find((s) => s.id === focusedTarget.id)
          : card?.section_id
            ? sections.find((s) => s.id === card.section_id)
            : undefined;

      if ((e.key === "j" && noMods) || (e.key === "ArrowDown" && noMods)) {
        e.preventDefault();
        setFocusedId(stepFocus(order, focusedId, 1)?.id ?? null);
      } else if ((e.key === "k" && noMods) || (e.key === "ArrowUp" && noMods)) {
        e.preventDefault();
        setFocusedId(stepFocus(order, focusedId, -1)?.id ?? null);
      } else if (e.key === "Home" && noMods) {
        e.preventDefault();
        setFocusedId(order[0]?.id ?? null);
      } else if (e.key === "End" && noMods) {
        e.preventDefault();
        setFocusedId(order[order.length - 1]?.id ?? null);
      } else if (altOnly && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const direction = e.key === "ArrowUp" ? "up" : "down";
        if (card) {
          const patch = moveCardByKey(cards, sections, card.id, direction);
          if (patch) void data.patchCard(card.id, patch);
        } else if (section && focusedTarget?.kind === "section") {
          const position = moveSectionByKey(sections, section.id, direction);
          if (position !== null) void data.moveSection(section.id, position);
        }
      } else if (e.key === "n" && noMods) {
        e.preventDefault();
        startNewSection();
      } else if ((e.key === "r" && noMods) || e.key === "F2") {
        if (section) {
          e.preventDefault();
          setRenamingId(section.id);
        }
      } else if (e.key === "m" && noMods) {
        if (card) {
          e.preventDefault();
          setMoveCard(card);
        }
      } else if (e.key === "Enter" && noMods) {
        e.preventDefault();
        if (card) onOpenCard(card);
        else if (section) setRenamingId(section.id);
      } else if (e.key === "Delete" && !e.altKey) {
        if (card) {
          e.preventDefault();
          void deleteCard(card);
        } else if (focusedTarget?.kind === "section" && section) {
          e.preventDefault();
          setSectionToDelete(section);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `deleteCard` and the other actions only use the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocusedRegion, focusedTarget, focusedId, order, cards, sections, onOpenCard, startNewSection]);

  // ----- drag and drop

  const hoverFor = (event: DragMoveEvent | DragEndEvent): Hover | null => {
    const { active, over } = event;
    if (!over) return null;
    const activeType = active.data.current?.type;
    const overData = over.data.current;
    const rect = active.rect.current.translated ?? active.rect.current.initial;
    if (!overData || !rect) return null;
    if (activeType === "section") {
      if (overData.type !== "section") return null;
      return { kind: "section", id: overData.sectionId, after: dropIsAfter(rect, over.rect) };
    }
    if (overData.type === "card") {
      return { kind: "card", id: overData.cardId, after: dropIsAfter(rect, over.rect) };
    }
    return { kind: "container", sectionId: overData.sectionId ?? null };
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "card") setDragging({ kind: "card", id: data.cardId });
    else if (data?.type === "section") setDragging({ kind: "section", id: data.sectionId });
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const next = hoverFor(event);
    setHover((prev) => (sameHover(prev, next) ? prev : next));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const target = hoverFor(event);
    setDragging(null);
    setHover(null);
    if (!target || !dragging) return;
    if (dragging.kind === "card" && target.kind !== "section") {
      const drop: CardDropTarget =
        target.kind === "card"
          ? { type: "card", id: target.id, after: target.after }
          : { type: "container", sectionId: target.sectionId };
      const patch = computeCardDrop(cards, dragging.id, drop);
      if (patch) void data.patchCard(dragging.id, patch);
    } else if (dragging.kind === "section" && target.kind === "section") {
      const position = computeSectionDrop(sections, dragging.id, target.id, target.after);
      if (position !== null) void data.moveSection(dragging.id, position);
    }
  };

  const cancelDrag = () => {
    setDragging(null);
    setHover(null);
  };

  // ----- rendering

  const renderCard = (card: Card) => (
    <CardRow
      key={card.id}
      card={card}
      itemsById={itemsById}
      focused={focusedId === card.id}
      regionFocused={isFocusedRegion}
      editingField={editing?.cardId === card.id ? editing.field : null}
      dropIndicator={
        hover?.kind === "card" && hover.id === card.id ? (hover.after ? "after" : "before") : null
      }
      onFocus={() => setFocusedId(card.id)}
      onOpen={() => onOpenCard(card)}
      onEditField={(field) => setEditing(field ? { cardId: card.id, field } : null)}
      onSaveNote={(text) => saveNote(card, text)}
      onSaveLine={(text) => saveLine(card, text)}
      onMove={() => setMoveCard(card)}
      onDelete={() => void deleteCard(card)}
    />
  );

  const draggedCard =
    dragging?.kind === "card" ? (cards.find((c) => c.id === dragging.id) ?? null) : null;
  const draggedSection =
    dragging?.kind === "section" ? (sections.find((s) => s.id === dragging.id) ?? null) : null;
  const nothingYet = cards.length === 0 && sections.length === 0 && !drafting;

  if (nothingYet) {
    return (
      <EmptyState
        icon={ListTree}
        title="Your outline starts here"
        description="Add a section for each part of your script. Then highlight a passage in the reader and press q to make a card, and drag the card into a section."
        actions={
          <Button onClick={startNewSection}>
            <Plus className="size-4" aria-hidden="true" />
            New section
            <Kbd>n</Kbd>
          </Button>
        }
      />
    );
  }

  const sectionDropTarget = dragging?.kind === "card" && hover?.kind === "container";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={cancelDrag}
    >
      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-6 pt-3 @[720px]/view:flex-row @[720px]/view:gap-8 @[720px]/view:overflow-hidden"
      >
        <Pile
          total={pile.length}
          shown={filteredPile.length}
          filter={filter}
          onFilterChange={setFilter}
          sourceOptions={sourceOptions}
          dropActive={sectionDropTarget && hover.sectionId === null}
        >
          {filteredPile.map(renderCard)}
        </Pile>

        <div className="min-w-0 flex-1 @[720px]/view:overflow-y-auto @[720px]/view:pr-1">
          <div className="flex h-8 items-center justify-between pb-1">
            <h2 className="font-sans text-[12px] font-medium leading-4 text-muted-foreground">
              Sections
            </h2>
            <Button variant="ghost" size="sm" onClick={startNewSection} title="New section (n)">
              <Plus className="size-3.5" aria-hidden="true" />
              <span>New section</span>
              <Kbd>n</Kbd>
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {sections.map((section) => (
              <SectionBlock
                key={section.id}
                section={section}
                cardCount={cardsBySection.get(section.id)?.length ?? 0}
                taggedSources={tagged.get(section.id) ?? []}
                focused={focusedId === section.id}
                regionFocused={isFocusedRegion}
                renaming={renamingId === section.id}
                dropActive={sectionDropTarget && hover.sectionId === section.id}
                sectionIndicator={
                  hover?.kind === "section" && hover.id === section.id
                    ? hover.after
                      ? "after"
                      : "before"
                    : null
                }
                onFocus={() => setFocusedId(section.id)}
                onRenameStart={() => setRenamingId(section.id)}
                onRenameSave={(title) => void renameSection(section, title)}
                onRenameCancel={() => setRenamingId(null)}
                onDelete={() => setSectionToDelete(section)}
                onOpenSource={onOpenSource}
              >
                {(cardsBySection.get(section.id) ?? []).map(renderCard)}
              </SectionBlock>
            ))}
            {drafting ? (
              <div className="px-1 py-2">
                <InlineText
                  initial=""
                  label="New section name"
                  placeholder="Section name, then Enter"
                  className="font-serif text-[18px] font-medium leading-[26px]"
                  onSave={(title) => void createSection(title)}
                  onCancel={() => setDrafting(false)}
                />
              </div>
            ) : (
              sections.length === 0 && (
                <p className="px-1 py-3 text-[13px] leading-[19px] text-muted-foreground">
                  No sections yet. Add one, then drag cards into it.
                </p>
              )
            )}
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }}>
        {draggedCard ? (
          <CardPreview card={draggedCard} itemsById={itemsById} />
        ) : draggedSection ? (
          <div className="w-[min(360px,80vw)] cursor-grabbing rounded-[10px] bg-popover px-3 py-2 shadow-float">
            <span className="block truncate font-serif text-[18px] font-medium leading-[26px] text-foreground">
              {draggedSection.title}
            </span>
          </div>
        ) : null}
      </DragOverlay>

      <MoveCardDialog
        card={moveCard}
        sections={sections}
        onPick={(sectionId) => moveCard && void placeCard(moveCard, sectionId)}
        onClose={() => setMoveCard(null)}
      />

      <Dialog
        open={sectionToDelete !== null}
        onOpenChange={(open) => !open && setSectionToDelete(null)}
      >
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete “{sectionToDelete?.title}”?</DialogTitle>
            <DialogDescription>
              Its cards go back to the pile. Sources keep their tags.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => sectionToDelete && void deleteSection(sectionToDelete)}
            >
              Delete section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}

/** The card pile: unplaced cards, a source filter and a text filter. Also the drop target to unplace. */
function Pile({
  total,
  shown,
  filter,
  onFilterChange,
  sourceOptions,
  dropActive,
  children,
}: {
  total: number;
  shown: number;
  filter: PileFilter;
  onFilterChange: (filter: PileFilter) => void;
  sourceOptions: ReturnType<typeof pileSourceOptions>;
  dropActive: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: "pile", data: { type: "container", sectionId: null } });
  const active = pileFilterActive(filter);
  const sourceLabel =
    filter.source === "all"
      ? "All sources"
      : (sourceOptions.find((o) => o.id === filter.source)?.title ?? "All sources");

  return (
    <section
      ref={setNodeRef}
      aria-label="Card pile"
      className={cn(
        "-mx-2.5 flex min-h-0 shrink-0 flex-col rounded-[12px] px-2.5 transition-colors duration-150 @[720px]/view:w-[340px]",
        dropActive && "bg-accent",
      )}
    >
      <div className="flex h-8 items-center justify-between">
        <h2 className="font-sans text-[12px] font-medium leading-4 text-muted-foreground">
          Card pile
        </h2>
        <span className="font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums">
          {active ? `${shown} of ${total}` : total}
        </span>
      </div>

      {total > 0 && (
        <div className="flex items-center gap-2 pb-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={filter.text}
              onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
              placeholder="Filter cards"
              aria-label="Filter the card pile by text"
              className="h-8 pl-8 pr-8"
            />
            {filter.text && (
              <button
                type="button"
                onClick={() => onFilterChange({ ...filter, text: "" })}
                aria-label="Clear the text filter"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="max-w-[150px]"
                aria-label="Filter the card pile by source"
              >
                <span className="truncate">{sourceLabel}</span>
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[320px] w-60 overflow-y-auto">
              <DropdownMenuItem onClick={() => onFilterChange({ ...filter, source: "all" })}>
                <span className="truncate">All sources</span>
              </DropdownMenuItem>
              {sourceOptions.length > 0 && <DropdownMenuSeparator />}
              {sourceOptions.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  onClick={() => onFilterChange({ ...filter, source: option.id })}
                >
                  <span className="min-w-0 flex-1 truncate">{option.title}</span>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {option.count}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div
        role="list"
        aria-label="Cards waiting for a section"
        className="min-h-[44px] @[720px]/view:min-h-0 @[720px]/view:flex-1 @[720px]/view:overflow-y-auto"
      >
        {children}
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-[28ch] text-[13px] leading-[19px] text-muted-foreground">
              No cards waiting. Highlight a passage in the reader and press q to make one.
            </p>
          </div>
        ) : (
          shown === 0 && (
            <p className="px-1 py-6 text-center text-[13px] leading-[19px] text-muted-foreground">
              No cards match the filter.
            </p>
          )
        )}
      </div>
    </section>
  );
}

export { SECTION_TITLE_MAX };
