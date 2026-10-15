import * as React from "react";
import { BookOpen, Command, FileText, Folder as FolderIcon, Layers, Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import type { Folder, Item, Project } from "@/lib/types";
import { filterFuzzy } from "./fuzzy";
import { SHORTCUT_COMMANDS, type ShortcutCommand } from "../shortcuts/registry";
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
        run: () => onExecuteCommand(cmd.id),
      });
    }

    // 2. Projects
    for (const p of projects) {
      list.push({
        id: `project:${p.id}`,
        type: "project",
        title: `Go to project: ${p.name}`,
        subtitle: "Project",
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
      list.push({
        id: `group:${g.id}`,
        type: "group",
        title: `Go to group: ${g.name}`,
        subtitle: "Group",
        run: () => onSelectFolder(g.id),
      });
    }

    // 4. Sources in current project / view
    for (const item of items) {
      list.push({
        id: `source:${item.id}`,
        type: "source",
        title: `Open source: ${item.title}`,
        subtitle: `Source • ${item.kind}`,
        run: () => onOpenItem(item),
      });
    }

    return list;
  }, [
    folders,
    items,
    isMac,
    activeProjectId,
    onExecuteCommand,
    onOpenItem,
    onSelectFolder,
    onSelectProject,
    projects,
  ]);

  // Filter and rank entries
  const filteredEntries = React.useMemo(() => {
    const recentIds = getRecentIds();
    const recentSet = new Set(recentIds);

    if (!query.trim()) {
      // Float recently used to top
      const recents: PaletteEntry[] = [];
      const others: PaletteEntry[] = [];

      for (const entry of allEntries) {
        if (recentSet.has(entry.id)) {
          recents.push(entry);
        } else {
          others.push(entry);
        }
      }

      recents.sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
      return [...recents, ...others];
    }

    // Fuzzy filter by title and subtitle
    return filterFuzzy(
      allEntries,
      query.trim(),
      (entry) => `${entry.title} ${entry.subtitle || ""}`,
    );
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
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>(
      `[data-palette-index="${selectedIndex}"]`,
    );
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleExecute = (entry: PaletteEntry) => {
    recordRecentId(entry.id);
    onOpenChange(false);
    entry.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j")) {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredEntries.length === 0 ? 0 : (prev + 1) % filteredEntries.length,
      );
    } else if (e.key === "ArrowUp" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
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

  const renderIcon = (type: PaletteActionType) => {
    switch (type) {
      case "command":
        return <Command className="size-4 shrink-0 text-primary" />;
      case "project":
        return <Layers className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />;
      case "group":
        return <FolderIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />;
      case "source":
        return <FileText className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />;
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
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search projects, groups, sources..."
            className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[380px] overflow-y-auto divide-y divide-border/50 py-1">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No matching commands or items.
            </div>
          ) : (
            filteredEntries.map((entry, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={entry.id}
                  data-palette-index={idx}
                  onClick={() => handleExecute(entry)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    "flex items-center justify-between gap-3 px-4 py-2.5 transition-colors cursor-pointer select-none",
                    isSelected
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-foreground hover:bg-muted/60",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {renderIcon(entry.type)}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-medium text-foreground">
                        {entry.title}
                      </span>
                      {entry.subtitle && (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {entry.subtitle}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Shortcut key glyphs */}
                  {entry.shortcut && (
                    <div className="shrink-0 flex items-center gap-1">
                      {splitComboForKbd(entry.combos?.[0] || entry.shortcut, isMac).map((k, i) => (
                        <kbd
                          key={i}
                          className="rounded border border-border bg-muted/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-sans font-semibold">↑↓</kbd> or{" "}
              <kbd className="font-sans font-semibold">Ctrl+J/K</kbd> to navigate
            </span>
            <span>
              <kbd className="font-sans font-semibold">↵</kbd> to run
            </span>
          </div>
          <span>
            <kbd className="font-sans font-semibold">Esc</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
