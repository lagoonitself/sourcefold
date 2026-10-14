"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { buildFolderTree, type FolderInputRow, type FolderNode } from "@/features/folders/tree";
import type { ItemListRow } from "./item-columns";

export interface MoveItemDialogProps {
  item: ItemListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveItemDialog({ item, open, onOpenChange }: MoveItemDialogProps) {
  const router = useRouter();
  const [flatFolders, setFlatFolders] = useState<FolderInputRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    fetch("/api/folders", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Failed to load folders");
        }
        return res.json();
      })
      .then((json) => {
        if (!controller.signal.aborted) {
          setFlatFolders(json.data ?? []);
          setSelectedFolderId(null);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        toast.error("Couldn't load groups. Try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [open]);

  const tree = useMemo(() => buildFolderTree(flatFolders), [flatFolders]);

  const handleMove = async () => {
    if (!selectedFolderId || selectedFolderId === item.folder_id || isMoving) return;

    const targetFolder = flatFolders.find((f) => f.id === selectedFolderId);
    const targetName = targetFolder?.name ?? "folder";

    setIsMoving(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: selectedFolderId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't move this item. Try again.");
        return;
      }
      toast(`Moved to ${targetName}`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Couldn't move this item. Try again.");
    } finally {
      setIsMoving(false);
    }
  };

  const renderNodes = (nodes: FolderNode[], level = 1): React.ReactNode => {
    return nodes.map((node) => {
      const isCurrent = node.id === item.folder_id;
      const isSelected = selectedFolderId === node.id;

      return (
        <React.Fragment key={node.id}>
          <button
            type="button"
            disabled={isCurrent}
            onClick={() => setSelectedFolderId(node.id)}
            style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}
            className={cn(
              "flex h-8 w-full items-center gap-2 pr-3 rounded text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isCurrent && "cursor-not-allowed opacity-50 text-muted-foreground",
              !isCurrent && isSelected && "bg-accent text-accent-foreground font-medium",
              !isCurrent && !isSelected && "text-foreground hover:bg-muted",
            )}
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate flex-1">{node.name}</span>
            {isCurrent && <span className="text-xs text-muted-foreground shrink-0">(current)</span>}
          </button>
          {node.children.length > 0 && renderNodes(node.children, level + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
            Move to…
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto py-1 border border-border rounded-md">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-7 w-2/3" />
            </div>
          ) : tree.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No groups yet.</div>
          ) : (
            <div className="flex flex-col py-1">
              {tree.map((project) => (
                <div key={project.id} role="group" aria-label={project.name} className="pb-1">
                  <div className="truncate px-2 pt-2 pb-1 text-[12px] font-medium leading-4 text-muted-foreground">
                    {project.name}
                  </div>
                  {project.children.length > 0 ? (
                    renderNodes(project.children, 1)
                  ) : (
                    <div className="px-2 pb-1 text-[13px] text-muted-foreground">No groups</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
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
            onClick={handleMove}
            disabled={!selectedFolderId || selectedFolderId === item.folder_id || isMoving}
          >
            {isMoving ? "Moving..." : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
