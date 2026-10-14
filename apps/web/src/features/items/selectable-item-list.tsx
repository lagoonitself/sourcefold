"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ItemListRow } from "./item-columns";
import { ItemRow } from "./item-row";

export interface SelectableItemListProps {
  items: ItemListRow[];
}

function plural(count: number) {
  return count === 1 ? "1 link" : `${count} links`;
}

/** A group's sources with checkboxes, to copy their links (one per line) to the clipboard. */
export function SelectableItemList({ items }: SelectableItemListProps) {
  const linkItems = useMemo(() => items.filter((item) => item.source_url), [items]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const lastToggledIdRef = useRef<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Drop selections for items that left the list (moved or deleted).
  const selected = useMemo(
    () => new Set(linkItems.filter((item) => selectedIds.has(item.id)).map((item) => item.id)),
    [linkItems, selectedIds],
  );
  const allSelected = linkItems.length > 0 && selected.size === linkItems.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && !allSelected;
    }
  }, [selected.size, allSelected]);

  const toggle = (id: string, shiftKey: boolean) => {
    const next = new Set(selected);
    const select = !next.has(id);
    const lastId = lastToggledIdRef.current;
    if (shiftKey && lastId) {
      const from = linkItems.findIndex((item) => item.id === lastId);
      const to = linkItems.findIndex((item) => item.id === id);
      if (from !== -1 && to !== -1) {
        for (const item of linkItems.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          if (select) next.add(item.id);
          else next.delete(item.id);
        }
      }
    }
    if (select) next.add(id);
    else next.delete(id);
    lastToggledIdRef.current = id;
    setSelectedIds(next);
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(linkItems.map((item) => item.id)));
  };

  const stopSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const copyLinks = async () => {
    const toCopy =
      selected.size > 0 ? linkItems.filter((item) => selected.has(item.id)) : linkItems;
    const text = toCopy.map((item) => item.source_url).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${plural(toCopy.length)}`);
      if (selecting) stopSelecting();
    } catch {
      toast.error("Couldn't copy to the clipboard. Try again.");
    }
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      {linkItems.length > 0 && (
        <div className="flex h-11 items-center gap-3 border-b border-border">
          {selecting && (
            <>
              <label className="flex w-9 shrink-0 cursor-pointer items-center justify-center">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all links"
                  className="size-4 cursor-pointer accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
              </label>
              <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                {selected.size > 0 ? `${selected.size} selected` : "Tick the links to copy"}
              </span>
            </>
          )}
          <div className="mr-2 ml-auto flex items-center gap-2">
            {selecting ? (
              <>
                <Button type="button" variant="ghost" size="sm" onClick={stopSelecting}>
                  Cancel
                </Button>
                <Button type="button" size="sm" disabled={selected.size === 0} onClick={copyLinks}>
                  <Copy className="size-4" aria-hidden="true" />
                  {selected.size > 0 ? `Copy ${plural(selected.size)}` : "Copy links"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelecting(true)}
                >
                  Select
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={copyLinks}>
                  <Copy className="size-4" aria-hidden="true" />
                  Copy all links
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      <ul role="list" className="divide-y divide-border">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            selection={
              !selecting
                ? undefined
                : item.source_url
                  ? {
                      checked: selected.has(item.id),
                      onToggle: (shiftKey) => toggle(item.id, shiftKey),
                    }
                  : null
            }
          />
        ))}
      </ul>
    </div>
  );
}
