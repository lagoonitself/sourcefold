import * as React from "react";
import { Folder as FolderIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/Kbd";
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
  depth: number;
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

    function collect(nodes: FolderNode[], pathPrefix: string, projectName: string, depth = 0) {
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
          depth,
        });
        if (node.children && node.children.length > 0) {
          collect(node.children, fullPath, projectName, depth + 1);
        }
      }
    }

    for (const project of tree) {
      collect(project.children, "", project.name, 0);
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
      <DialogContent className="max-w-[480px] p-0 overflow-hidden" onKeyDown={handleKeyDown}>
        <DialogHeader className="p-4 pb-3 mb-0">
          <DialogTitle>
            {items.length > 1 ? `Move ${items.length} sources to group` : "Move source to group"}
          </DialogTitle>
        </DialogHeader>

        {/* Type-to-filter input */}
        <div className="flex items-center gap-2.5 border-y border-border px-4 py-2 bg-muted/20">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={filterQuery}
            onChange={(e) => {
              setFilterQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Filter groups... (↑↓ to select, Enter to move)"
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/80"
            autoFocus
          />
        </div>

        {/* Filtered Groups List */}
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          {filteredGroups.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
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
                  style={{ paddingLeft: `${12 + group.depth * 14}px` }}
                  className={cn(
                    "relative flex items-center justify-between gap-3 pr-3 py-2 rounded-[8px] transition-colors select-none text-[13px]",
                    group.isCurrent && "cursor-not-allowed opacity-50",
                    !group.isCurrent && "cursor-pointer",
                    !group.isCurrent &&
                      isSelected &&
                      "bg-accent text-accent-foreground font-medium",
                    !group.isCurrent && !isSelected && "hover:bg-muted text-foreground",
                  )}
                >
                  {!group.isCurrent && isSelected && (
                    <span
                      className="absolute left-1 top-2 bottom-2 w-0.5 rounded-full bg-foreground"
                      aria-hidden="true"
                    />
                  )}

                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-muted text-foreground">
                      <FolderIcon className="size-3.5 shrink-0" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground">{group.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {group.fullPath}
                      </div>
                    </div>
                  </div>

                  {group.isCurrent ? (
                    <span className="text-[11.5px] font-medium text-muted-foreground shrink-0">
                      Current
                    </span>
                  ) : isSelected ? (
                    <Kbd className="text-[10px]">↵ Enter</Kbd>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 pt-3 border-t border-border mt-0 flex items-center justify-between">
          <span className="text-[12px] text-muted-foreground">↑↓ to select, Enter to move</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isMoving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
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
