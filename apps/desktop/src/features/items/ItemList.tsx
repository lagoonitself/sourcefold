import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileStack,
  Folder as FolderIcon,
  MessageSquare,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Triage } from "@sourcefold/core";
import type { Folder, Item } from "@/lib/types";
import { deleteItem, openImage, renameItem } from "@/lib/api";
import { openUrl, cn, errorMessage } from "@/lib/utils";
import { NoteDialog } from "./NoteDialog";
import { MoveItemDialog } from "./MoveItemDialog";
import { linkOfItem, openSource, opensInReader } from "../reader/open-decision";
import {
  formatSavedDate,
  getSourceKind,
  getSourceMetaLine,
  SourceTile,
  StatusIcon,
} from "./source-kinds";
import { onGroupAction } from "./group-actions";
import { hasTextSelection, isMacPlatform, isTypingContext } from "../shortcuts/key-utils";
import {
  BulkStatusMenu,
  BulkTagMenu,
  ListFilterBar,
  SummaryDialog,
  TagChips,
  TagsDialog,
  TriageMark,
  NO_FILTER,
  addTag,
  filterItems,
  groupTags,
  isFiltering,
  projectIdOf,
  removeTag,
  researchMetaLine,
  resolveFilter,
  useItemResearch,
  type ListFilter,
} from "../research/source-info";

// The status and tag filter each group was last shown with, for the session.
const rememberedFilters = new Map<string, ListFilter>();

export interface ItemListProps {
  items: Item[];
  folders: Folder[];
  onRefresh: () => Promise<void>;
  isFocusedRegion?: boolean;
  focusedItemId?: string | null;
  onFocusedItemChange?: (itemId: string | null) => void;
  onOpenReader?: (item: Item) => void;
}

function linkOf(item: Item): string | null {
  return linkOfItem(item);
}

function linksLabel(count: number) {
  return count === 1 ? "1 link" : `${count} links`;
}

async function openImageItem(item: Item) {
  try {
    await openImage(item);
  } catch (err) {
    toast.error(errorMessage(err, "Couldn't open that image."));
  }
}

export function ItemList({
  items: sourceItems,
  folders,
  onRefresh,
  isFocusedRegion = false,
  focusedItemId: externalFocusedId,
  onFocusedItemChange,
  onOpenReader,
}: ItemListProps) {
  // Status, tag, author and summary changes show at once; the list reloads once they are saved.
  const research = useItemResearch({ onSynced: onRefresh, clearAfterSync: true });
  const allItems = React.useMemo(
    () => sourceItems.map(research.withResearch),
    [sourceItems, research.withResearch],
  );
  const groupId = allItems[0]?.folder_id ?? null;
  const projectId = React.useMemo(() => projectIdOf(folders, groupId), [folders, groupId]);
  const [, setFilterVersion] = React.useState(0);
  const savedFilter = (groupId ? rememberedFilters.get(groupId) : undefined) ?? NO_FILTER;
  const tagsInGroup = React.useMemo(() => groupTags(allItems), [allItems]);
  const filter = React.useMemo(
    () => resolveFilter(savedFilter, tagsInGroup),
    [savedFilter, tagsInGroup],
  );
  const setFilter = React.useCallback(
    (next: ListFilter) => {
      if (groupId) rememberedFilters.set(groupId, next);
      setFilterVersion((n) => n + 1);
    },
    [groupId],
  );
  const items = React.useMemo(() => filterItems(allItems, filter), [allItems, filter]);

  const [tagsOpen, setTagsOpen] = React.useState(false);
  const [summaryOpen, setSummaryOpen] = React.useState(false);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [selecting, setSelecting] = React.useState(false);
  const [copiedAll, setCopiedAll] = React.useState(false);
  const [internalFocusedId, setInternalFocusedId] = React.useState<string | null>(null);

  const focusedItemId = externalFocusedId ?? internalFocusedId ?? (items[0]?.id || null);

  const setFocusedItemId = React.useCallback(
    (id: string | null) => {
      setInternalFocusedId(id);
      onFocusedItemChange?.(id);
    },
    [onFocusedItemChange],
  );

  const [renameItemTarget, setRenameItemTarget] = React.useState<Item | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const [noteItem, setNoteItem] = React.useState<Item | null>(null);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isRenaming, setIsRenaming] = React.useState(false);

  const lastGTimeRef = React.useRef<number>(0);
  const lastToggledIdRef = React.useRef<string | null>(null);
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  const selectionMode = selecting || selectedIds.size > 0;
  const linkItems = React.useMemo(() => items.filter((i) => linkOf(i)), [items]);
  const selectedItems = React.useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  React.useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedItems.length > 0 && !allSelected;
    }
  }, [selectedItems.length, allSelected, selectionMode]);

  React.useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // Keep focused row valid when items change
  React.useEffect(() => {
    if (items.length === 0) {
      setFocusedItemId(null);
    } else if (!items.some((i) => i.id === focusedItemId)) {
      setFocusedItemId(items[0].id);
    }
  }, [items, focusedItemId, setFocusedItemId]);

  // Drop selections for sources that left the list (moved, deleted, or another group opened).
  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(items.map((i) => i.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  // Scroll focused row into view
  React.useEffect(() => {
    if (!isFocusedRegion || !focusedItemId || !listContainerRef.current) return;
    const rowEl = listContainerRef.current.querySelector<HTMLElement>(
      `[data-item-id="${focusedItemId}"]`,
    );
    if (rowEl) {
      rowEl.scrollIntoView({ block: "nearest" });
    }
  }, [focusedItemId, isFocusedRegion]);

  const focusedItem = React.useMemo(() => {
    return items.find((i) => i.id === focusedItemId) || null;
  }, [items, focusedItemId]);

  // What bulk actions apply to: the selection, else the focused row.
  const actionTargets = selectedItems.length > 0 ? selectedItems : focusedItem ? [focusedItem] : [];

  const handleOpenSource = React.useCallback(
    (item: Item, options?: { forceExternal?: boolean }) => {
      openSource(
        item,
        {
          image: (image) => void openImageItem(image),
          reader: (source) => onOpenReader?.(source),
          browser: (url) => void openUrl(url),
        },
        options,
      );
    },
    [onOpenReader],
  );

  /** Copies the links of `targets` (one per line). Returns whether anything was copied. */
  const copyLinks = React.useCallback(async (targets: Item[]): Promise<boolean> => {
    const urls = targets.map(linkOf).filter((url): url is string => Boolean(url));

    if (urls.length === 0) {
      toast.info("No links to copy");
      return false;
    }

    try {
      await navigator.clipboard.writeText(urls.join("\n"));
      toast.success(urls.length === 1 ? "Link copied" : `Copied ${linksLabel(urls.length)}`);
      return true;
    } catch {
      toast.error("Couldn't copy to the clipboard. Try again.");
      return false;
    }
  }, []);

  const handleCopyLinks = React.useCallback(
    (itemsToCopy?: Item[]) =>
      copyLinks(itemsToCopy && itemsToCopy.length > 0 ? itemsToCopy : actionTargets),
    [actionTargets, copyLinks],
  );

  const handleCopyAll = React.useCallback(async () => {
    if (!(await copyLinks(linkItems))) return;
    setCopiedAll(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedAll(false), 2000);
  }, [copyLinks, linkItems]);

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
      const lastId = lastToggledIdRef.current;
      lastToggledIdRef.current = id;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const select = !next.has(id);
        if (shiftKey && lastId) {
          const from = items.findIndex((i) => i.id === lastId);
          const to = items.findIndex((i) => i.id === id);
          if (from !== -1 && to !== -1) {
            for (const item of items.slice(Math.min(from, to), Math.max(from, to) + 1)) {
              if (select) next.add(item.id);
              else next.delete(item.id);
            }
          }
        }
        if (select) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [items],
  );

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };

  // Palette entries for this list
  React.useEffect(
    () =>
      onGroupAction((action) => {
        if (action === "select-mode") toggleSelecting();
        else if (action === "copy-all-links") void handleCopyAll();
      }),
    [toggleSelecting, handleCopyAll],
  );

  // Range selection helper
  const extendSelectionTo = React.useCallback(
    (targetIndex: number) => {
      if (items.length === 0) return;
      const targetItem = items[targetIndex];
      if (!targetItem) return;

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (focusedItemId) next.add(focusedItemId);
        next.add(targetItem.id);
        return next;
      });
      setFocusedItemId(targetItem.id);
    },
    [items, focusedItemId, setFocusedItemId],
  );

  // Keyboard navigation for Source List
  React.useEffect(() => {
    if (!isFocusedRegion) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (isTypingContext(e.target) || isAnyDialogOpen()) return;

      const currentIndex = items.findIndex((i) => i.id === focusedItemId);

      // Move down: j / ArrowDown
      if (
        (e.key === "j" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) ||
        (e.key === "ArrowDown" && !e.shiftKey && !e.altKey)
      ) {
        e.preventDefault();
        if (items.length > 0) {
          const nextIdx = Math.min(currentIndex + 1, items.length - 1);
          setFocusedItemId(items[nextIdx].id);
        }
        return;
      }

      // Move up: k / ArrowUp
      if (
        (e.key === "k" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) ||
        (e.key === "ArrowUp" && !e.shiftKey && !e.altKey)
      ) {
        e.preventDefault();
        if (items.length > 0) {
          const prevIdx = Math.max(currentIndex - 1, 0);
          setFocusedItemId(items[prevIdx].id);
        }
        return;
      }

      // Extend selection down: Shift+J / Shift+ArrowDown
      if (
        (e.key === "J" && e.shiftKey && !e.ctrlKey && !e.metaKey) ||
        (e.key === "ArrowDown" && e.shiftKey)
      ) {
        e.preventDefault();
        if (items.length > 0) {
          const nextIdx = Math.min(currentIndex + 1, items.length - 1);
          extendSelectionTo(nextIdx);
        }
        return;
      }

      // Extend selection up: Shift+K / Shift+ArrowUp
      if (
        (e.key === "K" && e.shiftKey && !e.ctrlKey && !e.metaKey) ||
        (e.key === "ArrowUp" && e.shiftKey)
      ) {
        e.preventDefault();
        if (items.length > 0) {
          const prevIdx = Math.max(currentIndex - 1, 0);
          extendSelectionTo(prevIdx);
        }
        return;
      }

      // Top: Home / g g
      if (e.key === "Home") {
        e.preventDefault();
        if (items.length > 0) setFocusedItemId(items[0].id);
        return;
      }
      if (e.key === "g" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const now = Date.now();
        if (now - lastGTimeRef.current < 500) {
          e.preventDefault();
          if (items.length > 0) setFocusedItemId(items[0].id);
          lastGTimeRef.current = 0;
        } else {
          lastGTimeRef.current = now;
        }
        return;
      }

      // Bottom: End / Shift+G
      if (e.key === "End" || (e.key === "G" && e.shiftKey && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        if (items.length > 0) setFocusedItemId(items[items.length - 1].id);
        return;
      }

      // Open external URL: Shift+Enter / o
      if (
        (e.key === "Enter" && e.shiftKey) ||
        (e.key === "o" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)
      ) {
        e.preventDefault();
        if (focusedItem) {
          handleOpenSource(focusedItem, { forceExternal: true });
        }
        return;
      }

      // Open reader or URL: Enter
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (focusedItem) {
          handleOpenSource(focusedItem);
        }
        return;
      }

      // Toggle select: x / Space
      if (
        (e.key === "x" && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        (e.key === " " && !e.ctrlKey && !e.metaKey && !e.altKey)
      ) {
        e.preventDefault();
        if (focusedItem) {
          toggleSelected(focusedItem.id);
        }
        return;
      }

      // Selection mode on/off: s
      if (e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleSelecting();
        return;
      }

      // Copy every link in the group: Shift+Y
      if (e.key === "Y" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        void handleCopyAll();
        return;
      }

      // Select all: Mod+A (leave it to the browser when text is selected, like Mod+C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (!hasTextSelection()) {
          e.preventDefault();
          setSelectedIds(new Set(items.map((i) => i.id)));
        }
        return;
      }

      // Esc: clear selection and leave selection mode
      if (e.key === "Escape" && selectionMode) {
        e.preventDefault();
        stopSelecting();
        return;
      }

      // Copy links: y / Mod+C (only when no text is selected)
      if (
        (e.key === "y" && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c")
      ) {
        if (!hasTextSelection()) {
          e.preventDefault();
          void handleCopyLinks();
        }
        return;
      }

      // Move to group: m
      if (e.key === "m" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (actionTargets.length > 0) {
          setMoveOpen(true);
        }
        return;
      }

      // Rename: e / F2
      if (
        (e.key === "e" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) ||
        e.key === "F2"
      ) {
        e.preventDefault();
        if (focusedItem) {
          setRenameItemTarget(focusedItem);
          setRenameValue(focusedItem.title);
        }
        return;
      }

      // Edit note: n
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (focusedItem) {
          setNoteItem(focusedItem);
        }
        return;
      }

      // Delete: Delete
      if (e.key === "Delete" && !e.altKey) {
        e.preventDefault();
        if (actionTargets.length > 0) {
          setDeleteConfirmOpen(true);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isFocusedRegion,
    items,
    focusedItemId,
    focusedItem,
    selectionMode,
    actionTargets,
    handleOpenSource,
    handleCopyLinks,
    handleCopyAll,
    extendSelectionTo,
    setFocusedItemId,
    stopSelecting,
    toggleSelected,
    toggleSelecting,
  ]);

  const handleDeleteConfirmed = async () => {
    setIsDeleting(true);
    const idsToDelete = actionTargets.map((i) => i.id);

    try {
      await Promise.all(idsToDelete.map((id) => deleteItem(id)));
      toast.success(
        idsToDelete.length === 1 ? "Source deleted" : `${idsToDelete.length} sources deleted`,
      );
      stopSelecting();
      setDeleteConfirmOpen(false);
      await onRefresh();
    } catch {
      toast.error("Failed to delete source(s)");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!renameItemTarget || isRenaming) return;
    const newTitle = renameValue.trim();
    if (!newTitle) return;

    setIsRenaming(true);
    try {
      await renameItem(renameItemTarget.id, newTitle);
      toast.success("Source renamed");
      setRenameItemTarget(null);
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to rename source");
    } finally {
      setIsRenaming(false);
    }
  };

  const selectedLinkCount = selectedItems.filter((i) => linkOf(i)).length;

  return (
    <div ref={listContainerRef} className="relative flex min-h-0 flex-1 flex-col select-none">
      {/* List toolbar: Select and Copy all links when outside select mode */}
      {!selectionMode && items.length > 0 && (
        <div className="flex h-11 shrink-0 items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={toggleSelecting} title="Select (s)">
            <span>Select</span>
            <Kbd>s</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={linkItems.length === 0}
            onClick={() => void handleCopyAll()}
            title={
              linkItems.length === 0
                ? "No sources in this group have a link"
                : "Copy all links (Shift+Y)"
            }
          >
            {copiedAll ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            <span>{copiedAll ? "Copied" : "Copy all links"}</span>
            {!copiedAll && <Kbd>⇧Y</Kbd>}
          </Button>
        </div>
      )}

      {/* Floating action bar in selection mode */}
      <AnimatePresence>
        {selectionMode && (
          <motion.div
            initial={{ opacity: 0, y: 16, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 12, x: "-50%", transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="absolute bottom-5 left-1/2 z-30 flex items-center gap-2 rounded-[12px] border border-border bg-popover px-3 py-2 text-popover-foreground shadow-float"
          >
            <label className="flex cursor-pointer items-center justify-center pr-1">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all sources"
                className="size-4 cursor-pointer accent-primary"
              />
            </label>
            <span className="font-sans text-[13px] font-medium leading-none tabular-nums text-foreground">
              {selectedItems.length > 0 ? `${selectedItems.length} selected` : "Select sources"}
            </span>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <Button
              variant="outline"
              size="sm"
              disabled={selectedLinkCount === 0}
              onClick={() => void handleCopyLinks(selectedItems)}
              title="Copy links (y)"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              <span>
                {selectedLinkCount > 0 ? `Copy ${linksLabel(selectedLinkCount)}` : "Copy links"}
              </span>
              <Kbd>y</Kbd>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedItems.length === 0}
              onClick={() => setMoveOpen(true)}
              title="Move to group (m)"
            >
              <FolderIcon className="size-3.5" aria-hidden="true" />
              <span>Move</span>
              <Kbd>m</Kbd>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={selectedItems.length === 0}
              onClick={() => setDeleteConfirmOpen(true)}
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

      {/* Item rows */}
      <div className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto", selectionMode && "pb-20")}>
        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-12">
            <EmptyState
              icon={FileStack}
              title="Nothing here yet"
              description="Add Grokipedia, YouTube, Substack or any other links, or save a page with the Sourcefold extension."
              actions={
                <Button
                  variant="default"
                  onClick={() => {
                    window.dispatchEvent(
                      new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }),
                    );
                  }}
                  title="Add links (a)"
                >
                  <span>Add links</span>
                  <Kbd>A</Kbd>
                </Button>
              }
            />
          </div>
        ) : (
          items.map((item, index) => {
            const isSelected = selectedIds.has(item.id);
            const isFocusedRow = item.id === focusedItemId;
            const hasNote = Boolean(item.kind !== "note" && item.note && item.note.trim());
            const canRead = opensInReader(item);
            const kind = getSourceKind(item.kind);
            const metaLine = getSourceMetaLine(
              item.kind,
              item.meta as Record<string, unknown> | null,
            );
            const staggerDelay = index < 12 ? index * 0.02 : 0;

            return (
              <motion.div
                key={item.id}
                data-item-id={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1], delay: staggerDelay }}
                onClick={() => {
                  setFocusedItemId(item.id);
                  if (selectionMode) toggleSelected(item.id);
                  else handleOpenSource(item);
                }}
                className={cn(
                  "group relative -mx-2.5 flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-1.5 transition-colors duration-100",
                  isSelected
                    ? "bg-marker-soft"
                    : isFocusedRow && isFocusedRegion
                      ? "bg-accent"
                      : isFocusedRow
                        ? "bg-muted/70"
                        : "hover:bg-muted",
                )}
              >
                {isFocusedRow && isFocusedRegion && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0.5 w-[2px] rounded-full bg-foreground"
                  />
                )}

                {selectionMode && (
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFocusedItemId(item.id);
                        toggleSelected(item.id, e.shiftKey);
                      }}
                      aria-label={`Select ${item.title}`}
                      className="size-4 cursor-pointer accent-primary"
                    />
                  </div>
                )}

                <SourceTile kind={kind} />

                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-serif text-[16px] font-medium leading-[22px] text-foreground">
                      {item.title}
                    </span>
                    {hasNote && (
                      <span
                        role="img"
                        aria-label="Has a note"
                        title={item.note ?? "Has a note"}
                        className="inline-flex shrink-0 text-muted-foreground"
                      >
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  {metaLine && (
                    <div className="truncate font-sans text-[12px] leading-[16px] text-muted-foreground">
                      {metaLine}
                    </div>
                  )}
                </div>

                <div className="hidden w-24 shrink-0 text-right font-sans text-[13px] leading-[18px] text-muted-foreground @[560px]/view:block">
                  {kind.name}
                </div>

                <div className="hidden w-16 shrink-0 text-right font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums @[440px]/view:block">
                  {formatSavedDate(item.created_at)}
                </div>

                <div className="flex w-5 shrink-0 items-center justify-end">
                  <StatusIcon status={item.status} error={item.error} />
                </div>

                {/* Row actions: on hover, on keyboard focus, and on the keyboard-focused row */}
                <div
                  className={cn(
                    "flex shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                    isFocusedRow && isFocusedRegion && "opacity-100",
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedItemId(item.id);
                      setNoteItem(item);
                    }}
                    aria-label="Add or edit note"
                    className="flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    title="Note (n)"
                  >
                    <MessageSquare className="size-3.5" />
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Source menu"
                        className="flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <MoreVertical className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {canRead && (
                        <DropdownMenuItem
                          onClick={() => {
                            setFocusedItemId(item.id);
                            onOpenReader?.(item);
                          }}
                        >
                          <BookOpen className="size-3.5" />
                          <span>Reader view</span>
                          <Kbd>↵</Kbd>
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          handleOpenSource(item, { forceExternal: true });
                        }}
                      >
                        <ExternalLink className="size-3.5" />
                        <span>{item.kind === "image" ? "Open image" : "Open in browser"}</span>
                        <Kbd>⇧↵ / o</Kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          void handleCopyLinks([item]);
                        }}
                      >
                        <Copy className="size-3.5" />
                        <span>Copy link</span>
                        <Kbd>y</Kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setMoveOpen(true);
                        }}
                      >
                        <FolderIcon className="size-3.5" />
                        <span>Move to group</span>
                        <Kbd>m</Kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setRenameItemTarget(item);
                          setRenameValue(item.title);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        <span>Rename</span>
                        <Kbd>e / F2</Kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setNoteItem(item);
                        }}
                      >
                        <MessageSquare className="size-3.5" />
                        <span>{hasNote ? "Edit note" : "Add note"}</span>
                        <Kbd>n</Kbd>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setDeleteConfirmOpen(true);
                        }}
                        variant="destructive"
                      >
                        <Trash2 className="size-3.5" />
                        <span>Delete</span>
                        <Kbd>{isMac ? "⌦" : "Del"}</Kbd>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Move Dialog */}
      <MoveItemDialog
        items={actionTargets}
        folders={folders}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={async () => {
          stopSelecting();
          await onRefresh();
        }}
      />

      {/* Note dialog */}
      {noteItem && (
        <NoteDialog
          open={Boolean(noteItem)}
          onOpenChange={(open) => !open && setNoteItem(null)}
          item={noteItem}
          onSaved={async () => {
            setNoteItem(null);
            await onRefresh();
          }}
        />
      )}

      {/* Rename dialog */}
      <Dialog
        open={Boolean(renameItemTarget)}
        onOpenChange={(open) => !open && setRenameItemTarget(null)}
      >
        <DialogContent>
          <form onSubmit={handleRenameSubmit}>
            <DialogHeader>
              <DialogTitle>Rename source</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                disabled={isRenaming}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameItemTarget(null)}
                disabled={isRenaming}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!renameValue.trim() || isRenaming}>
                {isRenaming ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionTargets.length > 1
                ? `Delete ${actionTargets.length} sources`
                : "Delete source"}
            </DialogTitle>
            <DialogDescription>
              {actionTargets.length > 1
                ? `Are you sure you want to delete these ${actionTargets.length} sources? This action cannot be undone.`
                : `Are you sure you want to delete "${actionTargets[0]?.title || "this source"}"?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={isDeleting}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteConfirmed}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
