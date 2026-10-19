import * as React from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Film,
  NotebookPen,
  Plus,
  Quote,
  Type,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildReferenceList,
  buildScript,
  cardLink,
  formatClipTime,
  positionBetween,
  scriptSourceFromItem,
  sortCards,
  sortSections,
  type Card,
  type OutlineSection,
} from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Item } from "@/lib/types";
import { cn, openUrl } from "@/lib/utils";
import { buildSourceDirectory, cardsIn, sourceTitleFor } from "../project-data/project-data-model";
import type { ProjectData } from "../project-data/use-project-data";
import { InlineText } from "../shared/InlineText";
import { Popover } from "../shared/Popover";
import { useCopied } from "../shared/use-copied";

export interface ScriptModeProps {
  projectTitle: string;
  data: ProjectData;
  isFocusedRegion: boolean;
  onOpenCard: (card: Card) => void;
  onOpenSource: (item: Item) => void;
}

/** Popover content for a citation chip ([1, 3:12]). */
function CitationPopover({
  card,
  n,
  sourceItem,
  sourceTitle,
  onOpenCard,
}: {
  card: Card;
  n: number | null;
  sourceItem?: Item;
  sourceTitle: string | null;
  onOpenCard: (card: Card) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const timeText = formatClipTime(card.seconds, card.kind === "broll" ? card.end_seconds : null);
  const link = cardLink(
    card,
    sourceItem ? { url: sourceItem.canonical_url ?? sourceItem.source_url ?? null } : null,
  );

  const chipLabel =
    n !== null ? (timeText ? `[${n}, ${timeText}]` : `[${n}]`) : timeText ? `[${timeText}]` : "[*]";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      wrapperClassName="inline-flex align-baseline ml-1.5"
      trigger={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={sourceTitle ?? "Citation"}
          className="inline-flex cursor-pointer items-center rounded-[4px] px-1 py-0.5 font-sans text-[12px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {chipLabel}
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2 border-b border-border pb-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-sans text-[12px] font-medium text-foreground">
              {sourceTitle ?? "Source"}
            </p>
            {timeText && (
              <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">{timeText}</p>
            )}
          </div>
          {link && (
            <button
              type="button"
              onClick={() => void openUrl(link)}
              title="Open video at time"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {card.quote && (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-2 text-[12.5px] italic leading-[18px] text-foreground/90">
            {card.quote}
          </blockquote>
        )}

        {card.note && (
          <p className="flex items-start gap-1.5 text-[12px] leading-[17px] text-muted-foreground">
            <NotebookPen className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0">{card.note}</span>
          </p>
        )}

        {card.item_id && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                onOpenCard(card);
              }}
              className="w-full justify-center gap-1.5 text-[12px]"
            >
              <BookOpen className="size-3.5" aria-hidden="true" />
              Open in reader
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** Inserter button that appears on hover between script lines to insert a new line card. */
function LineInserter({ onInsert }: { onInsert: () => void }) {
  return (
    <div className="group/inserter relative -my-1.5 flex h-4 items-center justify-center">
      <div className="h-px w-full bg-transparent transition-colors group-hover/inserter:bg-border" />
      <button
        type="button"
        onClick={onInsert}
        title="Add line"
        aria-label="Add line here"
        className="absolute flex size-5 cursor-pointer items-center justify-center rounded-full bg-background border border-border text-muted-foreground opacity-0 shadow-xs transition-[opacity,transform] duration-150 group-hover/inserter:opacity-100 hover:scale-110 hover:border-foreground/40 hover:text-foreground"
      >
        <Plus className="size-3" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ScriptMode({
  projectTitle,
  data,
  isFocusedRegion: _isFocusedRegion,
  onOpenCard,
  onOpenSource: _onOpenSource,
}: ScriptModeProps) {
  const { cards, items } = data;
  const sections = React.useMemo(() => sortSections(data.sections), [data.sections]);
  const sourceDirectory = React.useMemo(() => buildSourceDirectory(items), [items]);
  const itemsById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [editingCardId, setEditingCardId] = React.useState<string | null>(null);

  const built = React.useMemo(() => {
    return buildScript({
      projectTitle,
      sections,
      cards,
      sources: sourceDirectory,
    });
  }, [projectTitle, sections, cards, sourceDirectory]);

  // Card reference numbers map
  const cardReferenceMap = React.useMemo(() => {
    const map = new Map<string, { n: number | null; cite: string }>();
    for (const sec of built.sections) {
      for (const line of sec.lines) {
        map.set(line.card.id, { n: line.n, cite: line.citation });
      }
    }
    return map;
  }, [built]);

  const cardsBySection = React.useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const section of sections) {
      map.set(section.id, cardsIn(cards, section.id));
    }
    return map;
  }, [cards, sections]);

  const { copied: copiedScript, copy: copyScript } = useCopied();

  const handleCopyScript = () => {
    void copyScript(built.markdown);
  };

  const handleCopyCitedReferences = async () => {
    const text = buildReferenceList(built.references.map((r) => r.source));
    if (!text.trim()) {
      toast.info("No references cited in the script yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied cited references");
    } catch {
      toast.error("Couldn't copy references to clipboard.");
    }
  };

  const handleCopyAllKeepReferences = async () => {
    const keepSources = items
      .filter((i) => i.triage === "keep")
      .map((i) => scriptSourceFromItem(i));
    const text = buildReferenceList(keepSources);
    if (!text.trim()) {
      toast.info("No sources marked Keep in this project.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied all Keep references");
    } catch {
      toast.error("Couldn't copy references to clipboard.");
    }
  };

  const insertLineCard = async (sectionId: string, position: number) => {
    const card = await data.createCard({
      id: crypto.randomUUID ? crypto.randomUUID() : `line-${Date.now()}`,
      project_id: sections.find((s) => s.id === sectionId)?.project_id ?? "",
      kind: "line",
      item_id: null,
      highlight_id: null,
      quote: "",
      seconds: null,
      end_seconds: null,
      url: null,
      note: null,
      script_line: "New line",
      section_id: sectionId,
      position,
    });
    if (card) {
      setEditingCardId(card.id);
    }
  };

  const handleSaveCardLine = (card: Card, text: string) => {
    setEditingCardId(null);
    const trimmed = text.trim();
    if (card.kind === "line") {
      if (!trimmed) {
        // If an empty line card is saved, remove it
        void data.removeCard(card.id);
      } else {
        void data.patchCard(card.id, { script_line: trimmed });
      }
    } else {
      // Empty restores original quote: setting script_line to null
      void data.patchCard(card.id, { script_line: trimmed ? trimmed : null });
    }
  };

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={Quote}
        title="No sections yet"
        description="Switch to Cards mode to create sections and arrange your outline."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Script toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 pt-1">
        <span className="font-sans text-[12.5px] leading-[18px] text-muted-foreground">
          {built.sections.reduce((acc, s) => acc + s.lines.length, 0)} lines across{" "}
          {sections.length} {sections.length === 1 ? "section" : "sections"}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyScript}>
            {copiedScript ? (
              <Check className="size-3.5 text-green-600" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            <span>{copiedScript ? "Copied script" : "Copy script"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Copy className="size-3.5" aria-hidden="true" />
                <span>Copy references</span>
                <ChevronDown className="size-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => void handleCopyCitedReferences()}>
                <span>Cited in the script</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {built.references.length}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleCopyAllKeepReferences()}>
                <span>All Keep sources in project</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {items.filter((i) => i.triage === "keep").length}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Script body: Document-style */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-6">
        <div className="mx-auto max-w-[680px] space-y-8">
          {sections.map((section) => {
            const sectionCards = cardsBySection.get(section.id) ?? [];
            const sortedCards = sortCards(sectionCards);

            return (
              <section key={section.id} className="space-y-3">
                <h2 className="font-serif text-[22px] font-medium leading-[30px] tracking-[-0.015em] text-foreground">
                  {section.title}
                </h2>

                <div className="space-y-1">
                  {/* Inserter before first card */}
                  <LineInserter
                    onInsert={() => {
                      const pos = positionBetween(null, sortedCards[0]?.position ?? null);
                      void insertLineCard(section.id, pos);
                    }}
                  />

                  {sortedCards.map((card, idx) => {
                    const nextCard = sortedCards[idx + 1];
                    const refInfo = cardReferenceMap.get(card.id);
                    const sourceItem = card.item_id ? itemsById.get(card.item_id) : undefined;
                    const sourceTitle = sourceTitleFor(card, itemsById);
                    const isEditing = editingCardId === card.id;

                    const lineText =
                      card.script_line !== null && card.script_line.trim() !== ""
                        ? card.script_line
                        : card.quote.trim();
                    const isPlaceholder = !lineText;

                    return (
                      <React.Fragment key={card.id}>
                        <div className="group/line relative flex items-baseline gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-muted/50">
                          {isEditing ? (
                            <div className="w-full">
                              <InlineText
                                initial={card.script_line ?? card.quote ?? ""}
                                label="Edit script line"
                                placeholder={
                                  card.kind === "line"
                                    ? "Write your line"
                                    : "Script line (empty restores quote)"
                                }
                                onSave={(text) => handleSaveCardLine(card, text)}
                                onCancel={() => setEditingCardId(null)}
                              />
                            </div>
                          ) : (
                            <div className="min-w-0 flex-1 leading-[24px]">
                              <span
                                onClick={() => setEditingCardId(card.id)}
                                title="Click to edit line"
                                className={cn(
                                  "cursor-pointer text-[15px]",
                                  card.kind === "broll" && "italic text-foreground/90",
                                  card.kind === "line" && "text-foreground",
                                  card.kind === "quote" &&
                                    (card.script_line ? "text-foreground" : "text-foreground/90"),
                                  isPlaceholder && "italic text-muted-foreground",
                                )}
                              >
                                {card.kind === "broll" && (
                                  <span className="not-italic font-medium text-muted-foreground mr-1.5">
                                    B-roll:
                                  </span>
                                )}
                                {isPlaceholder ? "“…”" : lineText}
                              </span>

                              {card.kind !== "line" && (
                                <CitationPopover
                                  card={card}
                                  n={refInfo?.n ?? null}
                                  sourceItem={sourceItem}
                                  sourceTitle={sourceTitle}
                                  onOpenCard={onOpenCard}
                                />
                              )}
                            </div>
                          )}
                        </div>

                        {/* Inserter after each card */}
                        <LineInserter
                          onInsert={() => {
                            const pos = positionBetween(card.position, nextCard?.position ?? null);
                            void insertLineCard(section.id, pos);
                          }}
                        />
                      </React.Fragment>
                    );
                  })}

                  {sortedCards.length === 0 && (
                    <p className="py-2 text-[13px] italic leading-[19px] text-muted-foreground">
                      No cards in this section yet.
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
