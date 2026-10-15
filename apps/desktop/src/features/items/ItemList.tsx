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
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { Folder, Item } from "@/lib/types";
import { deleteItem, moveItem, renameItem } from "@/lib/api";
import { openUrl, cn } from "@/lib/utils";
import { NoteDialog } from "./NoteDialog";
import { MoveItemDialog } from "./MoveItemDialog";
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
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const listContainerRef = React.useRef<HTMLDivElement>(null);

  // Keep focused row valid when items change
  React.useEffect(() => {
    if (items.length === 0) {
      setFocusedItemId(null);
    } else if (!items.some((i) => i.id === focusedItemId)) {
      setFocusedItemId(items[0].id);
    }
  }, [items, focusedItemId, setFocusedItemId]);

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

  const handleOpenSource = React.useCallback(
    (item: Item, options?: { forceExternal?: boolean }) => {
      if (!options?.forceExternal && item.markdown && item.markdown.trim() && onOpenReader) {
        onOpenReader(item);
      } else {
        const url = item.source_url || item.canonical_url;
        if (url) {
          openUrl(url);
        } else if (onOpenReader) {
          onOpenReader(item);
        }
      }
    },
    [onOpenReader],
  );

  const handleCopyLinks = React.useCallback(
    async (itemsToCopy?: Item[]) => {
      const targets =
        itemsToCopy && itemsToCopy.length > 0
          ? itemsToCopy
          : selectedIds.size > 0
            ? items.filter((i) => selectedIds.has(i.id))
            : focusedItem
              ? [focusedItem]
              : [];

      const urls = targets
        .map((i) => i.source_url || i.canonical_url)
        .filter((url): url is string => Boolean(url));

      if (urls.length === 0) {
        toast.info("No URLs found to copy");
        return;
      }

      try {
        await navigator.clipboard.writeText(urls.join("\n"));
        toast.success(urls.length === 1 ? "Link copied" : `${urls.length} links copied`);
      } catch {
        toast.error("Failed to copy links");
      }
    },
    [focusedItem, items, selectedIds],
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
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(focusedItem.id)) next.delete(focusedItem.id);
            else next.add(focusedItem.id);
            return next;
          });
        }
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

      // Esc: clear selection
      if (e.key === "Escape" && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
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
        if (focusedItem || selectedIds.size > 0) {
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
        if (focusedItem || selectedIds.size > 0) {
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
    selectedIds,
    handleOpenSource,
    handleCopyLinks,
    extendSelectionTo,
    setFocusedItemId,
  ]);

  const handleDeleteConfirmed = async () => {
    setIsDeleting(true);
    const idsToDelete =
      selectedIds.size > 0 ? Array.from(selectedIds) : focusedItem ? [focusedItem.id] : [];

    try {
      await Promise.all(idsToDelete.map((id) => deleteItem(id)));
      toast.success(
        idsToDelete.length === 1 ? "Source deleted" : `${idsToDelete.length} sources deleted`,
      );
      setSelectedIds(new Set());
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

  return (
    <div
      ref={listContainerRef}
      className={cn(
        "flex flex-col flex-1 min-h-0 select-none rounded-[6px] transition-colors",
        isFocusedRegion && "ring-1 ring-primary/40",
      )}
    >
      {/* Batch toolbar when items are selected */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{selectedIds.size} selected</span>
            <span className="text-[11px] text-muted-foreground">(Esc to clear)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleCopyLinks()}
              title="Copy links (y / Mod+C)"
            >
              <Copy className="mr-1.5 size-3" />
              <span>Copy links</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setMoveOpen(true)}
              title="Move to group (m)"
            >
              <FolderIcon className="mr-1.5 size-3" />
              <span>Move</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setDeleteConfirmOpen(true)}
              title="Delete (Delete)"
            >
              <Trash2 className="mr-1.5 size-3" />
              <span>Delete</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="size-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Item rows */}
      <div className="divide-y divide-border overflow-y-auto flex-1">
        {items.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            No sources in this group. Press <kbd className="font-semibold text-foreground">a</kbd>{" "}
            to add links.
          </div>
        ) : (
          items.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isFocusedRow = item.id === focusedItemId;
            const hasNote = Boolean(item.note && item.note.trim());
            const hasMarkdown = Boolean(item.markdown && item.markdown.trim());
            const displayUrl = item.source_url || item.canonical_url;

            return (
              <div
                key={item.id}
                data-item-id={item.id}
                onClick={() => {
                  setFocusedItemId(item.id);
                  handleOpenSource(item);
                }}
                className={cn(
                  "group relative flex items-start gap-3 p-3 transition-colors cursor-pointer",
                  isSelected ? "bg-accent/40" : "hover:bg-muted/40",
                  isFocusedRow && isFocusedRegion && "ring-2 ring-primary ring-inset",
                  isFocusedRow && !isFocusedRegion && "border-l-2 border-primary/50",
                )}
              >
                {/* Selection Checkbox */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedItemId(item.id);
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
                  }}
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-input bg-background transition-colors hover:border-ring cursor-pointer"
                >
                  {isSelected && <Check className="size-3 text-primary font-bold" />}
                </button>

                {/* Main Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {hasMarkdown && (
                        <span
                          title="Reader available (Enter to view)"
                          className="inline-flex items-center"
                        >
                          <BookOpen className="size-3.5 shrink-0 text-primary" />
                        </span>
                      )}
                      <h4 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {item.title}
                      </h4>
                    </div>
                    <span className="text-[11px] text-muted-foreground shrink-0 uppercase tracking-wider font-mono">
                      {item.kind}
                    </span>
                  </div>

                  {displayUrl && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{displayUrl}</p>
                  )}

                  {hasNote && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-[4px] bg-muted/60 p-2 text-xs text-muted-foreground">
                      <MessageSquare className="size-3.5 shrink-0 mt-0.5" />
                      <p className="line-clamp-2 italic">{item.note}</p>
                    </div>
                  )}
                </div>

                {/* Row actions */}
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setFocusedItemId(item.id);
                      setNoteItem(item);
                    }}
                    aria-label="Add or edit note"
                    className="flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    title="Note (n)"
                  >
                    <MessageSquare className="size-3.5" />
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Item menu"
                        className="flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
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
                          <span>Open in browser</span>
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
        item={focusedItem}
        folders={folders}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={async () => {
          setSelectedIds(new Set());
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
              {selectedIds.size > 1 ? `Delete ${selectedIds.size} sources` : "Delete source"}
            </DialogTitle>
            <DialogDescription>
              {selectedIds.size > 1
                ? `Are you sure you want to delete these ${selectedIds.size} sources? This action cannot be undone.`
                : `Are you sure you want to delete "${focusedItem?.title || "this source"}"?`}
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
