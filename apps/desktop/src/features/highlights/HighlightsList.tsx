import * as React from "react";
import { Check, CircleAlert, Copy, Highlighter, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  copySourceFromItem,
  formatHighlightTime,
  formatQuotesWithSources,
  youtubeTimestampUrl,
  type Highlight,
} from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { isAnyDialogOpen } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kbd } from "@/components/ui/Kbd";
import type { Item } from "@/lib/types";
import { deleteHighlight, putHighlight } from "@/lib/api";
import { cn, errorMessage, openUrl } from "@/lib/utils";
import { getSourceKind, SourceTile } from "../items/source-kinds";
import { onGroupAction } from "../items/group-actions";
import { hasTextSelection, isTypingContext } from "../shortcuts/key-utils";
import {
  buildHighlightRows,
  citedLabel,
  copiedMessage,
  pruneSelection,
  rowsToCopy,
  toHighlightInput,
  toggleSelection,
  type HighlightRow,
} from "./highlight-rows";

export interface HighlightsListProps {
  items: Item[];
  highlights: Highlight[];
  loading: boolean;
  error: string | null;
  isFocusedRegion?: boolean;
  /** Reloads the highlights (after a delete or an undo, and when the tab opens). */
  onRefresh: () => Promise<void>;
  /** Enter or a click: open the reader at this highlight. */
  onOpenHighlight: (item: Item, highlightId: string) => void;
}

const noModifiers = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;

export function HighlightsList({
  items,
  highlights,
  loading,
  error,
  isFocusedRegion = false,
  onRefresh,
  onOpenHighlight,
}: HighlightsListProps) {
  const rows = React.useMemo(() => buildHighlightRows(highlights, items), [highlights, items]);
  const orderedIds = React.useMemo(() => rows.map((r) => r.highlight.id), [rows]);

  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [selecting, setSelecting] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [copied, setCopied] = React.useState(false);
  const lastToggledRef = React.useRef<string | null>(null);
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectionMode = selecting || selectedIds.size > 0;
  const selectedCount = selectedIds.size;
  const allSelected = rows.length > 0 && selectedCount === rows.length;

  // The tab was just opened: pick up changes made in the reader.
  React.useEffect(() => {
    void onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected, selectionMode]);

  // Keep the focused row valid, and drop selections of highlights that are gone.
  React.useEffect(() => {
    setFocusedId((prev) => (prev && orderedIds.includes(prev) ? prev : (orderedIds[0] ?? null)));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = pruneSelection(prev, orderedIds);
      return next.size === prev.size ? prev : next;
    });
  }, [orderedIds]);

  React.useEffect(() => {
    if (!isFocusedRegion || !focusedId || !containerRef.current) return;
    containerRef.current
      .querySelector<HTMLElement>(`[data-highlight-id="${focusedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusedId, isFocusedRegion]);

  const focusedRow = rows.find((r) => r.highlight.id === focusedId) ?? null;

  const stopSelecting = React.useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelecting = React.useCallback(() => {
    if (selectionMode) stopSelecting();
    else setSelecting(true);
  }, [selectionMode, stopSelecting]);

  const toggleSelected = React.useCallback(
    (id: string, shiftKey = false) => {
      const lastId = lastToggledRef.current;
      lastToggledRef.current = id;
      setSelectedIds((prev) => toggleSelection(orderedIds, prev, id, lastId, shiftKey));
    },
    [orderedIds],
  );

  React.useEffect(
    () =>
      onGroupAction((action) => {
        if (action === "select-mode") toggleSelecting();
      }),
    [toggleSelecting],
  );

  const handleCopy = React.useCallback(async () => {
    const chosen = rowsToCopy(rows, selectedIds);
    if (chosen.length === 0) {
      toast.info("No highlights to copy");
      return;
    }
    try {
      const text = formatQuotesWithSources(
        chosen.map((row) => ({
          highlight: row.highlight,
          source: copySourceFromItem(row.item),
          itemId: row.item.id,
        })),
      );
      await navigator.clipboard.writeText(text);
      toast.success(copiedMessage(chosen.length));
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy to the clipboard. Try again.");
    }
  }, [rows, selectedIds]);

  const handleDelete = React.useCallback(
    async (targets: HighlightRow<Item>[]) => {
      if (targets.length === 0) return;
      const removed = targets.map((t) => t.highlight);
      try {
        await Promise.all(removed.map((h) => deleteHighlight(h.id)));
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't delete the highlight."));
        await onRefresh();
        return;
      }
      setSelectedIds(new Set());
      await onRefresh();
      toast(removed.length === 1 ? "Highlight deleted" : `${removed.length} highlights deleted`, {
        action: {
          label: "Undo",
          onClick: () => {
            void Promise.all(removed.map((h) => putHighlight(toHighlightInput(h))))
              .then(() => onRefresh())
              .catch((err) => toast.error(errorMessage(err, "Couldn't restore the highlight.")));
          },
        },
      });
    },
    [onRefresh],
  );

  const openAtSecond = (row: HighlightRow<Item>) => {
    const seconds = row.highlight.seconds;
    if (seconds === null || seconds === undefined) return;
    const url = youtubeTimestampUrl(row.item.source_url || row.item.canonical_url, seconds);
    if (url) void openUrl(url);
    else onOpenHighlight(row.item, row.highlight.id);
  };

  // Keyboard: same keys as the sources list. Shift+H (tabs) is handled by the group header.
  React.useEffect(() => {
    if (!isFocusedRegion) return;

    const move = (index: number) => {
      const row = rows[Math.max(0, Math.min(index, rows.length - 1))];
      if (row) setFocusedId(row.highlight.id);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingContext(e.target) || isAnyDialogOpen()) return;
      const current = rows.findIndex((r) => r.highlight.id === focusedId);
      const plain = noModifiers(e) && !e.shiftKey;

      if ((e.key === "j" || e.key === "ArrowDown") && plain) {
        e.preventDefault();
        move(current + 1);
      } else if ((e.key === "k" || e.key === "ArrowUp") && plain) {
        e.preventDefault();
        move(current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        move(0);
      } else if (e.key === "End" || (e.key === "G" && e.shiftKey && noModifiers(e))) {
        e.preventDefault();
        move(rows.length - 1);
      } else if (e.key === "Enter" && plain) {
        e.preventDefault();
        if (focusedRow) onOpenHighlight(focusedRow.item, focusedRow.highlight.id);
      } else if (e.key === "s" && plain) {
        e.preventDefault();
        toggleSelecting();
      } else if ((e.key === "x" || e.key === " ") && noModifiers(e)) {
        e.preventDefault();
        if (focusedRow) toggleSelected(focusedRow.highlight.id);
      } else if (e.key === "Escape" && selectionMode) {
        e.preventDefault();
        stopSelecting();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (!hasTextSelection()) {
          e.preventDefault();
          setSelectedIds(new Set(orderedIds));
        }
      } else if ((e.key === "y" && plain) || ((e.ctrlKey || e.metaKey) && e.key === "c")) {
        if (!hasTextSelection()) {
          e.preventDefault();
          void handleCopy();
        }
      } else if (e.key === "Delete" && !e.altKey) {
        e.preventDefault();
        const targets =
          selectedIds.size > 0
            ? rows.filter((r) => selectedIds.has(r.highlight.id))
            : focusedRow
              ? [focusedRow]
              : [];
        void handleDelete(targets);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isFocusedRegion,
    rows,
    orderedIds,
    focusedId,
    focusedRow,
    selectedIds,
    selectionMode,
    handleCopy,
    handleDelete,
    onOpenHighlight,
    stopSelecting,
    toggleSelected,
    toggleSelecting,
  ]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading highlights" className="flex flex-col gap-1 py-2">
        <span className="sr-only">Loading highlights…</span>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="-mx-2.5 flex items-start gap-3 rounded-[10px] px-2.5 py-3"
            aria-hidden="true"
          >
            <div className="skeleton size-8 shrink-0 rounded-[8px]" />
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">
              <div
                className="skeleton h-4.5 rounded"
                style={{ width: i === 0 ? "78%" : i === 1 ? "92%" : "64%" }}
              />
              <div
                className="skeleton h-3.5 rounded"
                style={{ width: i === 0 ? "36%" : i === 1 ? "44%" : "28%" }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={CircleAlert}
        title="Couldn't load highlights"
        description={error}
        actions={
          <Button variant="outline" size="sm" onClick={() => void onRefresh()}>
            Try again
          </Button>
        }
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={Highlighter}
        title="No highlights yet"
        description="Open a source with Enter and select text to highlight it."
      />
    );
  }

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 select-none flex-col">
      {/* 44px toolbar outside select mode */}
      {!selectionMode && (
        <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-border">
          <Button variant="ghost" size="sm" onClick={toggleSelecting} title="Select (s)">
            <span>Select</span>
            <Kbd>s</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCopy()}
            title={
              selectedCount > 0 ? "Copy selected with sources (y)" : "Copy all with sources (y)"
            }
          >
            {copied ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy with sources"}</span>
            {!copied && <Kbd>y</Kbd>}
          </Button>
        </div>
      )}

      {/* Floating selection bar in select mode */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            role="toolbar"
            aria-label="Bulk actions"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="shadow-float absolute bottom-4 left-1/2 z-30 flex h-11 max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-[12px] border border-border bg-popover px-3.5 text-popover-foreground"
          >
            <label className="flex cursor-pointer select-none items-center gap-2 pr-1">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelectedIds(allSelected ? new Set() : new Set(orderedIds))}
                aria-label="Select all highlights"
                className="size-4 cursor-pointer accent-primary"
              />
              <span className="font-sans text-[13px] font-medium tabular-nums text-foreground">
                {selectedCount > 0 ? `${selectedCount} selected` : "Select highlights"}
              </span>
            </label>

            <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleCopy()}
              title={
                selectedCount > 0 ? "Copy selected with sources (y)" : "Copy all with sources (y)"
              }
              disabled={rows.length === 0}
            >
              {copied ? (
                <Check className="size-3.5 text-primary" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              <span>{copied ? "Copied" : "Copy with sources"}</span>
              {!copied && <Kbd>y</Kbd>}
            </Button>

            <Button
              variant="destructive"
              size="sm"
              disabled={selectedCount === 0}
              onClick={() => void handleDelete(rows.filter((r) => selectedIds.has(r.highlight.id)))}
              title="Delete (Delete)"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              <span>Delete</span>
            </Button>

            <Button variant="ghost" size="sm" onClick={stopSelecting} title="Cancel (Esc)">
              <span>Cancel</span>
              <Kbd>Esc</Kbd>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Highlight rows */}
      <ul
        role="list"
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-1",
          selectionMode && "pb-20",
        )}
      >
        {rows.map((row, index) => (
          <HighlightRowView
            key={row.highlight.id}
            index={index}
            row={row}
            isSelected={selectedIds.has(row.highlight.id)}
            isFocused={row.highlight.id === focusedId}
            isFocusedRegion={isFocusedRegion}
            selectionMode={selectionMode}
            onClick={() => {
              setFocusedId(row.highlight.id);
              if (selectionMode) toggleSelected(row.highlight.id);
              else onOpenHighlight(row.item, row.highlight.id);
            }}
            onCheckbox={(shiftKey) => {
              setFocusedId(row.highlight.id);
              toggleSelected(row.highlight.id, shiftKey);
            }}
            onTimestamp={() => openAtSecond(row)}
          />
        ))}
      </ul>
    </div>
  );
}

interface HighlightRowViewProps {
  index: number;
  row: HighlightRow<Item>;
  isSelected: boolean;
  isFocused: boolean;
  isFocusedRegion: boolean;
  selectionMode: boolean;
  onClick: () => void;
  onCheckbox: (shiftKey: boolean) => void;
  onTimestamp: () => void;
}

function HighlightRowView({
  index,
  row,
  isSelected,
  isFocused,
  isFocusedRegion,
  selectionMode,
  onClick,
  onCheckbox,
  onTimestamp,
}: HighlightRowViewProps) {
  const { highlight, item } = row;
  const [imageFailed, setImageFailed] = React.useState(false);
  const cited = citedLabel(highlight.cited);
  const note = highlight.note?.trim() ? highlight.note.trim() : null;
  const seconds = highlight.seconds;
  const showImage = highlight.kind === "image" && highlight.image_src && !imageFailed;

  return (
    <motion.li
      data-highlight-id={highlight.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.32,
        ease: [0.16, 1, 0.3, 1],
        delay: index < 12 ? index * 0.02 : 0,
      }}
      onClick={onClick}
      className={cn(
        "group relative -mx-2.5 flex cursor-pointer select-none items-start gap-3 rounded-[10px] px-2.5 py-2.5 transition-[background-color] duration-150",
        isSelected
          ? "bg-marker-soft"
          : isFocused && isFocusedRegion
            ? "bg-accent"
            : isFocused
              ? "bg-muted/60"
              : "hover:bg-muted",
      )}
    >
      {/* 2px ink bar on the left for keyboard focus */}
      {isFocused && isFocusedRegion && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-foreground"
        />
      )}

      {/* Selection checkbox */}
      {selectionMode && (
        <div className="flex w-7 shrink-0 items-center justify-center pt-1.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onCheckbox(e.shiftKey);
            }}
            aria-label={`Select highlight from ${item.title}`}
            className="size-4 cursor-pointer accent-primary"
          />
        </div>
      )}

      {/* Left thumbnail or source tile */}
      {showImage ? (
        <img
          src={highlight.image_src ?? undefined}
          alt={highlight.quote || "Highlighted image"}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="shadow-raised mt-0.5 size-8 shrink-0 rounded-[8px] border border-border/80 object-cover"
        />
      ) : (
        <SourceTile kind={item.kind} className="mt-0.5" />
      )}

      {/* Quote and metadata */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 font-serif text-[16px] font-medium leading-[24px] text-foreground">
          <span className="rounded-[3px] bg-marker-soft px-1 py-0.5 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
            {highlight.quote || (highlight.kind === "image" ? "Image" : "")}
          </span>
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-sans text-[12.5px] leading-[18px] text-muted-foreground">
          {seconds !== null && seconds !== undefined && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTimestamp();
              }}
              title="Open the video at this time"
              className="cursor-pointer rounded-[3px] font-sans font-medium tabular-nums text-foreground hover:underline"
            >
              {formatHighlightTime(seconds)}
            </button>
          )}
          <span className="min-w-0 truncate">{item.title}</span>
          {cited && <span className="shrink-0 truncate">{cited}</span>}
          {note && <span className="min-w-0 truncate">Note: {note}</span>}
        </p>
      </div>
    </motion.li>
  );
}
