import * as React from "react";
import { BookMarked, MoreHorizontal, Plus, RotateCw, Search, Upload, X } from "lucide-react";
import { shelfTagCounts, sortShelf, type ShelfLink } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import { formatKeyBinding, isMacPlatform } from "../shortcuts/key-utils";
import { filterShelf, linksLabel } from "./shelf-format";
import { ShelfRow } from "./ShelfRow";
import type { ShelfDialogState } from "./ShelfDialogs";
import type { ShelfController } from "./use-shelf";

/** Tag chips shown above the list; the selected ones always show, even past this count. */
const TAG_CHIP_LIMIT = 24;

export interface ShelfViewProps {
  shelf: ShelfController;
  onDialog: (state: ShelfDialogState) => void;
  /** Opens Add links with the link's address filled in (the app decides the group). */
  onSaveAsSource: (link: ShelfLink) => void;
}

/** The Shelf in the sheet: the heading, filter and tag chips, then the links, most used first. */
export function ShelfView({ shelf, onDialog, onSaveAsSource }: ShelfViewProps) {
  const { links, status, remove, togglePin, open, reload } = shelf;
  const [query, setQuery] = React.useState("");
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const filterRef = React.useRef<HTMLInputElement>(null);
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const addShortcut = formatKeyBinding("Mod+L", isMac);

  const now = new Date();
  const tagCounts = React.useMemo(() => shelfTagCounts(links), [links]);
  const visible = React.useMemo(
    () => sortShelf(filterShelf(links, query, selectedTags)),
    [links, query, selectedTags],
  );
  const filtering = query.trim() !== "" || selectedTags.length > 0;

  // A tag that no link carries any more stops filtering.
  React.useEffect(() => {
    setSelectedTags((prev) => {
      const next = prev.filter((tag) =>
        tagCounts.some((count) => count.tag.toLowerCase() === tag.toLowerCase()),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [tagCounts]);

  // The keyboard row: the focused one if it is still shown, else the first.
  const activeId = visible.some((link) => link.id === focusedId)
    ? focusedId
    : (visible[0]?.id ?? null);

  const focusRow = (id: string) => {
    setFocusedId(id);
    listRef.current?.querySelector<HTMLElement>(`[data-shelf-id="${CSS.escape(id)}"]`)?.focus();
  };

  const toggleTag = (tag: string) => {
    const key = tag.toLowerCase();
    setSelectedTags((prev) =>
      prev.some((t) => t.toLowerCase() === key)
        ? prev.filter((t) => t.toLowerCase() !== key)
        : [...prev, tag],
    );
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (visible.length === 0) return;
    if (!(e.target as HTMLElement).closest("[data-shelf-id]")) return;
    const index = visible.findIndex((link) => link.id === activeId);
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      focusRow(visible[Math.min(index + 1, visible.length - 1)].id);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      if (index <= 0) filterRef.current?.focus();
      else focusRow(visible[index - 1].id);
    }
  };

  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && visible.length > 0) {
      e.preventDefault();
      focusRow(visible[0].id);
    } else if (e.key === "Escape" && query) {
      e.stopPropagation();
      setQuery("");
    }
  };

  const countLine = filtering
    ? `${visible.length} of ${linksLabel(links.length)}`
    : linksLabel(links.length);

  const shownTags = React.useMemo(() => {
    const top = tagCounts.slice(0, TAG_CHIP_LIMIT);
    const extra = tagCounts.filter(
      (count) =>
        !top.includes(count) &&
        selectedTags.some((tag) => tag.toLowerCase() === count.tag.toLowerCase()),
    );
    return [...top, ...extra];
  }, [tagCounts, selectedTags]);

  return (
    <div className="@container/view flex min-h-0 flex-1 flex-col px-5 pt-7 @[720px]/view:px-9 @[720px]/view:pt-9">
      <header className="shrink-0">
        <div className="pb-1">
          <h1 className="min-w-0 font-serif text-[30px] font-medium leading-[36px] tracking-[-0.02em] text-foreground @[560px]/view:text-[40px] @[560px]/view:leading-[44px]">
            <span className="marker marker-sweep">Shelf</span>
          </h1>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1.5 pb-4">
          <span className="font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums">
            {status === "loading" && links.length === 0 ? "" : countLine}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => onDialog({ kind: "add" })}
              title={`Add to shelf (${addShortcut})`}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Add to shelf</span>
              <Kbd>{addShortcut}</Kbd>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More shelf actions"
                title="More shelf actions"
                className="flex size-8 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <MoreHorizontal className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => onDialog({ kind: "import" })}>
                  <Upload className="size-3.5" aria-hidden="true" />
                  Import bookmarks…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {links.length > 0 && (
          <>
            <div className="relative max-w-[420px] pb-3">
              <Search
                className="pointer-events-none absolute left-3 top-[calc(50%-6px)] size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={filterRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onFilterKeyDown}
                placeholder="Filter by title, address, note or tag"
                aria-label="Filter the shelf"
                className="h-9 bg-muted pl-9 dark:bg-muted [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>

            {shownTags.length > 0 && (
              <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-1.5 pb-4">
                {shownTags.map((count) => {
                  const selected = selectedTags.some(
                    (tag) => tag.toLowerCase() === count.tag.toLowerCase(),
                  );
                  return (
                    <button
                      key={count.tag}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(count.tag)}
                      className={cn(
                        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 font-sans text-[12.5px] transition-colors duration-100",
                        selected
                          ? "bg-marker-soft text-foreground shadow-raised"
                          : "bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {count.tag}
                      <span className="tabular-nums text-muted-foreground">{count.count}</span>
                      {selected && <X className="size-3" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </header>

      {status === "loading" && links.length === 0 ? (
        <div className="flex flex-col gap-1" aria-label="Loading your shelf" aria-busy="true">
          {[0, 1, 2, 3, 4].map((n) => (
            <div key={n} className="skeleton h-[52px] rounded-[10px]" />
          ))}
        </div>
      ) : status === "error" && links.length === 0 ? (
        <EmptyState
          compact
          icon={RotateCw}
          title="Couldn't load your shelf"
          description="Check your connection, then try again."
          actions={
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          }
        />
      ) : links.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title="Your shelf is empty"
          description="Keep sites you visit often here, with a note on each. Nothing is downloaded."
          actions={
            <>
              <Button size="sm" onClick={() => onDialog({ kind: "add" })}>
                <Plus className="size-3.5" aria-hidden="true" />
                <span>Add to shelf</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => onDialog({ kind: "import" })}>
                <Upload className="size-3.5" aria-hidden="true" />
                <span>Import bookmarks</span>
              </Button>
            </>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          compact
          icon={Search}
          title={`No titles match “${query.trim()}”.`}
          description="Try another word, or clear the filter and tags."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery("");
                setSelectedTags([]);
              }}
            >
              Clear filter
            </Button>
          }
        />
      ) : (
        <ul
          ref={listRef}
          role="list"
          aria-label="Shelf links"
          onKeyDown={onListKeyDown}
          className="-mx-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-4"
        >
          {visible.map((link: ShelfLink, index) => (
            <ShelfRow
              key={link.id}
              link={link}
              index={index}
              focused={link.id === activeId}
              now={now}
              onFocus={() => setFocusedId(link.id)}
              onOpen={() => void open(link)}
              onEdit={() => onDialog({ kind: "edit", link })}
              onTogglePin={() => togglePin(link)}
              onDelete={() => remove(link)}
              onSaveAsSource={() => onSaveAsSource(link)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
