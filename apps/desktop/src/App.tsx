import * as React from "react";
import {
  BookOpen,
  Command,
  FolderOpen,
  HelpCircle,
  Plus,
  Settings as SettingsIcon,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ProjectSwitcher } from "@/features/projects/ProjectSwitcher";
import { FolderTree } from "@/features/folders/FolderTree";
import { ItemList } from "@/features/items/ItemList";
import { GroupHeader, SubgroupList } from "@/features/items/GroupHeader";
import { dispatchGroupAction, groupActionForCommand } from "@/features/items/group-actions";
import { AddLinksDialog } from "@/features/grokipedia/AddLinksDialog";
import { SearchDialog } from "@/features/search/SearchDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { NoteDialog } from "@/features/items/NoteDialog";
import { ReaderModal } from "@/features/reader/ReaderModal";
import { openSource, opensInReader } from "@/features/reader/open-decision";
import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { KeyboardShortcutsDialog, useKeyboardShortcuts } from "@/features/shortcuts";
import { isMacPlatform, matchesKeyCombo } from "@/features/shortcuts/key-utils";
import type { Folder, Item } from "@/lib/types";
import { archiveProject, getFolders, getItems, openImage } from "@/lib/api";
import { isSessionExpiredError } from "@/lib/remote-client";
import { triggerDriveSave } from "@/features/drive/drive-api";
import { openUrl, cn, errorMessage } from "@/lib/utils";

export function App() {
  const isMac = React.useMemo(() => isMacPlatform(), []);

  // Theme state
  const [theme, setTheme] = React.useState<"light" | "dark" | "system">(() => {
    try {
      const stored = localStorage.getItem("sourcefold:theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
      }
    } catch {}
    return "system";
  });

  React.useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme() {
      const isDark = theme === "dark" || (theme === "system" && mediaQuery.matches);
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  const handleThemeChange = (newTheme: "light" | "dark" | "system") => {
    setTheme(newTheme);
    try {
      localStorage.setItem("sourcefold:theme", newTheme);
    } catch {}
  };

  // State: Projects and folders
  const [folders, setFolders] = React.useState<Folder[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(null);
  const [focusedFolderId, setFocusedFolderId] = React.useState<string | null>(null);

  // State: Items in active group
  const [items, setItems] = React.useState<Item[]>([]);
  const [focusedItemId, setFocusedItemId] = React.useState<string | null>(null);

  // Active region for keyboard shortcuts
  const [activeRegion, setActiveRegion] = React.useState<"tree" | "list">("list");

  // Dialogs
  const [commandPaletteOpen, setCommandPaletteOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [addLinksOpen, setAddLinksOpen] = React.useState(false);
  const [newNoteOpen, setNewNoteOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = React.useState(false);
  const [readerItem, setReaderItem] = React.useState<Item | null>(null);

  // Archive project confirm dialog
  const [archiveConfirmOpen, setArchiveConfirmOpen] = React.useState(false);

  // The latest ids, readable from callbacks without making them depend on every selection change.
  const activeProjectIdRef = React.useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const activeFolderIdRef = React.useRef(activeFolderId);
  activeFolderIdRef.current = activeFolderId;
  const focusedItemIdRef = React.useRef(focusedItemId);
  focusedItemIdRef.current = focusedItemId;
  // Only the newest response may update state (a sign-in or sign-out can overlap a slow request).
  const foldersRequestRef = React.useRef(0);
  const itemsRequestRef = React.useRef(0);

  // Load folders / projects. Also repairs the selection when what it points at is gone, e.g.
  // after signing in or out switches the data source.
  const refreshFolders = React.useCallback(async () => {
    const requestId = ++foldersRequestRef.current;
    try {
      const allFolders = await getFolders(true);
      if (requestId !== foldersRequestRef.current) return;
      setFolders(allFolders);

      const byId = new Map(allFolders.map((f) => [f.id, f]));
      const rootIdOf = (id: string): string | null => {
        let current = byId.get(id);
        for (let depth = 0; current && depth < 1000; depth++) {
          if (!current.parent_id) return current.id;
          current = byId.get(current.parent_id);
        }
        return null;
      };

      const currentProject = activeProjectIdRef.current;
      const projectStillExists = Boolean(
        currentProject && byId.has(currentProject) && !byId.get(currentProject)?.parent_id,
      );
      const nextProject = projectStillExists
        ? currentProject
        : (allFolders.find((f) => !f.parent_id && !f.archived_at)?.id ?? null);
      if (nextProject !== currentProject) setActiveProjectId(nextProject);

      const currentFolder = activeFolderIdRef.current;
      if (currentFolder && (!nextProject || rootIdOf(currentFolder) !== nextProject)) {
        setActiveFolderId(null);
        setItems([]);
        setFocusedItemId(null);
      }
      setFocusedFolderId((prev) =>
        prev && nextProject && rootIdOf(prev) === nextProject ? prev : null,
      );
    } catch (err: any) {
      if (!isSessionExpiredError(err)) toast.error(err.message || "Failed to load folders");
    }
  }, []);

  React.useEffect(() => {
    void refreshFolders();
  }, [refreshFolders]);

  // Load items when activeFolderId changes
  const refreshItems = React.useCallback(async () => {
    const requestId = ++itemsRequestRef.current;
    if (!activeFolderId) {
      setItems([]);
      setFocusedItemId(null);
      return;
    }
    try {
      const data = await getItems(activeFolderId);
      if (requestId !== itemsRequestRef.current) return;
      setItems(data);
      const focused = focusedItemIdRef.current;
      if (data.length > 0 && !(focused && data.some((i) => i.id === focused))) {
        setFocusedItemId(data[0].id);
      }
    } catch (err: any) {
      if (!isSessionExpiredError(err)) toast.error(err.message || "Failed to load items");
    }
  }, [activeFolderId]);

  React.useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  // Periodic / on-focus refreshes (signed in) reload both lists. Signing in or out swaps the data
  // source, so drop everything shown from the old one before reloading.
  React.useEffect(() => {
    const handleRefreshEvent = () => {
      void refreshFolders();
      void refreshItems();
    };
    const handleAuthChanged = () => {
      setItems([]);
      setFocusedItemId(null);
      setReaderItem(null);
      handleRefreshEvent();
    };
    window.addEventListener("sourcefold:refresh", handleRefreshEvent);
    window.addEventListener("sourcefold:auth-changed", handleAuthChanged);
    return () => {
      window.removeEventListener("sourcefold:refresh", handleRefreshEvent);
      window.removeEventListener("sourcefold:auth-changed", handleAuthChanged);
    };
  }, [refreshFolders, refreshItems]);

  // Active project object
  const currentProject = React.useMemo(() => {
    return folders.find((f) => f.id === activeProjectId);
  }, [folders, activeProjectId]);

  // Active projects list for shortcuts (Alt+1..9)
  const activeProjects = React.useMemo(() => {
    return folders.filter((f) => !f.parent_id && !f.archived_at);
  }, [folders]);

  // Has at least one project?
  const hasProjects = activeProjects.length > 0;

  // Groups under current project
  const projectGroups = React.useMemo(() => {
    if (!activeProjectId) return [];
    return folders.filter((f) => f.parent_id === activeProjectId);
  }, [folders, activeProjectId]);

  // Project with no groups check
  const isProjectWithNoGroups = projectGroups.length === 0;

  // Handle selecting a project
  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    // Find first group under this project if any
    const firstGroup = folders.find((f) => f.parent_id === projectId);
    if (firstGroup) {
      setActiveFolderId(firstGroup.id);
      setFocusedFolderId(firstGroup.id);
    } else {
      setActiveFolderId(null);
      setFocusedFolderId(null);
    }
    setActiveRegion("tree");
  };

  // Switch between sibling groups: [ and ] shortcuts
  const handlePreviousGroup = React.useCallback(() => {
    if (projectGroups.length === 0) return;
    const currentIndex = projectGroups.findIndex((g) => g.id === activeFolderId);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : projectGroups.length - 1;
    setActiveFolderId(projectGroups[prevIndex].id);
    setFocusedFolderId(projectGroups[prevIndex].id);
  }, [projectGroups, activeFolderId]);

  const handleNextGroup = React.useCallback(() => {
    if (projectGroups.length === 0) return;
    const currentIndex = projectGroups.findIndex((g) => g.id === activeFolderId);
    const nextIndex = currentIndex < projectGroups.length - 1 ? currentIndex + 1 : 0;
    setActiveFolderId(projectGroups[nextIndex].id);
    setFocusedFolderId(projectGroups[nextIndex].id);
  }, [projectGroups, activeFolderId]);

  // Action: Save to Google Drive
  const handleSaveToDrive = React.useCallback(async () => {
    try {
      toast.info("Saving to Google Drive...");
      const result = await triggerDriveSave();
      if (result.processed > 0) {
        toast.success(
          `Processed ${result.processed} item${result.processed === 1 ? "" : "s"} for Google Drive`,
        );
      } else if (result.remaining === 0) {
        toast.info("All items are already up to date in Drive");
      } else {
        toast.info("No unsaved items to upload");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to save to Google Drive");
    }
  }, []);

  // Action: Refresh
  const handleRefresh = React.useCallback(async () => {
    await refreshFolders();
    await refreshItems();
  }, [refreshFolders, refreshItems]);

  // Action: Toggle project archive
  const handleToggleArchiveProject = React.useCallback(async () => {
    if (!currentProject) return;
    const newArchived = !currentProject.archived_at;
    try {
      await archiveProject(currentProject.id, newArchived);
      toast.success(newArchived ? "Project archived" : "Project unarchived");
      setArchiveConfirmOpen(false);
      await refreshFolders();

      // If we archived active project, select next available project
      if (newArchived) {
        const next = activeProjects.find((p) => p.id !== currentProject.id);
        if (next) {
          handleSelectProject(next.id);
        } else {
          setActiveProjectId(null);
          setActiveFolderId(null);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update project archive status");
    }
  }, [currentProject, activeProjects, refreshFolders]);

  // Prevent browser reload (Mod+R, F5) and print (Mod+P) everywhere in the window
  React.useEffect(() => {
    const handlePreventBrowserDefaults = (e: KeyboardEvent) => {
      if (matchesKeyCombo(e, "Mod+P")) {
        e.preventDefault();
      }
      if (matchesKeyCombo(e, "Mod+R") || matchesKeyCombo(e, "F5")) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handlePreventBrowserDefaults, true);
    return () => window.removeEventListener("keydown", handlePreventBrowserDefaults, true);
  }, []);

  // Execute commands from Command Palette
  const handleExecuteCommand = React.useCallback(
    (cmdId: string) => {
      switch (cmdId) {
        case "app.command-palette":
          setCommandPaletteOpen((prev) => !prev);
          break;
        case "app.search":
          setSearchOpen(true);
          break;
        case "app.add-links":
          if (activeFolderId && !isProjectWithNoGroups) setAddLinksOpen(true);
          else toast.info("Select a group first to add links");
          break;
        case "app.new-note":
          if (activeFolderId) setNewNoteOpen(true);
          else toast.info("Select a group first to create a note");
          break;
        case "app.save-to-drive":
          void handleSaveToDrive();
          break;
        case "app.settings":
          setSettingsOpen(true);
          break;
        case "app.refresh":
          void handleRefresh();
          toast.success("Refreshed");
          break;
        case "app.help":
          setShortcutsOpen(true);
          break;
        case "projects.switcher":
          setProjectSwitcherOpen((prev) => !prev);
          break;
        case "projects.archive-toggle":
          if (currentProject) setArchiveConfirmOpen(true);
          break;
        case "nav.focus-tree":
          setActiveRegion("tree");
          break;
        case "nav.focus-list":
          setActiveRegion("list");
          break;
        case "nav.cycle-focus":
          setActiveRegion((r) => (r === "tree" ? "list" : "tree"));
          break;
        case "nav.prev-group":
          handlePreviousGroup();
          break;
        case "nav.next-group":
          handleNextGroup();
          break;
        default: {
          const groupAction = groupActionForCommand(cmdId);
          if (!groupAction) break;
          if (activeFolderId) {
            setActiveRegion("list");
            dispatchGroupAction(groupAction);
          } else {
            toast.info("Select a group first");
          }
          break;
        }
      }
    },
    [
      activeFolderId,
      isProjectWithNoGroups,
      currentProject,
      handleSaveToDrive,
      handleRefresh,
      handlePreviousGroup,
      handleNextGroup,
    ],
  );

  // Global app-level keyboard shortcuts hook
  useKeyboardShortcuts({
    onCommandPalette: () => setCommandPaletteOpen((prev) => !prev),
    onSearch: () => setSearchOpen(true),
    onAddLinks: () => {
      if (activeFolderId && !isProjectWithNoGroups) {
        setAddLinksOpen(true);
      }
    },
    onNewNote: () => {
      if (activeFolderId) {
        setNewNoteOpen(true);
      }
    },
    onSaveToGoogleDrive: () => {
      void handleSaveToDrive();
    },
    onSettings: () => setSettingsOpen(true),
    onProjectSwitcher: () => {
      setProjectSwitcherOpen((prev) => !prev);
    },
    onShortcuts: () => setShortcutsOpen(true),
    onArchiveProject: () => {
      if (currentProject) setArchiveConfirmOpen(true);
    },
    onRefresh: () => {
      void handleRefresh();
      toast.success("Refreshed");
    },
    onSwitchProjectNumber: (idx) => {
      if (idx >= 0 && idx < activeProjects.length) {
        handleSelectProject(activeProjects[idx].id);
        toast.info(`Switched to ${activeProjects[idx].name}`);
      }
    },
    onFocusTree: () => setActiveRegion("tree"),
    onFocusList: () => setActiveRegion("list"),
    onCycleFocus: () => setActiveRegion((r) => (r === "tree" ? "list" : "tree")),
    onPreviousGroup: handlePreviousGroup,
    onNextGroup: handleNextGroup,
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground antialiased">
      {/* Sidebar: 280px fixed width */}
      <aside
        className={cn(
          "flex w-[280px] shrink-0 flex-col border-r border-border bg-sidebar select-none transition-colors",
          activeRegion === "tree" && "border-r-primary/40",
        )}
        onClick={() => setActiveRegion("tree")}
      >
        {/* App Title / Header */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-[6px] bg-primary text-primary-foreground">
              <BookOpen className="size-4" />
            </div>
            <span className="font-serif text-base font-semibold tracking-tight text-foreground">
              Sourcefold
            </span>
          </div>

          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            title={`Command Palette (${isMac ? "⌘K / ⌘⇧P" : "Ctrl+K / Ctrl+Shift+P"})`}
            className="flex items-center gap-1 rounded-[4px] border border-border bg-muted/60 px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <Command className="size-3" />
            <span>{isMac ? "⌘K" : "Ctrl+K"}</span>
          </button>
        </div>

        {/* Project Switcher & Quick Add */}
        <div className="p-3 space-y-2 border-b border-border">
          <ProjectSwitcher
            projects={folders.filter((f) => !f.parent_id)}
            activeProjectId={activeProjectId}
            onSelectProject={handleSelectProject}
            onRefresh={async () => {
              await refreshFolders();
            }}
            open={projectSwitcherOpen}
            onOpenChange={setProjectSwitcherOpen}
          />

          {hasProjects && (
            <Button
              className="w-full justify-between h-8 text-xs font-medium"
              onClick={() => setAddLinksOpen(true)}
              disabled={!activeFolderId || isProjectWithNoGroups}
              title={`Add links (a or ${isMac ? "⌘N" : "Ctrl+N"})`}
            >
              <div className="flex items-center">
                <Plus className="mr-1.5 size-3.5" />
                <span>Add links</span>
              </div>
              <kbd className="rounded border border-primary-foreground/20 bg-primary-foreground/10 px-1 py-0.2 font-mono text-[9px]">
                a
              </kbd>
            </Button>
          )}
        </div>

        {/* Hierarchical Folder / Group Tree */}
        <div className="flex-1 overflow-hidden flex flex-col p-1.5">
          {activeProjectId ? (
            <FolderTree
              projectId={activeProjectId}
              folders={folders}
              activeFolderId={activeFolderId}
              isFocusedRegion={activeRegion === "tree"}
              focusedFolderId={focusedFolderId}
              onFocusedFolderChange={setFocusedFolderId}
              onSelectFolder={(id) => {
                // The tree reports the project itself when its last group is deleted; sources
                // can only be shown and saved in groups.
                const groupId = id === activeProjectId ? null : id;
                setActiveFolderId(groupId);
                setFocusedFolderId(groupId);
              }}
              onRefresh={refreshFolders}
              onRequestFocusList={() => setActiveRegion("list")}
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-muted-foreground">
              <FolderOpen className="size-8 stroke-[1.5] mb-2 opacity-50" />
              <span>Create a project to start organizing sources</span>
            </div>
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors p-1.5 rounded-[4px] cursor-pointer"
            title="Keyboard shortcuts (?)"
          >
            <HelpCircle className="size-3.5" />
            <span>Shortcuts</span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors p-1.5 rounded-[4px] cursor-pointer"
            title={`Settings (${isMac ? "⌘," : "Ctrl+,"})`}
          >
            <SettingsIcon className="size-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* Main Content: Source List */}
      <main
        className={cn(
          "flex-1 flex flex-col overflow-hidden bg-background transition-colors",
          activeRegion === "list" && "ring-1 ring-inset ring-primary/20",
        )}
        onClick={() => setActiveRegion("list")}
      >
        {activeFolderId ? (
          <div className="flex min-h-0 flex-1 flex-col px-8 pt-6">
            <GroupHeader
              folders={folders}
              folderId={activeFolderId}
              sourceCount={items.length}
              isFocusedRegion={activeRegion === "list"}
              onSelectGroup={(id) => {
                setActiveFolderId(id);
                setFocusedFolderId(id);
              }}
              onNewNote={() => setNewNoteOpen(true)}
              onRefresh={handleRefresh}
            />
            <SubgroupList
              folders={folders}
              folderId={activeFolderId}
              onSelectGroup={(id) => {
                setActiveFolderId(id);
                setFocusedFolderId(id);
              }}
            />
            <ItemList
              key={activeFolderId}
              items={items}
              folders={folders}
              isFocusedRegion={activeRegion === "list"}
              focusedItemId={focusedItemId}
              onFocusedItemChange={setFocusedItemId}
              onRefresh={refreshItems}
              onOpenReader={(item) => setReaderItem(item)}
            />
          </div>
        ) : hasProjects && isProjectWithNoGroups ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="size-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
              <FolderOpen className="size-6 stroke-[1.5]" />
            </div>
            <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              No groups in this project
            </h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              Press{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                n
              </kbd>{" "}
              while focused on the sidebar to create a group.
            </p>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="size-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
              <StickyNote className="size-6 stroke-[1.5]" />
            </div>
            <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">
              No group selected
            </h2>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              Select a group from the sidebar to view, manage, and capture research sources.
            </p>
          </div>
        )}
      </main>

      {/* Modal Dialogs */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        projects={folders.filter((f) => !f.parent_id)}
        folders={folders}
        items={items}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onSelectFolder={(folderId) => {
          setActiveFolderId(folderId);
          setFocusedFolderId(folderId);
          setActiveRegion("list");
        }}
        onOpenItem={(item, options) => {
          openSource(
            item,
            {
              image: (image) => {
                openImage(image).catch((err) =>
                  toast.error(errorMessage(err, "Couldn't open that image.")),
                );
              },
              reader: (source) => setReaderItem(source),
              browser: (url) => void openUrl(url),
            },
            options,
          );
        }}
        onExecuteCommand={handleExecuteCommand}
      />

      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        folders={folders}
        currentProjectId={activeProjectId}
        onSelectItem={(item) => {
          setActiveFolderId(item.folder_id);
          setFocusedFolderId(item.folder_id);
          setFocusedItemId(item.id);
          setActiveRegion("list");
          if (opensInReader(item)) {
            setReaderItem(item);
          }
        }}
      />

      {activeFolderId && (
        <>
          <AddLinksDialog
            open={addLinksOpen}
            onOpenChange={setAddLinksOpen}
            folders={folders}
            defaultFolderId={activeFolderId}
            onFinished={async () => {
              await refreshItems();
              await refreshFolders();
            }}
          />

          <NoteDialog
            open={newNoteOpen}
            onOpenChange={setNewNoteOpen}
            folderId={activeFolderId}
            onSaved={async () => {
              await refreshItems();
              await refreshFolders();
            }}
          />
        </>
      )}

      <ReaderModal
        item={readerItem}
        open={Boolean(readerItem)}
        onOpenChange={(open) => !open && setReaderItem(null)}
        onClose={() => setReaderItem(null)}
      />

      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentTheme={theme}
        onThemeChange={handleThemeChange}
      />

      {/* Archive Project Confirmation Dialog */}
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {currentProject?.archived_at ? "Unarchive project" : "Archive project"}
            </DialogTitle>
            <DialogDescription>
              {currentProject?.archived_at
                ? `Restore "${currentProject.name}" to your active projects list?`
                : `Are you sure you want to archive "${currentProject?.name}"? You can unarchive it anytime.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={currentProject?.archived_at ? "default" : "destructive"}
              onClick={handleToggleArchiveProject}
            >
              {currentProject?.archived_at ? "Unarchive" : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
