import * as React from "react";
import { ExternalLink, Film, FolderInput, MoreHorizontal, NotebookPen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  formatClipTime,
  parseClipTime,
  youtubeThumbnailUrl,
  type Card,
  type OutlineSection,
} from "@sourcefold/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { Item } from "@/lib/types";
import { cn, openUrl } from "@/lib/utils";
import { cardBodyText, cardOpenUrl } from "../shared/card-display";
import { InlineText } from "../shared/InlineText";

export interface BrollRowProps {
  card: Card;
  itemsById: ReadonlyMap<string, Item>;
  sections: readonly OutlineSection[];
  onPatchCard: (id: string, patch: Partial<Card>) => Promise<boolean>;
  onPlaceInOutline: (card: Card) => void;
  onDelete: (card: Card) => void;
}

export function BrollRow({
  card,
  itemsById,
  sections,
  onPatchCard,
  onPlaceInOutline,
  onDelete,
}: BrollRowProps) {
  const [editingField, setEditingField] = React.useState<"body" | "note" | "time" | null>(null);
  const [timeInput, setTimeInput] = React.useState("");
  const [timeError, setTimeError] = React.useState(false);

  const item = card.item_id ? itemsById.get(card.item_id) : undefined;
  const videoAddress = item?.source_url ?? item?.canonical_url ?? card.url;
  const thumbnailUrl = youtubeThumbnailUrl(videoAddress);
  const openLink = cardOpenUrl(card, itemsById);

  const sourceTitle = item
    ? item.title
    : card.url
      ? new URL(card.url).hostname.replace(/^www\./, "")
      : "Unknown video";

  const currentSection = card.section_id
    ? sections.find((s) => s.id === card.section_id)
    : undefined;

  const formattedTime = formatClipTime(card.seconds, card.end_seconds);
  const bodyText = cardBodyText(card);

  const handleSaveBody = (text: string) => {
    setEditingField(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    if (card.script_line !== null) {
      void onPatchCard(card.id, { script_line: trimmed });
    } else {
      void onPatchCard(card.id, { quote: trimmed });
    }
  };

  const handleSaveNote = (text: string) => {
    setEditingField(null);
    const trimmed = text.trim();
    void onPatchCard(card.id, { note: trimmed || null });
  };

  const startTimeEdit = () => {
    setTimeInput(formattedTime ?? "");
    setTimeError(false);
    setEditingField("time");
  };

  const handleSaveTime = () => {
    const raw = timeInput.trim();
    if (!raw) {
      setEditingField(null);
      void onPatchCard(card.id, { seconds: null, end_seconds: null });
      return;
    }

    // Check for range like "1:05-1:20" or "1:05 - 1:20" or "1:05–1:20"
    const rangeParts = raw.split(/[-–—]/);
    if (rangeParts.length === 2) {
      const start = parseClipTime(rangeParts[0]);
      const end = parseClipTime(rangeParts[1]);
      if (start === null || end === null || end < start) {
        setTimeError(true);
        toast.error("Invalid time range. Example: 1:05–1:20");
        return;
      }
      setEditingField(null);
      void onPatchCard(card.id, { seconds: start, end_seconds: end });
      return;
    }

    const start = parseClipTime(raw);
    if (start === null) {
      setTimeError(true);
      toast.error("Invalid time format. Example: 1:05");
      return;
    }

    setEditingField(null);
    void onPatchCard(card.id, { seconds: start, end_seconds: null });
  };

  return (
    <div className="group relative flex items-start gap-3.5 rounded-[12px] p-2.5 transition-colors hover:bg-muted/60">
      {/* Thumbnail */}
      <div className="relative h-[54px] w-24 shrink-0 overflow-hidden rounded-[6px] bg-muted">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Film className="size-5" aria-hidden="true" />
          </div>
        )}
      </div>

      {/* Main details */}
      <div className="min-w-0 flex-1 space-y-1">
        {/* Description / What it shows */}
        {editingField === "body" ? (
          <InlineText
            initial={bodyText}
            label="What this clip shows"
            placeholder="Describe the clip"
            onSave={handleSaveBody}
            onCancel={() => setEditingField(null)}
          />
        ) : (
          <p
            onClick={() => setEditingField("body")}
            title="Click to edit description"
            className="cursor-pointer font-serif text-[15px] font-medium leading-[22px] text-foreground hover:underline decoration-muted-foreground/40 underline-offset-2"
          >
            {bodyText || "Clip"}
          </p>
        )}

        {/* Source title and section tag */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] leading-[18px] text-muted-foreground">
          <span className="truncate max-w-[280px] font-medium text-foreground/80">
            {sourceTitle}
          </span>

          {currentSection ? (
            <span className="rounded-[4px] bg-muted px-1.5 py-0.2 text-[11.5px] text-muted-foreground">
              {currentSection.title}
            </span>
          ) : (
            <span className="text-[11.5px] italic text-muted-foreground/70">Not placed</span>
          )}
        </div>

        {/* Timestamps and notes */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[12px] text-muted-foreground">
          {editingField === "time" ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={timeInput}
                autoFocus
                onChange={(e) => {
                  setTimeInput(e.target.value);
                  setTimeError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTime();
                  if (e.key === "Escape") setEditingField(null);
                }}
                onBlur={handleSaveTime}
                placeholder="1:05–1:20"
                className={cn(
                  "h-6 w-24 rounded-[4px] border px-1.5 font-mono text-[11.5px] bg-background text-foreground",
                  timeError ? "border-destructive text-destructive" : "border-input",
                )}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={startTimeEdit}
              title="Click to edit timestamp"
              className="cursor-pointer rounded-[4px] font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground tabular-nums px-1 -mx-1"
            >
              {formattedTime || "No time"}
            </button>
          )}

          {editingField === "note" ? (
            <div className="w-full pt-1">
              <InlineText
                initial={card.note ?? ""}
                label="Clip note"
                placeholder="Add note..."
                onSave={handleSaveNote}
                onCancel={() => setEditingField(null)}
              />
            </div>
          ) : (
            <span
              onClick={() => setEditingField("note")}
              title="Click to edit note"
              className="flex cursor-pointer items-center gap-1 hover:text-foreground"
            >
              <NotebookPen className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[340px]">{card.note?.trim() || "Add note"}</span>
            </span>
          )}
        </div>
      </div>

      {/* Row action buttons */}
      <div className="flex items-center gap-1">
        {openLink && (
          <button
            type="button"
            onClick={() => void openUrl(openLink)}
            title="Open video at time"
            aria-label="Open in browser"
            className="flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Clip options"
              className="flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onPlaceInOutline(card)}>
              <FolderInput className="size-3.5" aria-hidden="true" />
              <span>Place in outline</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete(card)}>
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Delete clip</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
