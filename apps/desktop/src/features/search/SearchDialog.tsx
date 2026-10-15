import * as React from "react";
import { ExternalLink, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import type { Folder, Item } from "@/lib/types";
import { searchItems } from "@/lib/api";
import { openUrl, cn } from "@/lib/utils";

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Folder[];
  currentProjectId?: string | null;
  onSelectItem?: (item: Item) => void;
}

export function SearchDialog({
  open,
  onOpenChange,
  folders,
  currentProjectId,
  onSelectItem,
}: SearchDialogProps) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Item[]>([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced search
  React.useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const items = await searchItems(query.trim(), currentProjectId);
        setResults(items);
        setSelectedIndex(0);
      } catch (e) {
        console.error("Search error", e);
      } finally {
        setIsLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, currentProjectId]);

  const folderMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const f of folders) {
      map.set(f.id, f.name);
    }
    return map;
  }, [folders]);

  const handleSelectItem = (item: Item) => {
    if (onSelectItem) {
      onSelectItem(item);
    } else if (item.source_url) {
      openUrl(item.source_url);
    }
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
    } else if (e.key === "ArrowUp" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        results.length === 0 ? 0 : (prev - 1 + results.length) % results.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelectItem(results[selectedIndex]);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[580px] p-0 overflow-hidden border-border bg-card shadow-float"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, notes, or URLs... (Esc to close)"
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto divide-y divide-border">
          {query.trim() && results.length === 0 && !isLoading && (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No sources match &ldquo;{query}&rdquo;
            </div>
          )}

          {results.map((item, idx) => {
            const folderName = folderMap.get(item.folder_id) || "Group";
            const isSelected = idx === selectedIndex;

            return (
              <div
                key={item.id}
                onClick={() => handleSelectItem(item)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={cn(
                  "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors cursor-pointer select-none",
                  isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-serif text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                    {item.note && (
                      <span title="Has note" className="text-muted-foreground">
                        <MessageSquare className="size-3" />
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <span className="capitalize">{item.kind}</span>
                    <span>&bull;</span>
                    <span>{folderName}</span>
                    {item.source_url && (
                      <>
                        <span>&bull;</span>
                        <span className="truncate max-w-[200px]">{item.source_url}</span>
                      </>
                    )}
                  </div>
                </div>

                {item.source_url && (
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
                )}
              </div>
            );
          })}
        </div>

        {results.length > 0 && (
          <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
            <span>↑↓ to navigate, Enter to open</span>
            <span>
              {results.length} result{results.length === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
