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
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { type FolderNode, descendantIds, findNode, getAncestorIds } from "./tree";
import { getSiblings, moveFolderInside, removeNodeFromTree, reorderTreeNodes } from "./reorder";

const STORAGE_KEY = "sourcefold:open-folders";

type VisibleRow = {
  node: FolderNode;
  level: number;
};

type DropZone = "before" | "inside" | "after";

type DropTarget = {
  folderId: string;
  zone: DropZone;
} | null;

/**
 * Three drop zones are calculated over each 32px row by pointer position:
 * - Top quarter (< 25% height): "before" (2px line above the row, indented to that level)
 * - Bottom quarter (> 75% height): "after" (2px line below the row, indented to that level)
 * - Middle half (25% - 75% height): "inside" (existing re-parent highlight)
 *
 * The current viewport pointer Y is computed from event.activatorEvent (clientY) + delta.y,
 * then measured against the target row's bounding client rect.
 */
function calculateDropZone(
  activatorEvent: Event | null,
  deltaY: number,
  rowRect: { top: number; height: number } | null | undefined,
): DropZone {
  if (!rowRect) return "inside";

  let clientY: number | null = null;
  if (
    activatorEvent &&
    "clientY" in activatorEvent &&
    typeof (activatorEvent as MouseEvent).clientY === "number"
  ) {
    clientY = (activatorEvent as MouseEvent).clientY + deltaY;
  } else if (
    activatorEvent &&
    "touches" in activatorEvent &&
    (activatorEvent as TouchEvent).touches &&
    (activatorEvent as TouchEvent).touches.length > 0
  ) {
    clientY = (activatorEvent as TouchEvent).touches[0].clientY + deltaY;
  }

  if (clientY === null) return "inside";

  const relY = clientY - rowRect.top;
  const height = rowRect.height || 32;
  const ratio = relY / height;

  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

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
  placeholder = "Group name",
  disabled = false,
  onSave,
  onCancel,
}: {
  level: number;
  initialValue?: string;
  placeholder?: string;
  disabled?: boolean;
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
    if (disabled) return;
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
    if (disabled) return;
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
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        maxLength={200}
        className="h-6 w-full min-w-0 rounded border border-input bg-background px-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      />
    </div>
  );
}

export type ProjectOption = { id: string; name: string };

/**
 * The groups of one project. `tree` holds the project's groups with a null parentId at the
 * top level; requests map that null back to `projectId`.
 */
export function FolderTree({
  tree,
  projectId,
  otherProjects,
}: {
  tree: FolderNode[];
  projectId: string;
  otherProjects: ProjectOption[];
}) {
  const router = useRouter();
  const toServerParent = useCallback(
    (parentId: string | null) => parentId ?? projectId,
    [projectId],
  );
  const searchParams = useSearchParams();
  const selectedFolderId = searchParams.get("folder");

  // Optimistic tree state (cleared when prop `tree` updates)
  const [prevTree, setPrevTree] = useState(tree);
  const [optimisticTree, setOptimisticTree] = useState<FolderNode[] | null>(null);

  if (prevTree !== tree) {
    setPrevTree(tree);
    setOptimisticTree(null);
  }

  const localTree = optimisticTree ?? tree;

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
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  // Mutation inline states
  const [isCreatingRoot, setIsCreatingRoot] = useState(false);
  const [creatingSubfolderParentId, setCreatingSubfolderParentId] = useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderNode | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isSavingRef = useRef(false);

  // In-flight guard refs and state
  const isCreatingFolderRef = useRef(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const isDeletingFolderRef = useRef(false);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

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
    return getAncestorIds(localTree, selectedFolderId);
  }, [localTree, selectedFolderId]);

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
    () => flattenVisibleTree(localTree, isFolderExpanded),
    [localTree, isFolderExpanded],
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

  const activeDragNode = useMemo(
    () => (activeDragId ? findNode(localTree, activeDragId) : null),
    [activeDragId, localTree],
  );

  const blockedDropIds = useMemo(() => {
    if (!activeDragId) return new Set<string>();
    const set = new Set(descendantIds(localTree, activeDragId));
    set.add(activeDragId);
    return set;
  }, [activeDragId, localTree]);

  const getRowRect = useCallback(
    (folderId: string, fallbackRect?: { top: number; height: number } | null) => {
      const el = rowRefs.current.get(folderId);
      if (el) {
        const r = el.getBoundingClientRect();
        return { top: r.top, height: r.height };
      }
      if (fallbackRect) {
        return { top: fallbackRect.top, height: fallbackRect.height };
      }
      return null;
    },
    [],
  );

  // Reorder persistence with optimistic UI
  const handleReorder = useCallback(
    async (activeId: string, targetId: string, zone: "before" | "after") => {
      const result = reorderTreeNodes(localTree, activeId, targetId, zone);
      if (!result || result.updates.length === 0) return;

      // Optimistic UI update
      setOptimisticTree(result.newTree);
      if (result.targetParentId !== null) {
        toggleFolder(result.targetParentId, true);
      }

      try {
        isSavingRef.current = true;
        await Promise.all(
          result.updates.map(async (update) => {
            const res = await fetch(`/api/folders/${update.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                update.body.parent_id !== undefined
                  ? { ...update.body, parent_id: toServerParent(update.body.parent_id) }
                  : update.body,
              ),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(json.error?.message ?? "Couldn't reorder groups. Try again.");
            }
          }),
        );
        router.refresh();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Couldn't reorder groups. Try again.";
        toast.error(message);
        setOptimisticTree(null);
        router.refresh();
      } finally {
        isSavingRef.current = false;
      }
    },
    [localTree, router, toggleFolder, toServerParent],
  );

  // Keyboard reorder handler for Alt+ArrowUp / Alt+ArrowDown
  const handleKeyboardReorder = useCallback(
    async (currentNode: FolderNode, direction: "up" | "down") => {
      if (isSavingRef.current) return;

      const siblings = getSiblings(localTree, currentNode.parentId);
      const index = siblings.findIndex((s) => s.id === currentNode.id);
      if (index === -1) return;

      if (direction === "up" && index === 0) return;
      if (direction === "down" && index === siblings.length - 1) return;

      const targetIndex = direction === "up" ? index - 1 : index + 1;
      const targetNode = siblings[targetIndex];
      if (!targetNode) return;

      const zone = direction === "up" ? "before" : "after";
      await handleReorder(currentNode.id, targetNode.id, zone);

      setFocusedId(currentNode.id);
      requestAnimationFrame(() => {
        rowRefs.current.get(currentNode.id)?.focus();
      });
    },
    [handleReorder, localTree],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentNode: FolderNode) => {
      if (renamingFolderId) return;

      // Alt+ArrowUp / Alt+ArrowDown moves the folder among its siblings
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.key === "ArrowUp" ? "up" : "down";
        void handleKeyboardReorder(currentNode, direction);
        return;
      }

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
    [renamingFolderId, handleKeyboardReorder, visibleRows, isFolderExpanded, toggleFolder, router],
  );

  // Mutations
  const handleCreateFolder = useCallback(
    async (name: string, parentId: string | null) => {
      if (isCreatingFolderRef.current) return;
      isCreatingFolderRef.current = true;
      setIsCreatingFolder(true);

      try {
        const res = await fetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, parent_id: toServerParent(parentId) }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't create the group. Try again.");
          return;
        }
        toast("Group created");
        if (parentId) {
          toggleFolder(parentId, true);
        }
        router.refresh();
      } catch {
        toast.error("Couldn't create the group. Try again.");
      } finally {
        isCreatingFolderRef.current = false;
        setIsCreatingFolder(false);
        setIsCreatingRoot(false);
        setCreatingSubfolderParentId(null);
      }
    },
    [router, toggleFolder, toServerParent],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      try {
        const res = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't rename the group. Try again.");
          return;
        }
        toast("Group renamed");
        router.refresh();
      } catch {
        toast.error("Couldn't rename the group. Try again.");
      } finally {
        setRenamingFolderId(null);
      }
    },
    [router],
  );

  const handleMoveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      // Optimistic UI for move inside / move to top level
      const activeNode = findNode(localTree, folderId);
      if (activeNode) {
        const optimistic = moveFolderInside(localTree, folderId, parentId);
        setOptimisticTree(optimistic);
        if (parentId) {
          toggleFolder(parentId, true);
        }
      }

      try {
        const res = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent_id: toServerParent(parentId) }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't move the group. Try again.");
          setOptimisticTree(null);
          router.refresh();
          return;
        }
        toast("Group moved");
        if (parentId) {
          toggleFolder(parentId, true);
        }
        router.refresh();
      } catch {
        toast.error("Couldn't move the group. Try again.");
        setOptimisticTree(null);
        router.refresh();
      }
    },
    [localTree, router, toggleFolder, toServerParent],
  );

  const handleMoveToProject = useCallback(
    async (folderId: string, target: ProjectOption) => {
      setOptimisticTree(removeNodeFromTree(localTree, folderId));
      try {
        const res = await fetch(`/api/folders/${folderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent_id: target.id }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't move the group. Try again.");
          setOptimisticTree(null);
          return;
        }
        toast(`Moved to ${target.name}`);
        const movedSelected =
          selectedFolderId === folderId ||
          descendantIds(localTree, folderId).includes(selectedFolderId ?? "");
        if (movedSelected) {
          router.push(`/?folder=${projectId}`);
        }
        router.refresh();
      } catch {
        toast.error("Couldn't move the group. Try again.");
        setOptimisticTree(null);
      }
    },
    [localTree, projectId, router, selectedFolderId],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (isDeletingFolderRef.current || !deletingFolder) return;
    isDeletingFolderRef.current = true;
    setIsDeletingFolder(true);

    const folder = deletingFolder;
    try {
      const res = await fetch(`/api/folders/${folder.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't delete the group. Try again.");
        return;
      }
      toast("Group deleted");
      const isSelectedDeleted =
        selectedFolderId === folder.id ||
        descendantIds(localTree, folder.id).includes(selectedFolderId ?? "");
      if (isSelectedDeleted) {
        router.push(`/?folder=${projectId}`);
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Couldn't delete the group. Try again.");
    } finally {
      isDeletingFolderRef.current = false;
      setIsDeletingFolder(false);
      setDeletingFolder(null);
    }
  }, [deletingFolder, localTree, projectId, router, selectedFolderId]);

  // Stable callbacks for FolderRowItem
  const handleToggle = useCallback(
    (id: string) => {
      toggleFolder(id);
    },
    [toggleFolder],
  );

  const handleSelect = useCallback(
    (id: string) => {
      setFocusedId(id);
      router.push(`/?folder=${id}`);
    },
    [router],
  );

  const handleStartRename = useCallback((id: string) => {
    setRenamingFolderId(id);
  }, []);

  const handleSaveRename = useCallback(
    (id: string, newName: string) => {
      void handleRenameFolder(id, newName);
    },
    [handleRenameFolder],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingFolderId(null);
  }, []);

  const handleStartCreateSubfolder = useCallback(
    (id: string) => {
      toggleFolder(id, true);
      setCreatingSubfolderParentId(id);
    },
    [toggleFolder],
  );

  const handleMoveToTopLevel = useCallback(
    (id: string) => {
      void handleMoveFolder(id, null);
    },
    [handleMoveFolder],
  );

  const handleDelete = useCallback((node: FolderNode) => {
    setDeletingFolder(node);
  }, []);

  const handleSetRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // DnD Handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    setDropTarget(null);
  };

  const updateDropTarget = useCallback(
    (event: DragMoveEvent | DragOverEvent) => {
      const { active, over } = event;
      if (!over || !active) {
        setDropTarget(null);
        return;
      }

      const activeId = String(active.id);
      const overId = String(over.id);

      if (overId === "top-level" || overId === activeId || blockedDropIds.has(overId)) {
        setDropTarget(null);
        return;
      }

      const rect = getRowRect(overId, over.rect);
      const zone = calculateDropZone(event.activatorEvent, event.delta.y, rect);

      setDropTarget((prev) => {
        if (prev && prev.folderId === overId && prev.zone === zone) {
          return prev;
        }
        return { folderId: overId, zone };
      });
    },
    [blockedDropIds, getRowRect],
  );

  const handleDragMove = (event: DragMoveEvent) => {
    updateDropTarget(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    updateDropTarget(event);
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setDropTarget(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    const currentDropTarget = dropTarget;
    setActiveDragId(null);
    setDropTarget(null);

    if (!over || !active) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    if (overId === "top-level") {
      const activeNode = findNode(localTree, activeId);
      if (activeNode && activeNode.parentId !== null) {
        await handleMoveFolder(activeId, null);
      }
      return;
    }

    // Dropping onto itself or into its own descendant does nothing
    if (activeId === overId || blockedDropIds.has(overId)) return;

    const rect = getRowRect(overId, over.rect);
    const zone: DropZone =
      currentDropTarget && currentDropTarget.folderId === overId
        ? currentDropTarget.zone
        : calculateDropZone(event.activatorEvent, event.delta.y, rect);

    if (zone === "inside") {
      const activeNode = findNode(localTree, activeId);
      if (activeNode && activeNode.parentId === overId) return;
      await handleMoveFolder(activeId, overId);
      return;
    }

    // "before" or "after" sibling reordering
    await handleReorder(activeId, overId, zone);
  };

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  // Recursive tree renderer
  const renderTreeNodes = (nodes: FolderNode[], level = 1): React.ReactNode => {
    return nodes.map((node) => {
      const isExpanded = isFolderExpanded(node.id);
      const isSelected = selectedFolderId === node.id;
      const isFocused = effectiveFocusedId === node.id;
      const hasChildren = node.children.length > 0;
      const isRenaming = renamingFolderId === node.id;
      const isSubfolderCreating = creatingSubfolderParentId === node.id;
      const rowDropZone = dropTarget?.folderId === node.id ? dropTarget.zone : null;

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
          dropZone={rowDropZone}
          onToggle={handleToggle}
          onSelect={handleSelect}
          onKeyDown={handleKeyDown}
          onStartRename={handleStartRename}
          onSaveRename={handleSaveRename}
          onCancelRename={handleCancelRename}
          onStartCreateSubfolder={handleStartCreateSubfolder}
          onMoveToTopLevel={handleMoveToTopLevel}
          onDelete={handleDelete}
          otherProjects={otherProjects}
          onMoveToProject={handleMoveToProject}
          setRowRef={handleSetRowRef}
        >
          {isExpanded && (
            <div>
              {renderTreeNodes(node.children, level + 1)}
              {isSubfolderCreating && (
                <InlineInputRow
                  level={level + 1}
                  placeholder="Subgroup name"
                  disabled={isCreatingFolder}
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

  const isEmpty = localTree.length === 0 && !isCreatingRoot;

  return (
    <DndContext
      id={`groups-${projectId}`}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col w-full h-full">
        {/* Drop zone for top-level move while dragging */}
        {activeDragId !== null && <TopLevelDropZone />}

        {/* Tree Container */}
        <div
          role="tree"
          aria-label="Groups"
          className="flex-1 overflow-y-auto select-none outline-none"
        >
          {isEmpty && (
            <p className="px-2 py-1.5 text-[13px] text-muted-foreground">No groups yet.</p>
          )}
          {renderTreeNodes(localTree, 1)}

          {isCreatingRoot && (
            <InlineInputRow
              level={1}
              placeholder="Group name"
              disabled={isCreatingFolder}
              onSave={(name) => handleCreateFolder(name, null)}
              onCancel={() => setIsCreatingRoot(false)}
            />
          )}

          {!isCreatingRoot && (
            <button
              type="button"
              disabled={isCreatingFolder}
              onClick={() => setIsCreatingRoot(true)}
              className="flex h-8 w-full items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Plus className="size-4 shrink-0" />
              <span>New group</span>
            </button>
          )}
        </div>

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
            if (!open && !isDeletingFolder) setDeletingFolder(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{deletingFolder?.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes the group, its subgroups and every source in them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setDeletingFolder(null)}
                disabled={isDeletingFolder}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={isDeletingFolder}
              >
                {isDeletingFolder ? "Deleting\u2026" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DndContext>
  );
}

type FolderRowItemProps = {
  node: FolderNode;
  level: number;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  hasChildren: boolean;
  isRenaming: boolean;
  isDropDisabled: boolean;
  dropZone: DropZone | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, node: FolderNode) => void;
  onStartRename: (id: string) => void;
  onSaveRename: (id: string, name: string) => void;
  onCancelRename: () => void;
  onStartCreateSubfolder: (id: string) => void;
  onMoveToTopLevel: (id: string) => void;
  onDelete: (node: FolderNode) => void;
  otherProjects: ProjectOption[];
  onMoveToProject: (id: string, target: ProjectOption) => void;
  setRowRef: (id: string, el: HTMLDivElement | null) => void;
  children?: React.ReactNode;
};

const FolderRowItem = React.memo(function FolderRowItem({
  node,
  level,
  isExpanded,
  isSelected,
  isFocused,
  hasChildren,
  isRenaming,
  isDropDisabled,
  dropZone,
  onToggle,
  onSelect,
  onKeyDown,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onStartCreateSubfolder,
  onMoveToTopLevel,
  onDelete,
  otherProjects,
  onMoveToProject,
  setRowRef,
  children,
}: FolderRowItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: node.id,
    disabled: isRenaming,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: node.id,
    disabled: isDropDisabled,
  });

  const { role: _role, tabIndex: _tabIndex, ...draggableAttributes } = attributes;
  void _role;
  void _tabIndex;

  const combinedRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
    setRowRef(node.id, el);
  };

  return (
    <div>
      {isRenaming ? (
        <InlineInputRow
          level={level}
          initialValue={node.name}
          onSave={(newName) => onSaveRename(node.id, newName)}
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
          onClick={() => onSelect(node.id)}
          onKeyDown={(e) => onKeyDown(e, node)}
          {...draggableAttributes}
          {...listeners}
          style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
          className={cn(
            "group/row relative flex h-8 items-center gap-1.5 pr-2 rounded-none cursor-pointer outline-none transition-colors",
            isSelected
              ? "bg-accent text-accent-foreground font-medium"
              : "text-foreground hover:bg-muted",
            dropZone === "inside" && "ring-2 ring-primary bg-accent/60",
            isDragging && "opacity-40",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          {/* Drop indicator lines */}
          {dropZone === "before" && (
            <div
              className="absolute top-0 right-0 h-[2px] bg-primary z-10 pointer-events-none motion-safe:transition-all"
              style={{ left: `${(level - 1) * 16 + 8}px` }}
              aria-hidden="true"
            />
          )}
          {dropZone === "after" && (
            <div
              className="absolute bottom-0 right-0 h-[2px] bg-primary z-10 pointer-events-none motion-safe:transition-all"
              style={{ left: `${(level - 1) * 16 + 8}px` }}
              aria-hidden="true"
            />
          )}

          {/* Chevron */}
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.id);
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
              aria-label="Group actions"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus:opacity-100 flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-opacity outline-none"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onStartCreateSubfolder(node.id);
                }}
              >
                New subgroup
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRename(node.id);
                }}
              >
                Rename
              </DropdownMenuItem>
              {node.parentId !== null && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onMoveToTopLevel(node.id);
                  }}
                >
                  Move to top level
                </DropdownMenuItem>
              )}
              {otherProjects.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to project</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-44">
                    {otherProjects.map((project) => (
                      <DropdownMenuItem
                        key={project.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveToProject(node.id, project);
                        }}
                      >
                        <span className="truncate">{project.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node);
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
});
