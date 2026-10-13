"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import { type FolderNode, descendantIds, findNode, getAncestorIds } from "./tree";

const STORAGE_KEY = "sourcefold:open-folders";

type VisibleRow = {
  node: FolderNode;
  level: number;
};

function flattenVisibleTree(
  nodes: FolderNode[],
  isExpanded: (id: string) => boolean,
  level = 1,
): VisibleRow[] {
  const result: VisibleRow[] = [];
  for (const node of nodes) {
    result.push({ node, level });
    if (node.children.length > 0 && isExpanded(node.id)) {
      result.push(...flattenVisibleTree(node.children, isExpanded, level + 1));
    }
  }
  return result;
}

function TopLevelDropZone() {
  const { setNodeRef, isOver } = useDroppable({
    id: "top-level",
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "mx-2 mb-2 flex h-8 items-center justify-center rounded border border-dashed text-xs font-medium transition-colors",
        isOver
          ? "border-primary bg-accent text-accent-foreground ring-1 ring-primary"
          : "border-border text-muted-foreground bg-background/50",
      )}
    >
      Move to top level
    </div>
  );
}

function InlineInputRow({
  level,
  initialValue = "",
  placeholder = "Folder name",
  onSave,
  onCancel,
}: {
  level: number;
  initialValue?: string;
  placeholder?: string;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        onSave(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      onCancel();
    }
  };

  return (
    <div
      className="flex h-8 items-center gap-1.5 px-2 bg-muted/40"
      style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
    >
      <span className="size-4 shrink-0" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={200}
        className="h-6 w-full min-w-0 rounded border border-input bg-background px-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

export function FolderTree({ tree }: { tree: FolderNode[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedFolderId = searchParams.get("folder");

  // Load initial open state from localStorage
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch {
      // Ignore parse failure
    }
    return new Set<string>();
  });

  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Drag-and-drop state
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Mutation inline states
  const [isCreatingRoot, setIsCreatingRoot] = useState(false);
  const [creatingSubfolderParentId, setCreatingSubfolderParentId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderNode | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Sensors for dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  // Selected folder ancestors are automatically opened
  const selectedAncestors = useMemo(() => {
    if (!selectedFolderId) return [];
    return getAncestorIds(tree, selectedFolderId);
  }, [tree, selectedFolderId]);

  const isFolderExpanded = useCallback(
    (folderId: string) => {
      return openFolders.has(folderId) || selectedAncestors.includes(folderId);
    },
    [openFolders, selectedAncestors],
  );

  // Persist open folders to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(openFolders)));
    } catch {
      // Ignore write failure
    }
  }, [openFolders]);

  const toggleFolder = useCallback(
    (folderId: string, open?: boolean) => {
      setOpenFolders((prev) => {
        const next = new Set(prev);
        // Include any active ancestors so they don't abruptly close
        for (const ancestorId of selectedAncestors) {
          next.add(ancestorId);
        }
        const currentlyOpen = next.has(folderId);
        const shouldOpen = open !== undefined ? open : !currentlyOpen;
        if (shouldOpen) {
          next.add(folderId);
        } else {
          next.delete(folderId);
        }
        return next;
      });
    },
    [selectedAncestors],
  );

  // Flatten visible rows for arrow navigation and roving tabIndex
  const visibleRows = useMemo(
    () => flattenVisibleTree(tree, isFolderExpanded),
    [tree, isFolderExpanded],
  );

  // Derived effective focused ID for roving tabIndex
  const effectiveFocusedId = useMemo(() => {
    if (visibleRows.length === 0) return null;
    if (focusedId && visibleRows.some((r) => r.node.id === focusedId)) {
      return focusedId;
    }
    if (selectedFolderId && visibleRows.some((r) => r.node.id === selectedFolderId)) {
      return selectedFolderId;
    }
    return visibleRows[0]?.node.id ?? null;
  }, [visibleRows, focusedId, selectedFolderId]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentNode: FolderNode) => {
      if (renamingFolderId) return;

      const currentIndex = visibleRows.findIndex((r) => r.node.id === currentNode.id);
      if (currentIndex === -1) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (currentIndex < visibleRows.length - 1) {
            const nextNode = visibleRows[currentIndex + 1].node;
            setFocusedId(nextNode.id);
            rowRefs.current.get(nextNode.id)?.focus();
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (currentIndex > 0) {
            const prevNode = visibleRows[currentIndex - 1].node;
            setFocusedId(prevNode.id);
            rowRefs.current.get(prevNode.id)?.focus();
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (currentNode.children.length > 0) {
            if (!isFolderExpanded(currentNode.id)) {
              toggleFolder(currentNode.id, true);
            } else {
              const firstChild = currentNode.children[0];
              setFocusedId(firstChild.id);
              rowRefs.current.get(firstChild.id)?.focus();
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (currentNode.children.length > 0 && isFolderExpanded(currentNode.id)) {
            toggleFolder(currentNode.id, false);
          } else if (currentNode.parentId) {
            setFocusedId(currentNode.parentId);
            rowRefs.current.get(currentNode.parentId)?.focus();
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          router.push(`/?folder=${currentNode.id}`);
          break;
        }
      }
    },
    [visibleRows, isFolderExpanded, renamingFolderId, toggleFolder, router],
  );

  // Mutations
  const handleCreateFolder = async (name: string, parentId: string | null) => {
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to create folder");
        return;
      }
      toast("Folder created");
      if (parentId) {
        toggleFolder(parentId, true);
      }
      router.refresh();
    } catch {
      toast.error("Failed to create folder");
    } finally {
      setIsCreatingRoot(false);
      setCreatingSubfolderParentId(null);
    }
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to rename folder");
        return;
      }
      toast("Folder renamed");
      router.refresh();
    } catch {
      toast.error("Failed to rename folder");
    } finally {
      setRenamingFolderId(null);
    }
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: parentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to move folder");
        return;
      }
      toast("Folder moved");
      if (parentId) {
        toggleFolder(parentId, true);
      }
      router.refresh();
    } catch {
      toast.error("Failed to move folder");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingFolder) return;
    const folder = deletingFolder;
    try {
      const res = await fetch(`/api/folders/${folder.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to delete folder");
        return;
      }
      toast("Folder deleted");
      const isSelectedDeleted =
        selectedFolderId === folder.id ||
        descendantIds(tree, folder.id).includes(selectedFolderId ?? "");
      if (isSelectedDeleted) {
        router.push("/");
      }
      router.refresh();
    } catch {
      toast.error("Failed to delete folder");
    } finally {
      setDeletingFolder(null);
    }
  };

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (overId === "top-level") {
      const activeNode = findNode(tree, activeId);
      if (activeNode && activeNode.parentId !== null) {
        await handleMoveFolder(activeId, null);
      }
      return;
    }

    if (activeId === overId) return;

    const descendants = descendantIds(tree, activeId);
    if (descendants.includes(overId)) return;

    const activeNode = findNode(tree, activeId);
    if (activeNode && activeNode.parentId === overId) return;

    await handleMoveFolder(activeId, overId);
  };

  const activeDragNode = useMemo(
    () => (activeDragId ? findNode(tree, activeDragId) : null),
    [activeDragId, tree],
  );

  const blockedDropIds = useMemo(() => {
    if (!activeDragId) return new Set<string>();
    const set = new Set(descendantIds(tree, activeDragId));
    set.add(activeDragId);
    return set;
  }, [activeDragId, tree]);

  // Recursive tree renderer
  const renderTreeNodes = (nodes: FolderNode[], level = 1): React.ReactNode => {
    return nodes.map((node) => {
      const isExpanded = isFolderExpanded(node.id);
      const isSelected = selectedFolderId === node.id;
      const isFocused = effectiveFocusedId === node.id;
      const hasChildren = node.children.length > 0;
      const isRenaming = renamingFolderId === node.id;
      const isSubfolderCreating = creatingSubfolderParentId === node.id;

      return (
        <FolderRowItem
          key={node.id}
          node={node}
          level={level}
          isExpanded={isExpanded}
          isSelected={isSelected}
          isFocused={isFocused}
          hasChildren={hasChildren}
          isRenaming={isRenaming}
          isDropDisabled={blockedDropIds.has(node.id)}
          onToggle={() => toggleFolder(node.id)}
          onSelect={() => {
            setFocusedId(node.id);
            router.push(`/?folder=${node.id}`);
          }}
          onKeyDown={(e) => handleKeyDown(e, node)}
          onStartRename={() => setRenamingFolderId(node.id)}
          onSaveRename={(newName) => handleRenameFolder(node.id, newName)}
          onCancelRename={() => setRenamingFolderId(null)}
          onStartCreateSubfolder={() => {
            toggleFolder(node.id, true);
            setCreatingSubfolderParentId(node.id);
          }}
          onMoveToTopLevel={() => handleMoveFolder(node.id, null)}
          onDelete={() => setDeletingFolder(node)}
          setRowRef={(el) => {
            if (el) rowRefs.current.set(node.id, el);
            else rowRefs.current.delete(node.id);
          }}
        >
          {isExpanded && (
            <div>
              {renderTreeNodes(node.children, level + 1)}
              {isSubfolderCreating && (
                <InlineInputRow
                  level={level + 1}
                  placeholder="Subfolder name"
                  onSave={(name) => handleCreateFolder(name, node.id)}
                  onCancel={() => setCreatingSubfolderParentId(null)}
                />
              )}
            </div>
          )}
        </FolderRowItem>
      );
    });
  };

  const isEmpty = tree.length === 0 && !isCreatingRoot;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col w-full h-full">
        {/* Drop zone for top-level move while dragging */}
        {activeDragId !== null && <TopLevelDropZone />}

        {/* Tree Container */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center p-4 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Create your first folder to start collecting sources.
            </p>
            <Button variant="outline" size="sm" onClick={() => setIsCreatingRoot(true)}>
              <Plus className="size-4" />
              New folder
            </Button>
          </div>
        ) : (
          <div
            role="tree"
            aria-label="Folders"
            className="flex-1 overflow-y-auto select-none outline-none"
          >
            {renderTreeNodes(tree, 1)}

            {isCreatingRoot && (
              <InlineInputRow
                level={1}
                placeholder="Folder name"
                onSave={(name) => handleCreateFolder(name, null)}
                onCancel={() => setIsCreatingRoot(false)}
              />
            )}

            {!isCreatingRoot && (
              <button
                type="button"
                onClick={() => setIsCreatingRoot(true)}
                className="flex h-8 w-full items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-4 shrink-0" />
                <span>New folder</span>
              </button>
            )}
          </div>
        )}

        {/* Drag Overlay */}
        <DragOverlay>
          {activeDragNode ? (
            <div className="flex h-8 items-center gap-2 rounded border border-border bg-popover px-3 text-sm font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <span className="truncate">{activeDragNode.name}</span>
            </div>
          ) : null}
        </DragOverlay>

        {/* Delete Confirmation Alert Dialog */}
        <AlertDialog
          open={deletingFolder !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingFolder(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{deletingFolder?.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the folder, its subfolders and every source in them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setDeletingFolder(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleConfirmDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DndContext>
  );
}

function FolderRowItem({
  node,
  level,
  isExpanded,
  isSelected,
  isFocused,
  hasChildren,
  isRenaming,
  isDropDisabled,
  onToggle,
  onSelect,
  onKeyDown,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onStartCreateSubfolder,
  onMoveToTopLevel,
  onDelete,
  setRowRef,
  children,
}: {
  node: FolderNode;
  level: number;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  hasChildren: boolean;
  isRenaming: boolean;
  isDropDisabled: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onStartRename: () => void;
  onSaveRename: (name: string) => void;
  onCancelRename: () => void;
  onStartCreateSubfolder: () => void;
  onMoveToTopLevel: () => void;
  onDelete: () => void;
  setRowRef: (el: HTMLDivElement | null) => void;
  children?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: node.id,
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.id,
    disabled: isDropDisabled,
  });

  const { role: _role, tabIndex: _tabIndex, ...draggableAttributes } = attributes;
  void _role;
  void _tabIndex;

  const combinedRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
    setRowRef(el);
  };

  return (
    <div>
      {isRenaming ? (
        <InlineInputRow
          level={level}
          initialValue={node.name}
          onSave={onSaveRename}
          onCancel={onCancelRename}
        />
      ) : (
        <div
          ref={combinedRef}
          role="treeitem"
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-selected={isSelected}
          aria-level={level}
          tabIndex={isFocused ? 0 : -1}
          onClick={onSelect}
          onKeyDown={onKeyDown}
          {...draggableAttributes}
          {...listeners}
          style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
          className={cn(
            "group/row relative flex h-8 items-center gap-1.5 pr-2 rounded-none cursor-pointer outline-none transition-colors",
            isSelected
              ? "bg-accent text-accent-foreground font-medium"
              : "text-foreground hover:bg-muted",
            isOver && "ring-2 ring-primary bg-accent/60",
            isDragging && "opacity-40",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          {/* Chevron */}
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex size-4 items-center justify-center p-0 text-muted-foreground hover:text-foreground outline-none"
              aria-hidden="true"
            >
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 transition-transform duration-120 motion-safe:transition-transform motion-safe:duration-120",
                  isExpanded && "rotate-90",
                )}
              />
            </button>
          ) : (
            <span className="size-4 shrink-0" aria-hidden="true" />
          )}

          {/* Folder Name */}
          <span className="truncate flex-1 text-sm">{node.name}</span>

          {/* Item Count */}
          <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">
            {node.itemCount}
          </span>

          {/* Row Action Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              type="button"
              tabIndex={-1}
              aria-label="Folder actions"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus:opacity-100 flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-opacity outline-none"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCreateSubfolder();
                }}
              >
                New subfolder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRename();
                }}
              >
                Rename
              </DropdownMenuItem>
              {node.parentId !== null && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveToTopLevel();
                  }}
                >
                  Move to top level
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Render children / inline input */}
      {children}
    </div>
  );
}
