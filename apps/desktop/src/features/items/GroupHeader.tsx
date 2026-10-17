import * as React from "react";
import { Folder as FolderIcon, FolderPlus, StickyNote } from "lucide-react";
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
import type { Folder } from "@/lib/types";
import { createFolder } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { isTypingContext } from "../shortcuts/key-utils";
import { isTabSwitchKey, toggleGroupTab, type GroupTab } from "../highlights/highlight-rows";
import { AddImageButton } from "./AddImageButton";
import { onGroupAction } from "./group-actions";

function plural(count: number, one: string, many: string) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** Ancestors from the project down to the folder's parent. */
function ancestorsOf(folders: Folder[], folder: Folder): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let current = folder.parent_id ? byId.get(folder.parent_id) : undefined;
  while (current && chain.length < 1000) {
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return chain;
}

function subgroupsOf(folders: Folder[], folderId: string): Folder[] {
  return folders
    .filter((f) => f.parent_id === folderId && !f.deleted_at)
    .sort((a, b) => a.position - b.position);
}

export interface GroupHeaderProps {
  folders: Folder[];
  folderId: string;
  sourceCount: number;
  /** Highlights in this group; shown on the Highlights tab. */
  highlightCount?: number;
  tab?: GroupTab;
  onTabChange?: (tab: GroupTab) => void;
  isFocusedRegion: boolean;
  onSelectGroup: (id: string) => void;
  onNewNote: () => void;
  /** Reloads the groups and the sources after something was added. */
  onRefresh: () => Promise<void>;
}

/** Breadcrumb, group title, source count and the add actions, like the web app's group page. */
export function GroupHeader({
  folders,
  folderId,
  sourceCount,
  highlightCount = 0,
  tab = "sources",
  onTabChange,
  isFocusedRegion,
  onSelectGroup,
  onNewNote,
  onRefresh,
}: GroupHeaderProps) {
  const folder = folders.find((f) => f.id === folderId);
  const ancestors = React.useMemo(
    () => (folder ? ancestorsOf(folders, folder) : []),
    [folders, folder],
  );
  const subgroupCount = React.useMemo(
    () => subgroupsOf(folders, folderId).length,
    [folders, folderId],
  );

  const [subgroupOpen, setSubgroupOpen] = React.useState(false);
  const [subgroupName, setSubgroupName] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);

  const openSubgroupDialog = React.useCallback(() => {
    setSubgroupName("");
    setSubgroupOpen(true);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFocusedRegion || isTypingContext(e.target) || isAnyDialogOpen()) return;
      if (e.key === "N" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openSubgroupDialog();
      } else if (onTabChange && isTabSwitchKey(e)) {
        e.preventDefault();
        onTabChange(toggleGroupTab(tab));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocusedRegion, openSubgroupDialog, onTabChange, tab]);

  React.useEffect(
    () =>
      onGroupAction((action) => {
        if (action === "new-subgroup") openSubgroupDialog();
      }),
    [openSubgroupDialog],
  );

  const handleCreateSubgroup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = subgroupName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    try {
      await createFolder(name, folderId);
      toast.success(`Subgroup "${name}" created`);
      setSubgroupOpen(false);
      await onRefresh();
    } catch (err) {
      toast.error(errorMessage(err, "Failed to create subgroup"));
    } finally {
      setIsCreating(false);
    }
  };

  if (!folder) return null;

  const counts = [
    subgroupCount > 0 ? plural(subgroupCount, "subgroup", "subgroups") : null,
    plural(sourceCount, "source", "sources"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="shrink-0">
      <nav
        aria-label="Breadcrumb"
        className="mb-1 min-h-[18px] font-sans text-[13px] leading-[18px] text-muted-foreground"
      >
        {ancestors.map((ancestor, index) => (
          <span key={ancestor.id}>
            {index > 0 && " / "}
            {index === 0 ? (
              // The project itself has no page; only groups can be opened.
              <span>{ancestor.name}</span>
            ) : (
              <button
                type="button"
                onClick={() => onSelectGroup(ancestor.id)}
                className="cursor-pointer rounded-sm hover:text-foreground"
              >
                {ancestor.name}
              </button>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 pb-3">
        <h1 className="min-w-0 truncate font-serif text-[28px] font-semibold leading-[34px] text-foreground">
          {folder.name}
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {counts}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openSubgroupDialog}
            title="New subgroup (Shift+N)"
          >
            <FolderPlus className="size-3.5" aria-hidden="true" />
            <span>New subgroup</span>
            <Kbd>⇧N</Kbd>
          </Button>
          <AddImageButton
            folderId={folderId}
            isFocusedRegion={isFocusedRegion}
            onAdded={onRefresh}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onNewNote}
            title="New note (c)"
          >
            <StickyNote className="size-3.5" aria-hidden="true" />
            <span>New note</span>
            <Kbd>c</Kbd>
          </Button>
        </div>
      </div>
      <div
        role="tablist"
        aria-label="Group view"
        className="flex items-end gap-5 border-b border-border"
      >
        {(
          [
            { id: "sources", label: "Sources", count: sourceCount },
            { id: "highlights", label: "Highlights", count: highlightCount },
          ] as const
        ).map((entry) => {
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange?.(entry.id)}
              title={entry.id === "highlights" ? "Highlights (Shift+H)" : "Sources (Shift+H)"}
              className={cn(
                "-mb-px flex h-10 cursor-pointer items-center gap-1.5 border-b-2 font-sans text-[13px] leading-[18px] transition-colors",
                active
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{entry.label}</span>
              <span className="tabular-nums">{entry.count}</span>
            </button>
          );
        })}
      </div>

      <Dialog open={subgroupOpen} onOpenChange={setSubgroupOpen}>
        <DialogContent>
          <form onSubmit={handleCreateSubgroup}>
            <DialogHeader>
              <DialogTitle>New subgroup</DialogTitle>
              <DialogDescription>Create a subgroup inside {folder.name}.</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={subgroupName}
                onChange={(e) => setSubgroupName(e.target.value)}
                placeholder="Subgroup name"
                autoFocus
                disabled={isCreating}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSubgroupOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!subgroupName.trim() || isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  );
}

export interface SubgroupListProps {
  folders: Folder[];
  folderId: string;
  onSelectGroup: (id: string) => void;
}

/** The group's subgroups as 48px rows above its sources. */
export function SubgroupList({ folders, folderId, onSelectGroup }: SubgroupListProps) {
  const subgroups = React.useMemo(() => subgroupsOf(folders, folderId), [folders, folderId]);
  if (subgroups.length === 0) return null;

  return (
    <section aria-label="Subgroups" className="max-h-[40%] shrink-0 overflow-y-auto">
      <div className="pt-4 pb-1.5 font-sans text-[12px] font-medium leading-4 text-muted-foreground">
        Subgroups
      </div>
      <ul role="list" className="divide-y divide-border border-b border-border">
        {subgroups.map((group) => {
          const nested = subgroupsOf(folders, group.id).length;
          const meta = [
            nested > 0 ? plural(nested, "subgroup", "subgroups") : null,
            plural(group.item_count ?? 0, "source", "sources"),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                className="flex min-h-[48px] w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
              >
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium leading-[22px] text-foreground">
                  {group.name}
                </span>
                <span className="shrink-0 font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                  {meta}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
