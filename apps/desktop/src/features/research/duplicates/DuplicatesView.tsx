import * as React from "react";
import { BookOpen, Check, Copy, Files } from "lucide-react";
import { toast } from "sonner";
import {
  DUPLICATE_REASON_LABELS,
  findDuplicateSets,
  type DuplicateReason,
  type DuplicateSet,
} from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { getSourceKind, SourceTile } from "@/features/items/source-kinds";
import type { Folder, Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProjectData } from "../project-data/use-project-data";
import { ViewHeader, ViewSkeleton } from "../shared/ViewHeader";

export interface DuplicatesViewProps {
  project: Folder | undefined;
  folders: readonly Folder[];
  data: ProjectData;
  isFocusedRegion?: boolean;
  onOpenReader?: (item: Item) => void;
}

interface MergeTarget {
  keepItem: Item;
  otherItems: Item[];
  groupName: string;
}

export function DuplicatesView({
  project,
  folders,
  data,
  isFocusedRegion: _isFocusedRegion,
  onOpenReader,
}: DuplicatesViewProps) {
  const { items, loading, mergeDuplicates } = data;
  const [mergeTarget, setMergeTarget] = React.useState<MergeTarget | null>(null);
  const [isMerging, setIsMerging] = React.useState(false);

  const foldersById = React.useMemo(() => {
    return new Map(folders.map((f) => [f.id, f]));
  }, [folders]);

  const itemsById = React.useMemo(() => {
    return new Map(items.map((i) => [i.id, i]));
  }, [items]);

  const duplicateSets = React.useMemo(() => {
    return findDuplicateSets(items);
  }, [items]);

  const getGroupPath = React.useCallback(
    (folderId: string): string => {
      const parts: string[] = [];
      let current = foldersById.get(folderId);
      while (current && parts.length < 10) {
        parts.unshift(current.name);
        current = current.parent_id ? foldersById.get(current.parent_id) : undefined;
      }
      return parts.join(" / ") || "Group";
    },
    [foldersById],
  );

  const handleKeepItem = (keepItem: Item, otherItems: Item[]) => {
    const group = foldersById.get(keepItem.folder_id)?.name ?? "this group";
    setMergeTarget({ keepItem, otherItems, groupName: group });
  };

  const handleConfirmMerge = async () => {
    if (!mergeTarget || isMerging) return;
    setIsMerging(true);
    try {
      const otherIds = mergeTarget.otherItems.map((i) => i.id);
      const result = await mergeDuplicates(mergeTarget.keepItem.id, otherIds);
      if (result) {
        toast.success(
          `Kept copy in ${mergeTarget.groupName}. Merged ${result.moved_highlights} highlights and ${result.moved_cards} cards.`,
        );
      }
      setMergeTarget(null);
    } finally {
      setIsMerging(false);
    }
  };

  const summary =
    duplicateSets.length === 0
      ? "No duplicates"
      : `${duplicateSets.length} duplicate ${duplicateSets.length === 1 ? "group" : "groups"}`;

  return (
    <div className="@container/view flex min-h-0 flex-1 flex-col px-5 pt-7 @[720px]/view:px-9 @[720px]/view:pt-9">
      <ViewHeader title="Duplicates" summary={summary} />

      {loading && duplicateSets.length === 0 ? (
        <ViewSkeleton label="Scanning for duplicates..." />
      ) : duplicateSets.length === 0 ? (
        <EmptyState
          icon={Files}
          title="No duplicates in this project"
          description="All sources in this project appear to be unique."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
          <div className="space-y-8">
            {duplicateSets.map((set, setIndex) => {
              const setReason = DUPLICATE_REASON_LABELS[set.reason] ?? "Duplicate sources";
              const setItems = set.item_ids
                .map((id) => itemsById.get(id))
                .filter((item): item is Item => Boolean(item));

              if (setItems.length < 2) return null;

              return (
                <div
                  key={`${set.reason}-${setIndex}`}
                  className="rounded-[12px] border border-border bg-card p-4 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-border pb-2.5">
                    <span className="font-sans text-[13px] font-semibold text-foreground">
                      {setReason}
                    </span>
                    <span className="font-sans text-[12px] tabular-nums text-muted-foreground">
                      {setItems.length} copies
                    </span>
                  </div>

                  <div className="divide-y divide-border/60">
                    {setItems.map((item) => {
                      const kind = getSourceKind(item.kind);
                      const groupPath = getGroupPath(item.folder_id);
                      const dateStr = item.created_at
                        ? new Date(item.created_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "";
                      const otherItems = setItems.filter((other) => other.id !== item.id);

                      return (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-1"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <SourceTile kind={kind} className="size-8 shrink-0" />
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <p className="truncate font-serif text-[15px] font-medium leading-[20px] text-foreground">
                                {item.title || "Untitled source"}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                                <span className="font-medium text-foreground/80">{groupPath}</span>
                                {dateStr && <span>Saved {dateStr}</span>}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {onOpenReader && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onOpenReader(item)}
                                className="h-8 gap-1.5 text-[12.5px]"
                              >
                                <BookOpen className="size-3.5" aria-hidden="true" />
                                <span>Open</span>
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleKeepItem(item, otherItems)}
                              className="h-8 gap-1.5 text-[12.5px] hover:border-foreground/40"
                            >
                              <Check className="size-3.5" aria-hidden="true" />
                              <span>Keep this one</span>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Keep this one confirm dialog */}
      <Dialog
        open={mergeTarget !== null}
        onOpenChange={(open) => !open && !isMerging && setMergeTarget(null)}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Keep this copy in {mergeTarget?.groupName}?</DialogTitle>
            <DialogDescription>
              The other {mergeTarget?.otherItems.length === 1 ? "copy is" : "copies are"} deleted.
              Their highlights, cards, tags and notes move to this one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeTarget(null)} disabled={isMerging}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirmMerge()} disabled={isMerging}>
              Keep this copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
