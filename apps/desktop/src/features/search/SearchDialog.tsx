import * as React from "react";
import { ExternalLink, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kbd } from "@/components/ui/Kbd";
import { getSourceKind } from "@/features/items/source-kinds";
import type { Folder, Item } from "@/lib/types";
import { isTauri } from "@/lib/api";
import { openUrl, cn } from "@/lib/utils";
import { useMeaningSearch } from "./embedding";
import { buildFolderNames, footerStatus, indexNotice, type FolderNames } from "./labels";
import { buildRows, SECTION_TITLES, selectedIndexOf, stepIndex, type SearchRow } from "./rows";
import type { NoteHit, PassageHit, SearchScope } from "./search-api";
import { formatTimestamp, splitSnippet } from "./snippet";
import { useIndexStatus } from "./use-index-status";
import { useSearch } from "./use-search";

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: Folder[];
  currentProjectId?: string | null;
  onSelectItem?: (item: Item) => void;
  /** Enter on a passage, highlight or note: open that source at that place. `query` is the text to mark. */
  onOpenHit?: (hit: PassageHit | NoteHit, query: string) => void;
}

const rowClass = (selected: boolean) =>
  cn(
    "relative flex min-h-[52px] cursor-pointer select-none items-start justify-between gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-100",
    selected ? "bg-accent" : "hover:bg-muted",
  );

/** The tinted tile that stands for a source type; the kind's name is always written on the row too. */
function KindTile({ kind }: { kind: string }) {
  const { Icon, colorVar } = getSourceKind(kind);
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[8px]"
      style={{
        backgroundColor: `color-mix(in oklab, ${colorVar} 12%, transparent)`,
        color: colorVar,
      }}
    >
      <Icon className="size-4" aria-hidden={true} />
    </span>
  );
}

/** The 2px ink bar on the left of the row the arrow keys are on. */
function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-2.5 left-0 w-[2px] rounded-full bg-foreground"
    />
  );
}

interface MetaPart {
  text: string;
  className?: string;
}

/** One muted line of facts joined with commas, cut off with an ellipsis when it runs out of room. */
function MetaLine({ parts }: { parts: MetaPart[] }) {
  return (
    <p className="mt-0.5 truncate text-[12.5px] leading-[18px] text-muted-foreground">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          <span className={part.className}>{part.text}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

function Snippet({ text }: { text: string }) {
  const segments = splitSnippet(text);
  if (segments.length === 0) return null;
  return (
    <p className="mt-1 line-clamp-2 text-[13px] leading-[19px] text-muted-foreground">
      {segments.map((segment, i) =>
        segment.bold ? (
          <mark
            key={i}
            className="rounded-[3px] bg-marker-soft px-0.5 font-semibold text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

function SourceRowView({
  item,
  selected,
  names,
  showProject,
}: {
  item: Item;
  selected: boolean;
  names: FolderNames;
  showProject: boolean;
}) {
  const projectId = names.projectOf(item.folder_id);
  const parts: MetaPart[] = [{ text: names.groupName(item.folder_id) }];
  if (showProject && projectId) parts.push({ text: names.projectName(projectId) });
  if (item.source_url) parts.push({ text: item.source_url });
  return (
    <>
      {selected && <ActiveBar />}
      <KindTile kind={item.kind} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate font-serif text-[15px] font-medium leading-[22px] tracking-[-0.005em] text-foreground">
            {item.title}
          </span>
          {item.note && (
            <span title="Has note" className="text-muted-foreground">
              <MessageSquare className="size-3" aria-hidden="true" />
            </span>
          )}
        </div>
        <MetaLine parts={parts} />
      </div>
      <div className="mt-1 flex shrink-0 items-center gap-2 text-[12.5px] leading-[18px] text-muted-foreground">
        <span>{getSourceKind(item.kind).name}</span>
        {item.source_url && <ExternalLink className="size-3.5" aria-hidden="true" />}
      </div>
    </>
  );
}

function HitRowView({
  hit,
  label,
  selected,
  names,
  showProject,
}: {
  hit: PassageHit | NoteHit;
  /** "Highlight" or "Note" for notes; nothing for passages. */
  label: string | null;
  selected: boolean;
  names: FolderNames;
  showProject: boolean;
}) {
  const heading = "heading" in hit ? hit.heading : "";
  const parts: MetaPart[] = [];
  if (label) parts.push({ text: label, className: "font-medium text-foreground" });
  parts.push({ text: names.groupName(hit.folder_id) });
  if (showProject) parts.push({ text: names.projectName(hit.project_id) });
  if (heading) parts.push({ text: heading });
  if (hit.kind === "youtube" && hit.seconds !== null) {
    parts.push({ text: formatTimestamp(hit.seconds), className: "tabular-nums" });
  }
  if (hit.matched === "meaning") parts.push({ text: "Similar meaning", className: "font-medium" });
  return (
    <>
      {selected && <ActiveBar />}
      <KindTile kind={hit.kind} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-serif text-[15px] font-medium leading-[22px] tracking-[-0.005em] text-foreground">
            {hit.title}
          </span>
          <span className="shrink-0 text-[12.5px] leading-[18px] text-muted-foreground">
            {getSourceKind(hit.kind).name}
          </span>
        </div>
        <MetaLine parts={parts} />
        <Snippet text={hit.snippet} />
      </div>
    </>
  );
}

export function SearchDialog({
  open,
  onOpenChange,
  folders,
  currentProjectId,
  onSelectItem,
  onOpenHit,
}: SearchDialogProps) {
  const [query, setQuery] = React.useState("");
  const [scope, setScope] = React.useState<SearchScope>("project");
  // The row the arrow keys are on, by key, so a new answer keeps it on the same row if listed.
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const projectId = currentProjectId ?? null;
  // Without an open project there is nothing for "This project" to mean.
  const effectiveScope: SearchScope = projectId ? scope : "all";
  const desktop = isTauri();

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedKey(null);
    }
  }, [open]);

  const trimmed = query.trim();
  const search = useSearch({ open, query, scope: effectiveScope, projectId });
  const status = useIndexStatus(open, effectiveScope === "project" ? projectId : null);
  const meaning = useMeaningSearch();
  const names = React.useMemo(() => buildFolderNames(folders), [folders]);

  const rows = React.useMemo(
    () => buildRows(search.sources, search.passages, search.notes),
    [search.sources, search.passages, search.notes],
  );
  const selectedIndex = selectedIndexOf(rows, selectedKey);
  const showProject = effectiveScope === "all";

  React.useEffect(() => {
    // The first row sits under its section label; scrolling to the top keeps the label in view.
    if (selectedIndex === 0 && listRef.current) listRef.current.scrollTop = 0;
    else document.getElementById(`search-row-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, rows]);

  const openRow = (row: SearchRow) => {
    if (row.type === "source") {
      if (onSelectItem) onSelectItem(row.item);
      else if (row.item.source_url) openUrl(row.item.source_url);
    } else {
      onOpenHit?.(row.hit, search.passagesFor || trimmed);
    }
    onOpenChange(false);
  };

  const switchScope = () => {
    if (!projectId) return;
    setScope(effectiveScope === "project" ? "all" : "project");
    setSelectedKey(null);
  };

  const moveSelection = (delta: 1 | -1) => {
    const next = stepIndex(selectedIndex, delta, rows.length);
    setSelectedKey(rows[next]?.key ?? null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Tab") {
      e.preventDefault();
      switchScope();
      // The dialog's focus trap runs right after this and would move focus to the close button.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (e.key === "ArrowDown" || (mod && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp" || (mod && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[selectedIndex];
      if (row) openRow(row);
    }
  };

  const notice = desktop ? indexNotice(status) : null;
  const footer = footerStatus(status, meaning.enabled);
  const scopeLabel = effectiveScope === "project" ? "This project" : "All projects";
  const showEmpty = trimmed !== "" && rows.length === 0 && !search.pending;
  const showIdle = trimmed === "" && rows.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Spotlight placement: the overlay centres its box, so the box pins itself to the top at 14vh. */}
      <DialogContent
        className="mt-[calc(14vh-16px)] flex max-h-[calc(100dvh-14vh)] max-w-[640px] flex-col self-start overflow-hidden bg-popover p-0 shadow-float"
        onKeyDown={handleKeyDown}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border pl-4 pr-12">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedKey(null);
            }}
            placeholder={
              desktop
                ? "Search titles and the text of every source"
                : "Search titles, notes, or URLs..."
            }
            aria-label="Search sources"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="search-results"
            aria-activedescendant={rows.length > 0 ? `search-row-${selectedIndex}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={switchScope}
            disabled={!projectId}
            aria-label={`Searching ${scopeLabel.toLowerCase()}. Press Tab to switch.`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-muted pl-2.5 pr-1.5 text-[12.5px] font-medium text-foreground transition-colors duration-100 enabled:hover:bg-accent disabled:pr-2.5 disabled:text-muted-foreground"
          >
            {scopeLabel}
            {projectId && <Kbd>Tab</Kbd>}
          </button>
        </div>

        {notice && (
          <div
            role="status"
            className="shrink-0 border-b border-border bg-muted/50 px-4 py-2 text-[12.5px] text-muted-foreground"
          >
            {notice}
          </div>
        )}

        <div
          ref={listRef}
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="min-h-0 max-h-[420px] scroll-py-2 overflow-y-auto p-2"
        >
          {showEmpty && (
            <EmptyState
              compact
              icon={Search}
              title={
                desktop && !notice
                  ? `No sources mention “${trimmed}”.`
                  : `No titles match “${trimmed}”.`
              }
              description="Check the spelling, or try a shorter word."
            />
          )}

          {showIdle && (
            <EmptyState
              compact
              icon={Search}
              title="Search your sources"
              description={
                desktop
                  ? "Type a title, or a word from inside any saved source."
                  : "Type a title, a note or part of a link."
              }
            />
          )}

          {rows.map((row, idx) => {
            const selected = idx === selectedIndex;
            const startsSection = idx === 0 || rows[idx - 1].type !== row.type;
            return (
              <React.Fragment key={row.key}>
                {startsSection && (
                  <div
                    role="presentation"
                    className={cn(
                      "px-2.5 pb-1 text-xs font-medium leading-4 text-muted-foreground",
                      idx === 0 ? "pt-1" : "pt-3",
                    )}
                  >
                    {SECTION_TITLES[row.type]}
                  </div>
                )}
                <div
                  id={`search-row-${idx}`}
                  role="option"
                  aria-selected={selected}
                  onClick={() => openRow(row)}
                  onMouseMove={() => {
                    if (!selected) setSelectedKey(row.key);
                  }}
                  className={rowClass(selected)}
                >
                  {row.type === "source" ? (
                    <SourceRowView
                      item={row.item}
                      selected={selected}
                      names={names}
                      showProject={showProject}
                    />
                  ) : (
                    <HitRowView
                      hit={row.hit}
                      label={
                        row.type === "note"
                          ? row.hit.source === "highlight"
                            ? "Highlight"
                            : "Note"
                          : null
                      }
                      selected={selected}
                      names={names}
                      showProject={showProject}
                    />
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between gap-x-4 border-t border-border px-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Kbd>↑↓</Kbd> to move, <Kbd>Enter</Kbd> to open, <Kbd>Esc</Kbd> to close
          </span>
          {(footer.index || footer.meaning) && (
            <span
              className="flex min-w-0 flex-wrap justify-end gap-x-3 tabular-nums"
              aria-live="polite"
            >
              {footer.index && <span>{footer.index}</span>}
              {footer.meaning && <span>{footer.meaning}</span>}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
