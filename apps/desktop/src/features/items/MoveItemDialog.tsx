import * as React from "react";
import { Check, Folder as FolderIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import type { Folder, FolderNode, Item } from "@/lib/types";
import { moveItem } from "@/lib/api";
import { buildFolderTree } from "../folders/tree-utils";
import { filterFuzzy } from "../command-palette/fuzzy";
import { cn } from "@/lib/utils";

export interface MoveItemDialogProps {
  /** The sources to move; all of them live in the group being viewed. */
  items: Item[];
  folders: Folder[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: () => Promise<void>;
}

interface FlatGroupOption {
  id: string;
  name: string;
  fullPath: string;
  projectName: string;
  isCurrent: boolean;
}

export function MoveItemDialog({
  items,
  folders,
  open,
  onOpenChange,
  onMoved,
}: MoveItemDialogProps) {
  const [filterQuery, setFilterQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [isMoving, setIsMoving] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const currentFolderId = items[0]?.folder_id;

  React.useEffect(() => {
    if (open) {
      setFilterQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Build tree & flattened group options
  const tree = React.useMemo(() => {
    return buildFolderTree(folders.filter((f) => !f.deleted_at && !f.archived_at));
  }, [folders]);

  const allGroupOptions = React.useMemo(() => {
    const list: FlatGroupOption[] = [];

    function collect(nodes: FolderNode[], pathPrefix: string, projectName: string) {
      for (const node of nodes) {
        const fullPath = pathPrefix
          ? `${pathPrefix} / ${node.name}`
          : `${projectName} / ${node.name}`;
        list.push({
          id: node.id,
          name: node.name,
          fullPath,
          projectName,
          isCurrent: currentFolderId === node.id,
        });
        if (node.children && node.children.length > 0) {
          collect(node.children, fullPath, projectName);
        }
      }
    }

    for (const project of tree) {
      collect(project.children, "", project.name);
    }

    return list;
  }, [tree, currentFolderId]);

  const filteredGroups = React.useMemo(() => {
    if (!filterQuery.trim()) {
      return allGroupOptions;
    }
    return filterFuzzy(allGroupOptions, filterQuery.trim(), (g) => `${g.name} ${g.fullPath}`);
  }, [allGroupOptions, filterQuery]);

  React.useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredGroups.length === 0) return 0;
      return Math.min(prev, filteredGroups.length - 1);
    });
  }, [filteredGroups.length]);

  React.useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-group-index="${selectedIndex}"]`,
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleMoveTo = async (targetFolderId: string) => {
    if (items.length === 0 || !targetFolderId || targetFolderId === currentFolderId || isMoving) {
      return;
    }

    setIsMoving(true);
    try {
      await Promise.all(items.map((item) => moveItem(item.id, targetFolderId)));
      const targetFolder = folders.find((f) => f.id === targetFolderId);
      toast.success(
        items.length === 1
          ? `Moved to ${targetFolder?.name || "group"}`
          : `Moved ${items.length} sources to ${targetFolder?.name || "group"}`,
      );
      onOpenChange(false);
      if (onMoved) await onMoved();
    } catch (err: any) {
      toast.error(err.message || "Failed to move item");
    } finally {
      setIsMoving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredGroups.length === 0 ? 0 : (prev + 1) % filteredGroups.length,
      );
    } else if (e.key === "ArrowUp" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredGroups.length === 0
          ? 0
          : (prev - 1 + filteredGroups.length) % filteredGroups.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filteredGroups[selectedIndex];
      if (target && !target.isCurrent) {
        void handleMoveTo(target.id);
      }
    }
  };

  const selectedTarget = filteredGroups[selectedIndex];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px] p-0 overflow-hidden" onKeyDown={handleKeyDown}>
        <DialogHeader className="p-4 pb-2 mb-0">
          <DialogTitle>
            {items.length > 1 ? `Move ${items.length} sources to group` : "Move source to group"}
          </DialogTitle>
        </DialogHeader>

        {/* Type-to-filter input */}
        <div className="flex items-center gap-2.5 border-y border-border px-4 py-2.5 bg-muted/20">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Filter groups... (↑↓ to select, Enter to move)"
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Filtered Groups List */}
        <div ref={listRef} className="max-h-72 overflow-y-auto divide-y divide-border/40 py-1">
          {filteredGroups.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No groups match &ldquo;{filterQuery}&rdquo;
            </div>
          ) : (
            filteredGroups.map((group, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={group.id}
                  data-group-index={idx}
                  onClick={() => {
                    if (!group.isCurrent) {
                      void handleMoveTo(group.id);
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-2 transition-colors cursor-pointer select-none text-xs",
                    group.isCurrent && "cursor-not-allowed opacity-50 text-muted-foreground",
                    !group.isCurrent &&
                      isSelected &&
                      "bg-accent text-accent-foreground font-medium",
                    !group.isCurrent && !isSelected && "hover:bg-muted/60 text-foreground",
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{group.name}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {group.fullPath}
                      </div>
                    </div>
                  </div>

                  {group.isCurrent ? (
                    <span className="text-[10px] font-medium text-muted-foreground shrink-0">
                      (current)
                    </span>
                  ) : isSelected ? (
                    <kbd className="text-[10px] font-sans font-semibold text-accent-foreground">
                      ↵ Enter
                    </kbd>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 pt-2 border-t border-border mt-0 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">↑↓ to select, Enter to move</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isMoving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (selectedTarget && !selectedTarget.isCurrent) {
                  void handleMoveTo(selectedTarget.id);
                }
              }}
              disabled={!selectedTarget || selectedTarget.isCurrent || isMoving}
            >
              {isMoving ? "Moving..." : "Move"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
