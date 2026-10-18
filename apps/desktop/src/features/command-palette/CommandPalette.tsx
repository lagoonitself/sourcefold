import * as React from "react";
import { Command, Folder as FolderIcon, Layers, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kbd } from "@/components/ui/Kbd";
import { getSourceKind, SourceTile } from "@/features/items/source-kinds";
import { buildFolderNames } from "@/features/search/labels";
import type { Folder, Item, Project } from "@/lib/types";
import { filterFuzzy } from "./fuzzy";
import { SHORTCUT_COMMANDS } from "../shortcuts/registry";
import { formatKeyBinding, isMacPlatform, splitComboForKbd } from "../shortcuts/key-utils";
import { cn } from "@/lib/utils";

const RECENT_COMMANDS_KEY = "sourcefold:recent-commands";

export type PaletteActionType = "command" | "project" | "group" | "source";

export interface PaletteEntry {
  id: string;
  type: PaletteActionType;
  title: string;
  subtitle?: string;
  shortcut?: string;
  combos?: string[];
  run: () => void;
  kind?: string;
  section?: string;
  keywords?: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  folders: Folder[];
  items: Item[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onOpenItem: (item: Item, options?: { forceExternal?: boolean }) => void;
  onExecuteCommand: (commandId: string) => void;
}

const SECTION_TITLES: Record<string, string> = {
  recent: "Recently used",
  command: "Commands",
  project: "Projects",
  group: "Groups",
  source: "Sources",
};

const rowClass = (selected: boolean) =>
  cn(
    "relative flex min-h-[48px] cursor-pointer select-none items-center justify-between gap-3 rounded-[10px] px-2.5 py-1.5 transition-colors duration-100",
    selected ? "bg-accent" : "hover:bg-muted",
  );

/** The 2px ink bar on the left of the row the arrow keys are on. */
function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-foreground"
    />
  );
}

function PaletteTile({ entry }: { entry: PaletteEntry }) {
  if (entry.type === "source") {
    return <SourceTile kind={entry.kind || "web"} className="shrink-0" />;
  }
  const Icon = entry.type === "command" ? Command : entry.type === "project" ? Layers : FolderIcon;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-muted text-foreground"
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function recordRecentId(id: string) {
  try {
    const recents = getRecentIds().filter((r) => r !== id);
    recents.unshift(id);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(recents.slice(0, 30)));
  } catch {
    // Ignore storage errors
  }
}

export function CommandPalette({
  open,
  onOpenChange,
  projects,
  folders,
  items,
  activeProjectId,
  onSelectProject,
  onSelectFolder,
  onOpenItem,
  onExecuteCommand,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const names = React.useMemo(() => buildFolderNames(folders), [folders]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Build full list of entries
  const allEntries = React.useMemo(() => {
    const list: PaletteEntry[] = [];

    // 1. Static registry commands (exclude palette and escape)
    for (const cmd of SHORTCUT_COMMANDS) {
      if (cmd.id === "app.command-palette" || cmd.id === "app.escape") continue;
      const primaryCombo = cmd.combos[0];
      list.push({
        id: cmd.id,
        type: "command",
        title: cmd.title,
        subtitle: cmd.description || cmd.group,
        shortcut: primaryCombo ? formatKeyBinding(primaryCombo, isMac) : undefined,
        combos: cmd.combos,
        keywords: `${cmd.id} ${cmd.group || ""}`,
        run: () => onExecuteCommand(cmd.id),
      });
    }

    // 2. Projects
    for (const p of projects) {
      list.push({
        id: `project:${p.id}`,
        type: "project",
        title: p.name,
        subtitle: "Project",
        keywords: `project go to project ${p.name}`,
        run: () => onSelectProject(p.id),
      });
    }

    // 3. Groups in current project
    const currentProjectGroups = folders.filter((f) => {
      if (f.deleted_at || f.archived_at) return false;
      return (
        f.parent_id === activeProjectId ||
        folders.some((p) => p.id === f.parent_id && p.parent_id === activeProjectId)
      );
    });

    for (const g of currentProjectGroups) {
      const parentName = g.parent_id ? names.groupName(g.parent_id) : null;
      list.push({
        id: `group:${g.id}`,
        type: "group",
        title: g.name,
        subtitle: parentName && parentName !== "Group" ? parentName : "Group",
        keywords: `group go to group ${g.name}`,
        run: () => onSelectFolder(g.id),
      });
    }

    // 4. Sources in current project / view
    for (const item of items) {
      const groupName = names.groupName(item.folder_id);
      const kindName = getSourceKind(item.kind).name;
      list.push({
        id: `source:${item.id}`,
        type: "source",
        title: item.title,
        subtitle: groupName,
        kind: item.kind,
        keywords: `source open source ${kindName} ${item.kind} ${item.source_url ?? ""}`,
        run: () => onOpenItem(item),
      });
    }

    return list;
  }, [
    folders,
    items,
    isMac,
    names,
    activeProjectId,
    onExecuteCommand,
    onOpenItem,
    onSelectFolder,
    onSelectProject,
    projects,
  ]);

  // Filter, group and rank entries
  const filteredEntries = React.useMemo(() => {
    const trimmed = query.trim();
    const recentIds = getRecentIds();
    const recentSet = new Set(recentIds);

    if (!trimmed) {
      // Float recently used to top
      const recents: PaletteEntry[] = [];
      const others: PaletteEntry[] = [];

      for (const entry of allEntries) {
        if (recentSet.has(entry.id)) {
          recents.push({ ...entry, section: "recent" });
        } else {
          others.push({ ...entry, section: entry.type });
        }
      }

      recents.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));

      // Group others in order: Commands, Projects, Groups, Sources
      const sectionOrder: PaletteActionType[] = ["command", "project", "group", "source"];
      const groupedOthers: PaletteEntry[] = [];
      for (const type of sectionOrder) {
        for (const entry of others) {
          if (entry.type === type) {
            groupedOthers.push(entry);
          }
        }
      }

      return [...recents, ...groupedOthers];
    }

    // Fuzzy filter by title, subtitle, and search keywords
    const matches = filterFuzzy(
      allEntries,
      trimmed,
      (entry) => `${entry.title} ${entry.subtitle || ""} ${entry.keywords || ""}`,
    );

    // Group matching results in order: Commands, Projects, Groups, Sources
    const sectionOrder: PaletteActionType[] = ["command", "project", "group", "source"];
    const grouped: PaletteEntry[] = [];
    for (const type of sectionOrder) {
      for (const entry of matches) {
        if (entry.type === type) {
          grouped.push({ ...entry, section: type });
        }
      }
    }
    for (const entry of matches) {
      if (!sectionOrder.includes(entry.type)) {
        grouped.push({ ...entry, section: entry.type });
      }
    }

    return grouped;
  }, [allEntries, query]);

  // Keep selected index within bounds
  React.useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredEntries.length === 0) return 0;
      return Math.min(prev, filteredEntries.length - 1);
    });
  }, [filteredEntries.length]);

  // Scroll active item into view
  React.useEffect(() => {
    if (selectedIndex === 0 && listRef.current) {
      listRef.current.scrollTop = 0;
    } else {
      const activeEl = listRef.current?.querySelector<HTMLElement>(
        `[data-palette-index="${selectedIndex}"]`,
      );
      activeEl?.scrollIntoView?.({ block: "nearest" });
    }
  }, [selectedIndex, filteredEntries]);

  const handleExecute = (entry: PaletteEntry) => {
    recordRecentId(entry.id);
    onOpenChange(false);
    entry.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown" || (mod && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredEntries.length === 0 ? 0 : (prev + 1) % filteredEntries.length,
      );
    } else if (e.key === "ArrowUp" || (mod && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredEntries.length === 0
          ? 0
          : (prev - 1 + filteredEntries.length) % filteredEntries.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredEntries[selectedIndex]) {
        handleExecute(filteredEntries[selectedIndex]);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Spotlight placement: the overlay centres its box, so the box pins itself to the top at 14vh. */}
      <DialogContent
        className="mt-[calc(14vh-16px)] flex max-h-[calc(100dvh-14vh)] max-w-[640px] flex-col self-start overflow-hidden bg-popover p-0 shadow-float"
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border pl-4 pr-12">
          <Search className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search projects, groups, sources..."
            aria-label="Command palette"
            role="combobox"
            aria-expanded={filteredEntries.length > 0}
            aria-controls="palette-results"
            aria-activedescendant={
              filteredEntries.length > 0 ? `palette-row-${selectedIndex}` : undefined
            }
            className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Commands and items"
          className="min-h-0 max-h-[420px] scroll-py-2 overflow-y-auto p-2"
        >
          {filteredEntries.length === 0 && (
            <EmptyState
              compact
              icon={Command}
              title={
                query.trim() ? `No commands match “${query.trim()}”.` : "No commands available."
              }
              description="Check the spelling, or try a different search."
            />
          )}

          {filteredEntries.map((entry, idx) => {
            const isSelected = idx === selectedIndex;
            const startsSection = idx === 0 || entry.section !== filteredEntries[idx - 1].section;
            const sectionTitle =
              entry.section && SECTION_TITLES[entry.section] ? SECTION_TITLES[entry.section] : null;

            return (
              <React.Fragment key={entry.id}>
                {startsSection && sectionTitle && (
                  <div
                    role="presentation"
                    className={cn(
                      "px-2.5 pb-1 text-xs font-medium leading-4 text-muted-foreground",
                      idx === 0 ? "pt-1" : "pt-3",
                    )}
                  >
                    {sectionTitle}
                  </div>
                )}
                <div
                  id={`palette-row-${idx}`}
                  data-palette-index={idx}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleExecute(entry)}
                  onMouseMove={() => {
                    if (!isSelected) setSelectedIndex(idx);
                  }}
                  className={rowClass(isSelected)}
                >
                  {isSelected && <ActiveBar />}
                  <PaletteTile entry={entry} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        "truncate font-medium text-foreground",
                        entry.type === "source"
                          ? "font-serif text-[15px] leading-[22px] tracking-[-0.005em]"
                          : "font-sans text-[13.5px] leading-[20px]",
                      )}
                    >
                      {entry.title}
                    </span>
                    {entry.subtitle && (
                      <span className="truncate text-[12.5px] leading-[18px] text-muted-foreground">
                        {entry.subtitle}
                      </span>
                    )}
                  </div>

                  {/* Shortcut key glyphs for commands */}
                  {entry.type === "command" && entry.shortcut && (
                    <div className="flex shrink-0 items-center gap-1">
                      {splitComboForKbd(entry.combos?.[0] || entry.shortcut, isMac).map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </div>
                  )}

                  {/* Source kind label */}
                  {entry.type === "source" && entry.kind && (
                    <div className="flex shrink-0 items-center gap-2 text-[12.5px] leading-[18px] text-muted-foreground">
                      <span>{getSourceKind(entry.kind).name}</span>
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="flex h-9 shrink-0 items-center justify-between gap-x-4 border-t border-border px-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Kbd>↑↓</Kbd> to move, <Kbd>Enter</Kbd> to run, <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
