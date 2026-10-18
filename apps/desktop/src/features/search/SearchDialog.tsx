import * as React from "react";
import { ExternalLink, MessageSquare, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
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
    "relative flex cursor-pointer select-none items-start justify-between gap-3 py-2.5 pl-5 pr-4 transition-colors",
    selected ? "bg-accent text-accent-foreground" : "hover:bg-muted/60",
  );

function TypeBar({ kind }: { kind: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute inset-y-0 left-0 w-[3px]", getSourceKind(kind).barClass)}
    />
  );
}

function Snippet({ text }: { text: string }) {
  const segments = splitSnippet(text);
  if (segments.length === 0) return null;
  return (
    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
      {segments.map((segment, i) =>
        segment.bold ? (
          <strong key={i} className="font-semibold text-foreground">
            {segment.text}
          </strong>
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
  return (
    <>
      <TypeBar kind={item.kind} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate font-serif text-[15px] font-medium text-foreground">
            {item.title}
          </span>
          {item.note && (
            <span title="Has note" className="text-muted-foreground">
              <MessageSquare className="size-3" aria-hidden="true" />
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{getSourceKind(item.kind).name}</span>
          <span aria-hidden="true">&bull;</span>
          <span className="shrink-0">{names.groupName(item.folder_id)}</span>
          {showProject && projectId && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="shrink-0">{names.projectName(projectId)}</span>
            </>
          )}
          {item.source_url && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="max-w-[200px] truncate">{item.source_url}</span>
            </>
          )}
        </div>
      </div>
      {item.source_url && (
        <ExternalLink
          className={cn(
            "mt-1 size-3.5 shrink-0",
            selected ? "text-accent-foreground" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      )}
    </>
  );
}

function HitRowView({
  hit,
  label,
  names,
  showProject,
}: {
  hit: PassageHit | NoteHit;
  /** "Highlight" or "Note" for notes; nothing for passages. */
  label: string | null;
  names: FolderNames;
  showProject: boolean;
}) {
  const heading = "heading" in hit ? hit.heading : "";
  return (
    <>
      <TypeBar kind={hit.kind} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-serif text-[15px] font-medium text-foreground">
            {hit.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {getSourceKind(hit.kind).name}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {label && (
            <>
              <span className="shrink-0 font-medium">{label}</span>
              <span aria-hidden="true">&bull;</span>
            </>
          )}
          <span className="shrink-0">{names.groupName(hit.folder_id)}</span>
          {showProject && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="shrink-0">{names.projectName(hit.project_id)}</span>
            </>
          )}
          {heading && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="truncate">{heading}</span>
            </>
          )}
          {hit.kind === "youtube" && hit.seconds !== null && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="shrink-0 tabular-nums">{formatTimestamp(hit.seconds)}</span>
            </>
          )}
          {hit.matched === "meaning" && (
            <>
              <span aria-hidden="true">&bull;</span>
              <span className="shrink-0 font-medium">Similar meaning</span>
            </>
          )}
        </div>
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
    document.getElementById(`search-row-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[580px] overflow-hidden border-border bg-card p-0 shadow-float"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border py-3 pl-4 pr-12">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
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
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={switchScope}
            disabled={!projectId}
            aria-label={`Searching ${scopeLabel.toLowerCase()}. Press Tab to switch.`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground transition-colors enabled:hover:bg-accent disabled:opacity-70"
          >
            {scopeLabel}
            {projectId && (
              <kbd className="rounded-[4px] border border-border bg-card px-1 text-[10px] font-medium text-muted-foreground">
                Tab
              </kbd>
            )}
          </button>
        </div>

        {notice && (
          <div
            role="status"
            className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
          >
            {notice}
          </div>
        )}

        <div
          ref={listRef}
          id="search-results"
          role="listbox"
          aria-label="Search results"
          className="max-h-[420px] overflow-y-auto"
        >
          {showEmpty && (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {desktop && !notice
                ? `No sources mention "${trimmed}".`
                : `No titles match "${trimmed}".`}
            </div>
          )}

          {rows.map((row, idx) => {
            const selected = idx === selectedIndex;
            const startsSection = idx === 0 || rows[idx - 1].type !== row.type;
            return (
              <React.Fragment key={row.key}>
                {startsSection && (
                  <div
                    role="presentation"
                    className="border-t border-border bg-muted/30 px-4 py-1 text-xs font-medium text-muted-foreground first:border-t-0"
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
                  className={cn(
                    rowClass(selected),
                    idx > 0 && !startsSection && "border-t border-border",
                  )}
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
                      names={names}
                      showProject={showProject}
                    />
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-t border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground">
          <span>↑↓ to navigate, Enter to open{projectId ? ", Tab to switch" : ""}</span>
          {(footer.index || footer.meaning) && (
            <span className="flex flex-wrap gap-x-3" aria-live="polite">
              {footer.index && <span>{footer.index}</span>}
              {footer.meaning && <span>{footer.meaning}</span>}
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
