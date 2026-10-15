import * as React from "react";
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
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
import type { Folder, FolderNode } from "@/lib/types";
import { createFolder, deleteFolder, moveFolder, renameFolder } from "@/lib/api";
import {
  buildFolderTree,
  canMoveOutToParent,
  canNestUnderPreviousSibling,
  descendantIds,
  findNode,
  flattenVisibleTree,
  getParentNode,
  reorderSibling,
  reorderTreeNodes,
  resolveInlineRename,
} from "./tree-utils";
import { isMacPlatform, isTypingContext } from "../shortcuts/key-utils";
import { cn } from "@/lib/utils";

export interface FolderTreeProps {
  projectId: string;
  folders: Folder[];
  activeFolderId: string | null;
  onSelectFolder: (folderId: string) => void;
  onRefresh: () => Promise<void>;
  isFocusedRegion?: boolean;
  onRequestFocusList?: () => void;
  focusedFolderId?: string | null;
  onFocusedFolderChange?: (folderId: string | null) => void;
}

export function FolderTree({
  projectId,
  folders,
  activeFolderId,
  onSelectFolder,
  onRefresh,
  isFocusedRegion = false,
  onRequestFocusList,
  focusedFolderId: externalFocusedId,
  onFocusedFolderChange,
}: FolderTreeProps) {
  // Build the hierarchical tree for this project
  const projectFolders = React.useMemo(() => {
    return folders.filter((f) => !f.deleted_at);
  }, [folders]);

  const tree = React.useMemo(() => {
    const fullTree = buildFolderTree(projectFolders);
    const projNode = fullTree.find((n) => n.id === projectId);
    return projNode ? projNode.children : [];
  }, [projectFolders, projectId]);

  // Expansion state
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(() => new Set());

  // Internal focused node state if not controlled
  const [internalFocusedId, setInternalFocusedId] = React.useState<string | null>(null);
  const focusedFolderId =
    externalFocusedId ?? internalFocusedId ?? activeFolderId ?? (tree[0]?.id || null);

  const setFocusedFolderId = React.useCallback(
    (id: string | null) => {
      setInternalFocusedId(id);
      onFocusedFolderChange?.(id);
    },
    [onFocusedFolderChange],
  );

  const isMac = React.useMemo(() => isMacPlatform(), []);

  // Visible flattened nodes for navigation
  const visibleNodes = React.useMemo(() => {
    return flattenVisibleTree(tree, expandedIds);
  }, [tree, expandedIds]);

  // Auto-expand path to active folder
  React.useEffect(() => {
    if (!activeFolderId) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      function check(nodes: FolderNode[]): boolean {
        for (const node of nodes) {
          if (node.id === activeFolderId) return true;
          if (check(node.children)) {
            next.add(node.id);
            return true;
          }
        }
        return false;
      }
      check(tree);
      return next;
    });
  }, [activeFolderId, tree]);

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Dialog & Inline Rename states
  const [newGroupOpen, setNewGroupOpen] = React.useState(false);
  const [newGroupParentId, setNewGroupParentId] = React.useState<string | null>(null);
  const [newGroupName, setNewGroupName] = React.useState("");

  const [inlineRenameId, setInlineRenameId] = React.useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = React.useState("");
  // Mirrors inlineRenameId so a blur right after Enter/Escape cannot save a second time.
  const inlineRenameIdRef = React.useRef<string | null>(null);

  const beginInlineRename = (target: FolderNode) => {
    inlineRenameIdRef.current = target.id;
    setInlineRenameId(target.id);
    setInlineRenameValue(target.name);
  };

  const cancelInlineRename = () => {
    inlineRenameIdRef.current = null;
    setInlineRenameId(null);
  };

  const [deleteTarget, setDeleteTarget] = React.useState<FolderNode | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Keyboard navigation handler for Tree region
  React.useEffect(() => {
    if (!isFocusedRegion) return;

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (isTypingContext(e.target) || isAnyDialogOpen()) return;

      const currentIndex = visibleNodes.findIndex((n) => n.id === focusedFolderId);
      const currentNode = currentIndex !== -1 ? visibleNodes[currentIndex] : visibleNodes[0];

      // Move down: j / ArrowDown
      if (e.key === "j" || e.key === "ArrowDown") {
        if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          if (visibleNodes.length > 0) {
            const nextIdx = Math.min(currentIndex + 1, visibleNodes.length - 1);
            setFocusedFolderId(visibleNodes[nextIdx].id);
          }
          return;
        }
      }

      // Move up: k / ArrowUp
      if (e.key === "k" || e.key === "ArrowUp") {
        if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          if (visibleNodes.length > 0) {
            const prevIdx = Math.max(currentIndex - 1, 0);
            setFocusedFolderId(visibleNodes[prevIdx].id);
          }
          return;
        }
      }

      // First / Last: Home / End
      if (e.key === "Home") {
        e.preventDefault();
        if (visibleNodes.length > 0) setFocusedFolderId(visibleNodes[0].id);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        if (visibleNodes.length > 0) setFocusedFolderId(visibleNodes[visibleNodes.length - 1].id);
        return;
      }

      // Left: collapse or jump to parent
      if (e.key === "ArrowLeft" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!currentNode) return;
        const hasChildren = currentNode.children && currentNode.children.length > 0;
        if (hasChildren && expandedIds.has(currentNode.id)) {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            next.delete(currentNode.id);
            return next;
          });
        } else {
          const parent = getParentNode(tree, currentNode.id);
          if (parent) {
            setFocusedFolderId(parent.id);
          }
        }
        return;
      }

      // Right: expand or jump to first child
      if (e.key === "ArrowRight" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!currentNode) return;
        const hasChildren = currentNode.children && currentNode.children.length > 0;
        if (hasChildren) {
          if (!expandedIds.has(currentNode.id)) {
            setExpandedIds((prev) => new Set(prev).add(currentNode.id));
          } else {
            setFocusedFolderId(currentNode.children[0].id);
          }
        }
        return;
      }

      // Open group and focus list: Enter / o
      if (e.key === "Enter" || e.key === "o") {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          if (currentNode) {
            onSelectFolder(currentNode.id);
            onRequestFocusList?.();
          }
          return;
        }
      }

      // Inline rename: r / F2
      if ((e.key === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) || e.key === "F2") {
        e.preventDefault();
        if (currentNode) {
          beginInlineRename(currentNode);
        }
        return;
      }

      // New group at same level: n
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const parent = currentNode ? getParentNode(tree, currentNode.id) : null;
        setNewGroupParentId(parent ? parent.id : null);
        setNewGroupName("");
        setNewGroupOpen(true);
        return;
      }

      // New subgroup inside: Shift+N
      if (e.key === "N" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (currentNode) {
          setNewGroupParentId(currentNode.id);
          setNewGroupName("");
          setNewGroupOpen(true);
        }
        return;
      }

      // Delete group: Delete / Mod+Backspace
      if (
        (e.key === "Delete" && !e.altKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === "Backspace")
      ) {
        e.preventDefault();
        if (currentNode) {
          setDeleteTarget(currentNode);
        }
        return;
      }

      // Alt+ArrowUp / Alt+ArrowDown: reorder among siblings
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        if (!currentNode) return;
        const dir = e.key === "ArrowUp" ? "up" : "down";
        const result = reorderSibling(tree, currentNode.id, dir);
        if (result && result.updates.length > 0) {
          try {
            for (const upd of result.updates) {
              await moveFolder(upd.id, undefined, upd.position);
            }
            toast.success("Group reordered");
            await onRefresh();
          } catch (err: any) {
            toast.error(err.message || "Failed to reorder group");
          }
        }
        return;
      }

      // Alt+ArrowRight: nest under previous sibling
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        if (!currentNode) return;
        const check = canNestUnderPreviousSibling(tree, currentNode.id);
        if (check.canNest && check.prevSibling) {
          try {
            await moveFolder(currentNode.id, check.prevSibling.id, 0);
            setExpandedIds((prev) => new Set(prev).add(check.prevSibling!.id));
            toast.success(`Nested under ${check.prevSibling.name}`);
            await onRefresh();
          } catch (err: any) {
            toast.error(err.message || "Failed to nest group");
          }
        } else {
          toast.error("No previous sibling to nest under");
        }
        return;
      }

      // Alt+ArrowLeft: move out to parent level
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        if (!currentNode) return;
        const check = canMoveOutToParent(tree, projectId, currentNode.id);
        if (check.canMoveOut && check.targetParentId) {
          try {
            await moveFolder(currentNode.id, check.targetParentId, 0);
            toast.success("Moved group out to parent level");
            await onRefresh();
          } catch (err: any) {
            toast.error(err.message || "Failed to move group out");
          }
        } else {
          toast.error(check.error || "Cannot move group out further");
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isFocusedRegion,
    visibleNodes,
    focusedFolderId,
    expandedIds,
    tree,
    projectId,
    onSelectFolder,
    onRequestFocusList,
    onRefresh,
    setFocusedFolderId,
  ]);

  // DnD state
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = React.useState<{
    targetId: string;
    position: "before" | "inside" | "after";
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
  );

  const handleDragStart = (e: DragStartEvent) => {
    setActiveDragId(String(e.active.id));
  };

  const handleDragOver = (e: DragOverEvent) => {
    if (!e.over || !activeDragId) {
      setDropIndicator(null);
      return;
    }
    const overId = String(e.over.id);
    if (overId === activeDragId) {
      setDropIndicator(null);
      return;
    }
    const forbidden = descendantIds(tree, activeDragId);
    if (forbidden.includes(overId)) {
      setDropIndicator(null);
      return;
    }

    const overData = e.over.data.current;
    const pos = (overData?.position as "before" | "inside" | "after") || "inside";
    setDropIndicator({ targetId: overId, position: pos });
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const activeId = activeDragId;
    setActiveDragId(null);
    setDropIndicator(null);

    if (!activeId || !e.over) return;
    const overId = String(e.over.id);
    if (activeId === overId) return;

    const forbidden = descendantIds(tree, activeId);
    if (forbidden.includes(overId)) return;

    try {
      if (dropIndicator?.position === "inside") {
        await moveFolder(activeId, overId, 0);
        setExpandedIds((prev) => new Set(prev).add(overId));
        toast.success("Group moved");
      } else {
        const zone = dropIndicator?.position === "before" ? "before" : "after";
        const result = reorderTreeNodes(tree, activeId, overId, zone);
        if (result && result.updates.length > 0) {
          for (const upd of result.updates) {
            await moveFolder(
              upd.id,
              upd.parent_id !== undefined ? upd.parent_id : undefined,
              upd.position,
            );
          }
          toast.success("Group reordered");
        }
      }
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to move group");
    }
  };

  const handleCreateGroup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = newGroupName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const parent = newGroupParentId ?? projectId;
      const created = await createFolder(name, parent);
      toast.success(`Group "${name}" created`);
      setNewGroupName("");
      setNewGroupOpen(false);
      setNewGroupParentId(null);
      if (parent !== projectId) {
        setExpandedIds((prev) => new Set(prev).add(parent));
      }
      await onRefresh();
      onSelectFolder(created.id);
      setFocusedFolderId(created.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to create group");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveInlineRename = async (nodeId: string) => {
    const target = findNode(tree, nodeId);
    const change = resolveInlineRename(
      inlineRenameIdRef.current,
      nodeId,
      inlineRenameValue,
      target?.name ?? "",
    );
    cancelInlineRename();
    if (!change) return;

    try {
      await renameFolder(change.id, change.name);
      toast.success("Group renamed");
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to rename group");
    }
  };

  const handleDeleteGroup = async () => {
    if (!deleteTarget || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await deleteFolder(deleteTarget.id);
      toast.success(`Group "${deleteTarget.name}" deleted`);
      const deletedId = deleteTarget.id;
      setDeleteTarget(null);
      await onRefresh();
      if (activeFolderId === deletedId) {
        const remaining = tree.filter((n) => n.id !== deletedId);
        if (remaining.length > 0) {
          onSelectFolder(remaining[0].id);
          setFocusedFolderId(remaining[0].id);
        } else {
          onSelectFolder(projectId);
          setFocusedFolderId(null);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete group");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col flex-1 min-h-0 select-none rounded-[6px] transition-colors",
        isFocusedRegion && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>Groups</span>
          {isFocusedRegion && (
            <span
              className="size-1.5 rounded-full bg-primary animate-pulse"
              title="Keyboard focused region"
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setNewGroupParentId(null);
            setNewGroupName("");
            setNewGroupOpen(true);
          }}
          className="flex size-5 items-center justify-center rounded-[4px] hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="New group (n)"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {tree.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No groups yet. Press <kbd className="font-semibold text-foreground">n</kbd> to create
              one.
            </div>
          ) : (
            <div className="space-y-0.5">
              {tree.map((node) => (
                <TreeNodeItem
                  key={node.id}
                  node={node}
                  depth={0}
                  activeFolderId={activeFolderId}
                  focusedFolderId={focusedFolderId}
                  isFocusedRegion={isFocusedRegion}
                  expandedIds={expandedIds}
                  toggleExpand={toggleExpand}
                  onSelect={(id) => {
                    onSelectFolder(id);
                    setFocusedFolderId(id);
                  }}
                  onNewSubgroup={(parent) => {
                    setNewGroupParentId(parent.id);
                    setNewGroupName("");
                    setNewGroupOpen(true);
                  }}
                  onRename={beginInlineRename}
                  onDelete={(target) => setDeleteTarget(target)}
                  inlineRenameId={inlineRenameId}
                  inlineRenameValue={inlineRenameValue}
                  onInlineRenameChange={setInlineRenameValue}
                  onInlineRenameSave={handleSaveInlineRename}
                  onInlineRenameCancel={cancelInlineRename}
                  activeDragId={activeDragId}
                  dropIndicator={dropIndicator}
                  isMac={isMac}
                />
              ))}
            </div>
          )}
        </DndContext>
      </div>

      <div className="p-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between text-xs font-normal h-8"
          title="New group (n)"
          onClick={() => {
            setNewGroupParentId(null);
            setNewGroupName("");
            setNewGroupOpen(true);
          }}
        >
          <div className="flex items-center">
            <FolderPlus className="mr-2 size-3.5" />
            <span>New group</span>
          </div>
          <kbd className="rounded border border-border bg-muted/60 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
            n
          </kbd>
        </Button>
      </div>

      {/* New Group Dialog */}
      <Dialog open={newGroupOpen} onOpenChange={setNewGroupOpen}>
        <DialogContent>
          <form onSubmit={handleCreateGroup}>
            <DialogHeader>
              <DialogTitle>{newGroupParentId ? "Create subgroup" : "Create new group"}</DialogTitle>
              <DialogDescription>
                {newGroupParentId
                  ? "Create a subgroup inside the selected group."
                  : "Organize sources into groups inside this project."}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                autoFocus
                disabled={isSubmitting}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewGroupOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newGroupName.trim() || isSubmitting}>
                {isSubmitting ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.name}&rdquo;? Any subgroups and
              saved items within it will also be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isSubmitting}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteGroup}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete group"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TreeNodeItemProps {
  node: FolderNode;
  depth: number;
  activeFolderId: string | null;
  focusedFolderId: string | null;
  isFocusedRegion: boolean;
  expandedIds: Set<string>;
  toggleExpand: (id: string, e?: React.MouseEvent) => void;
  onSelect: (id: string) => void;
  onNewSubgroup: (parent: FolderNode) => void;
  onRename: (target: FolderNode) => void;
  onDelete: (target: FolderNode) => void;
  inlineRenameId: string | null;
  inlineRenameValue: string;
  onInlineRenameChange: (val: string) => void;
  onInlineRenameSave: (nodeId: string) => void;
  onInlineRenameCancel: () => void;
  activeDragId: string | null;
  dropIndicator: { targetId: string; position: "before" | "inside" | "after" } | null;
  isMac: boolean;
}

function TreeNodeItem({
  node,
  depth,
  activeFolderId,
  focusedFolderId,
  isFocusedRegion,
  expandedIds,
  toggleExpand,
  onSelect,
  onNewSubgroup,
  onRename,
  onDelete,
  inlineRenameId,
  inlineRenameValue,
  onInlineRenameChange,
  onInlineRenameSave,
  onInlineRenameCancel,
  activeDragId,
  dropIndicator,
  isMac,
}: TreeNodeItemProps) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = activeFolderId === node.id;
  const isFocusedRow = focusedFolderId === node.id;
  const isDragging = activeDragId === node.id;
  const isInlineEditing = inlineRenameId === node.id;

  const isDropTarget = dropIndicator?.targetId === node.id;
  const dropPosition = isDropTarget ? dropIndicator.position : null;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: node.id,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: node.id,
    data: {
      position: "inside",
    },
  });

  const combineRef = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div className="flex flex-col">
      {/* Drop Before Indicator */}
      {isDropTarget && dropPosition === "before" && (
        <div className="h-0.5 w-full bg-primary my-0.5 rounded-full" />
      )}

      <div
        ref={combineRef}
        {...attributes}
        {...listeners}
        onClick={() => onSelect(node.id)}
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        className={cn(
          "group relative flex h-8 items-center gap-1.5 rounded-[4px] pr-2 text-xs font-medium cursor-pointer transition-colors",
          isSelected
            ? "bg-accent text-accent-foreground font-semibold"
            : "text-foreground hover:bg-muted/70",
          isFocusedRow && isFocusedRegion && "ring-2 ring-primary ring-inset",
          isFocusedRow && !isFocusedRegion && "border-l-2 border-primary/50",
          isDragging && "opacity-40",
          isDropTarget && dropPosition === "inside" && "ring-2 ring-primary ring-inset",
        )}
      >
        {/* Expand / Collapse Chevron */}
        <button
          type="button"
          onClick={(e) => toggleExpand(node.id, e)}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:text-foreground",
            !hasChildren && "invisible",
          )}
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform duration-150", isExpanded && "rotate-90")}
          />
        </button>

        {/* Folder Icon */}
        {isExpanded ? (
          <FolderOpen className="size-4 shrink-0 text-primary" />
        ) : (
          <FolderIcon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        )}

        {/* Folder Name / Inline Rename Input */}
        {isInlineEditing ? (
          <input
            autoFocus
            value={inlineRenameValue}
            onChange={(e) => onInlineRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                onInlineRenameSave(node.id);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onInlineRenameCancel();
              }
            }}
            onBlur={() => onInlineRenameSave(node.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-6 flex-1 rounded border border-primary bg-background px-1.5 text-xs text-foreground outline-none"
          />
        ) : (
          <span className="truncate flex-1 text-left">{node.name}</span>
        )}

        {/* Item count */}
        {node.itemCount > 0 && !isInlineEditing && (
          <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
            {node.itemCount}
          </span>
        )}

        {/* Row Action Menu */}
        {!isInlineEditing && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={(e) => e.stopPropagation()}
                className="flex size-6 items-center justify-center rounded-[3px] text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 outline-none cursor-pointer"
              >
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSubgroup(node);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center">
                    <Plus className="mr-2 size-3.5" />
                    <span>New subgroup</span>
                  </div>
                  <kbd className="text-[9px] font-mono text-muted-foreground">⇧N</kbd>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(node);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center">
                    <Pencil className="mr-2 size-3.5" />
                    <span>Rename</span>
                  </div>
                  <kbd className="text-[9px] font-mono text-muted-foreground">r / F2</kbd>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(node);
                  }}
                  className="flex items-center justify-between"
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
        )}
      </div>

      {/* Drop After Indicator */}
      {isDropTarget && dropPosition === "after" && (
        <div className="h-0.5 w-full bg-primary my-0.5 rounded-full" />
      )}

      {/* Children Subgroups */}
      {hasChildren && isExpanded && (
        <div className="flex flex-col">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeFolderId={activeFolderId}
              focusedFolderId={focusedFolderId}
              isFocusedRegion={isFocusedRegion}
              expandedIds={expandedIds}
              toggleExpand={toggleExpand}
              onSelect={onSelect}
              onNewSubgroup={onNewSubgroup}
              onRename={onRename}
              onDelete={onDelete}
              inlineRenameId={inlineRenameId}
              inlineRenameValue={inlineRenameValue}
              onInlineRenameChange={onInlineRenameChange}
              onInlineRenameSave={onInlineRenameSave}
              onInlineRenameCancel={onInlineRenameCancel}
              activeDragId={activeDragId}
              dropIndicator={dropIndicator}
              isMac={isMac}
            />
          ))}
        </div>
      )}
    </div>
  );
}
