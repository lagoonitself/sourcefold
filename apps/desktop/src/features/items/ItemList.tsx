import * as React from "react";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
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
import type { Folder, Item } from "@/lib/types";
import { deleteItem, openItemFile, renameItem, shouldUseTauri } from "@/lib/api";
import { getRemoteConfig } from "@/lib/remote-client";
import { openUrl, cn, errorMessage } from "@/lib/utils";
import { NoteDialog } from "./NoteDialog";
import { MoveItemDialog } from "./MoveItemDialog";
import { formatSavedDate, getSourceKind, StatusIcon } from "./source-kinds";
import { onGroupAction } from "./group-actions";
import { hasTextSelection, isMacPlatform, isTypingContext } from "../shortcuts/key-utils";

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
  return item.source_url || item.canonical_url || null;
}

function linksLabel(count: number) {
  return count === 1 ? "1 link" : `${count} links`;
}

function authorOf(item: Item): string | null {
  if ((item.kind !== "substack" && item.kind !== "x") || !item.meta) return null;
  const author = (item.meta as Record<string, unknown>).author;
  return typeof author === "string" && author.trim() ? author : null;
}

/** Images have no web page: offline they open in the system viewer, signed in on the web app. */
async function openImage(item: Item) {
  if (shouldUseTauri()) {
    try {
      await openItemFile(item.id);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't open that image."));
    }
    return;
  }
  const base = getRemoteConfig().remoteApiUrl.replace(/\/+$/, "");
  if (!base) {
    toast.error("Couldn't open that image.");
    return;
  }
  toast.info("Opening this group in the web app to view the image");
  await openUrl(`${base}/?folder=${encodeURIComponent(item.folder_id)}`);
}

export function ItemList({
  items,
  folders,
  onRefresh,
  isFocusedRegion = false,
  focusedItemId: externalFocusedId,
  onFocusedItemChange,
  onOpenReader,
}: ItemListProps) {
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
      if (item.kind === "image") {
        void openImage(item);
      } else if (!options?.forceExternal && item.markdown && item.markdown.trim() && onOpenReader) {
        onOpenReader(item);
      } else {
        const url = linkOf(item);
        if (url) {
          openUrl(url);
        } else if (onOpenReader) {
          onOpenReader(item);
        }
      }
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
    <div ref={listContainerRef} className="flex flex-col flex-1 min-h-0 select-none">
      {/* List toolbar: Select and Copy all links, or the bulk actions in selection mode */}
      {items.length > 0 && (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border">
          {selectionMode ? (
            <>
              <label className="ml-[3px] flex w-9 shrink-0 cursor-pointer items-center justify-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all sources"
                  className="size-4 cursor-pointer accent-primary"
                />
              </label>
              <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                {selectedItems.length > 0 ? `${selectedItems.length} selected` : "Select sources"}
              </span>
              <div className="mr-2 ml-auto flex items-center gap-2">
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
              </div>
            </>
          ) : (
            <div className="mr-2 ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={toggleSelecting} title="Select (s)">
                <span>Select</span>
                <Kbd>s</Kbd>
              </Button>
              <Button
                variant="outline"
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
        </div>
      )}

      {/* Item rows */}
      <div className="divide-y divide-border overflow-y-auto flex-1">
        {items.length === 0 ? (
          <div className="py-12 font-sans text-sm text-muted-foreground">
            Nothing here yet. Add Grokipedia links, or save a page with the Sourcefold extension.
            Press <Kbd className="text-[11px]">a</Kbd> to add links.
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isFocusedRow = item.id === focusedItemId;
            const hasNote = Boolean(item.kind !== "note" && item.note && item.note.trim());
            const hasMarkdown = Boolean(item.markdown && item.markdown.trim());
            const kind = getSourceKind(item.kind);
            const KindIcon = kind.Icon;
            const author = authorOf(item);

            return (
              <div
                key={item.id}
                data-item-id={item.id}
                onClick={() => {
                  setFocusedItemId(item.id);
                  if (selectionMode) toggleSelected(item.id);
                  else handleOpenSource(item);
                }}
                className={cn(
                  "group relative flex min-h-[48px] items-stretch transition-colors cursor-pointer",
                  isSelected ? "bg-accent" : "hover:bg-muted",
                  isFocusedRow && !isSelected && !isFocusedRegion && "bg-muted",
                  isFocusedRow && isFocusedRegion && "ring-2 ring-primary ring-inset",
                )}
              >
                <span
                  className={cn("w-[3px] shrink-0 self-stretch", kind.barClass)}
                  aria-hidden="true"
                />

                {selectionMode && (
                  <div className="flex w-9 shrink-0 items-center justify-center">
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

                <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-2">
                  <KindIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate font-serif text-[15px] font-medium leading-[22px] text-foreground">
                      {item.title}
                    </span>
                    {hasNote && (
                      <span
                        role="img"
                        aria-label="Has a note"
                        title={item.note ?? "Has a note"}
                        className="inline-flex shrink-0 self-center text-muted-foreground"
                      >
                        <MessageSquare className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                    {author && (
                      <span className="shrink-0 font-sans text-[13px] leading-[18px] text-muted-foreground">
                        {author}
                      </span>
                    )}
                  </div>
                  <div className="w-24 shrink-0 text-right font-sans text-[13px] leading-[18px] text-muted-foreground">
                    {kind.name}
                  </div>
                  <div className="w-16 shrink-0 text-right font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                    {formatSavedDate(item.created_at)}
                  </div>
                  <div className="flex w-5 shrink-0 items-center justify-end">
                    <StatusIcon status={item.status} error={item.error} />
                  </div>
                </div>

                {/* Row actions: on hover, on keyboard focus, and on the keyboard-focused row */}
                <div
                  className={cn(
                    "flex w-[60px] shrink-0 items-center justify-end gap-1 pr-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
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
                    className="flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-background hover:text-foreground cursor-pointer"
                    title="Note (n)"
                  >
                    <MessageSquare className="size-3.5" />
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Item menu"
                        className="flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-background hover:text-foreground cursor-pointer"
                      >
                        <MoreVertical className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {hasMarkdown && (
                        <DropdownMenuItem
                          onClick={() => {
                            setFocusedItemId(item.id);
                            onOpenReader?.(item);
                          }}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center">
                            <BookOpen className="mr-2 size-3.5" />
                            <span>Reader view</span>
                          </div>
                          <kbd className="text-[9px] font-mono text-muted-foreground">↵</kbd>
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          handleOpenSource(item, { forceExternal: true });
                        }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <ExternalLink className="mr-2 size-3.5" />
                          <span>{item.kind === "image" ? "Open image" : "Open in browser"}</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">⇧↵ / o</kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          void handleCopyLinks([item]);
                        }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <Copy className="mr-2 size-3.5" />
                          <span>Copy link</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">y</kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setMoveOpen(true);
                        }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <FolderIcon className="mr-2 size-3.5" />
                          <span>Move to group</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">m</kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setRenameItemTarget(item);
                          setRenameValue(item.title);
                        }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <Pencil className="mr-2 size-3.5" />
                          <span>Rename</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">e / F2</kbd>
                      </DropdownMenuItem>

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setNoteItem(item);
                        }}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <MessageSquare className="mr-2 size-3.5" />
                          <span>{hasNote ? "Edit note" : "Add note"}</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">n</kbd>
                      </DropdownMenuItem>

                      <DropdownMenuSeparator />

                      <DropdownMenuItem
                        onClick={() => {
                          setFocusedItemId(item.id);
                          setDeleteConfirmOpen(true);
                        }}
                        className="text-destructive focus:text-destructive flex items-center justify-between"
                      >
                        <div className="flex items-center">
                          <Trash2 className="mr-2 size-3.5" />
                          <span>Delete</span>
                        </div>
                        <kbd className="text-[9px] font-mono text-muted-foreground">
                          {isMac ? "⌦" : "Del"}
                        </kbd>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
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
