import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { FolderOpen, FolderPlus, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
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
import {
  dispatchGroupAction,
  groupActionForCommand,
  requestNewGroup,
} from "@/features/items/group-actions";
import { AppSidebar } from "@/features/shell/AppSidebar";
import { TopBar } from "@/features/shell/TopBar";
import { useSidebar } from "@/features/shell/use-sidebar";
import { SAVE_TO_DRIVE_EVENT } from "@/features/drive";
import { AddLinksDialog } from "@/features/grokipedia/AddLinksDialog";
import { SearchDialog } from "@/features/search/SearchDialog";
import { MeaningIndexer } from "@/features/search/embedding";
import type { NoteHit, PassageHit } from "@/features/search/search-api";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { useAgentEvents } from "@/features/claude/use-agent-events";
import type { ShowNavigation } from "@/features/claude/agent-show";
import { NoteDialog } from "@/features/items/NoteDialog";
import { HighlightsList } from "@/features/highlights/HighlightsList";
import { useGroupHighlights } from "@/features/highlights/use-group-highlights";
import { buildHighlightRows, tabFor, type GroupTab } from "@/features/highlights/highlight-rows";
import { ReaderModal } from "@/features/reader/ReaderModal";
import { openSource, opensInReader } from "@/features/reader/open-decision";
import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { KeyboardShortcutsDialog, useKeyboardShortcuts } from "@/features/shortcuts";
import { isMacPlatform, matchesKeyCombo } from "@/features/shortcuts/key-utils";
import type { Folder, Item } from "@/lib/types";
import { archiveProject, getFolders, getItem, getItems, openImage } from "@/lib/api";
import { isRemoteConfigured, isSessionExpiredError } from "@/lib/remote-client";
import { openUrl, cn, errorMessage } from "@/lib/utils";

export function App() {
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const sidebar = useSidebar();

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
  // Set when the reader is opened from the Highlights tab; cleared by any other way of opening it.
  const [readerHighlightId, setReaderHighlightId] = React.useState<string | null>(null);
  // Set when the reader is opened from the search box on a passage; it belongs to that source only.
  const [readerSearch, setReaderSearch] = React.useState<{
    itemId: string;
    query: string;
    passageStart: string;
  } | null>(null);
  // Links the reader asked to save (one per line), and the group they go to.
  const [addLinksText, setAddLinksText] = React.useState("");
  const [addLinksFolderId, setAddLinksFolderId] = React.useState<string | null>(null);
  // The group view's tab; another group always opens on Sources.
  const [chosenTab, setChosenTab] = React.useState<{ folderId: string | null; tab: GroupTab }>({
    folderId: null,
    tab: "sources",
  });
  const groupTab = tabFor(chosenTab, activeFolderId);
  const setGroupTab = React.useCallback(
    (tab: GroupTab) => setChosenTab({ folderId: activeFolderIdRef.current, tab }),
    [],
  );
  const groupHighlights = useGroupHighlights(activeFolderId);
  const highlightCount = React.useMemo(
    () => buildHighlightRows(groupHighlights.highlights, items).length,
    [groupHighlights.highlights, items],
  );
  const refreshHighlights = groupHighlights.refresh;

  // Any other way of opening (or closing) the reader drops the search landing.
  React.useEffect(() => {
    if (readerSearch && readerItem?.id !== readerSearch.itemId) setReaderSearch(null);
  }, [readerSearch, readerItem]);
  const initialSearch = React.useMemo(
    () =>
      readerSearch && readerItem?.id === readerSearch.itemId
        ? { query: readerSearch.query, passageStart: readerSearch.passageStart }
        : null,
    [readerSearch, readerItem?.id],
  );

  // A passage, highlight or note from the search box opens the reader on its source at that place,
  // in any project; the open project and group stay as they are.
  const openSearchHit = React.useCallback(async (hit: PassageHit | NoteHit, query: string) => {
    try {
      const source = await getItem(hit.item_id);
      setReaderHighlightId(null);
      setReaderSearch({ itemId: source.id, query, passageStart: hit.passage_start });
      setReaderItem(source);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't open that source."));
    }
  }, []);

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

  // Action: Save to Google Drive. The top bar's Drive status runs the save and shows its progress.
  const handleSaveToDrive = React.useCallback(() => {
    if (!isRemoteConfigured()) {
      toast.info("Sign in to save to Google Drive. Offline sources are already on this computer.");
      return;
    }
    window.dispatchEvent(new Event(SAVE_TO_DRIVE_EVENT));
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
        case "app.toggle-sidebar":
          sidebar.toggle();
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
      sidebar.toggle,
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
    onToggleSidebar: sidebar.toggle,
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

  // The open group's path inside the project, for the top bar's breadcrumb.
  const trail = React.useMemo(() => {
    if (!activeFolderId) return [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const chain: Folder[] = [];
    let current = byId.get(activeFolderId);
    while (current && current.parent_id && chain.length < 1000) {
      chain.unshift(current);
      current = byId.get(current.parent_id);
    }
    return chain;
  }, [folders, activeFolderId]);

  const closeDrawer = sidebar.closeDrawer;
  const selectGroup = React.useCallback(
    (id: string) => {
      setActiveFolderId(id);
      setFocusedFolderId(id);
      closeDrawer();
    },
    [closeDrawer],
  );

  // Claude (the MCP server) asking the app to show a group, a source or a highlight.
  const showForAgent = React.useCallback(
    (nav: ShowNavigation) => {
      setReaderItem(null);
      setReaderHighlightId(null);
      setActiveProjectId(nav.projectId);
      setActiveFolderId(nav.groupId);
      setFocusedFolderId(nav.groupId);
      setFocusedItemId(nav.focusItemId);
      setChosenTab({ folderId: nav.groupId, tab: "sources" });
      setActiveRegion("list");
      closeDrawer();
      if (nav.reader) {
        setReaderHighlightId(nav.reader.highlightId);
        setReaderItem(nav.reader.item);
      }
    },
    [closeDrawer],
  );
  useAgentEvents({ refreshFolders, navigate: showForAgent });

  const canAddLinks = Boolean(activeFolderId) && !isProjectWithNoGroups;

  // Esc closes the sliding sidebar before anything else.
  React.useEffect(() => {
    if (!sidebar.drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebar.drawerOpen, closeDrawer]);

  const sidebarContent = (
    <AppSidebar
      isMac={isMac}
      isFocusedRegion={activeRegion === "tree"}
      onActivate={() => setActiveRegion("tree")}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      onOpenShortcuts={() => setShortcutsOpen(true)}
      onOpenSettings={() => setSettingsOpen(true)}
      onHide={sidebar.drawerOpen ? closeDrawer : sidebar.toggle}
      projectSwitcher={
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
      }
      tree={
        activeProjectId ? (
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
              if (groupId) closeDrawer();
            }}
            onRefresh={refreshFolders}
            onRequestFocusList={() => setActiveRegion("list")}
          />
        ) : (
          <p className="px-3 py-6 text-[13px] leading-[19px] text-muted-foreground">
            Your groups show here once you create a project.
          </p>
        )
      }
    />
  );

  return (
    <div className="flex h-dvh w-screen overflow-hidden text-foreground antialiased">
      {/* Sidebar beside the content on wide windows; it slides closed when hidden. */}
      <motion.aside
        aria-label="Projects and groups"
        initial={false}
        animate={{ width: sidebar.docked ? 264 : 0, opacity: sidebar.docked ? 1 : 0 }}
        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        className="relative shrink-0 select-none overflow-hidden"
        inert={!sidebar.docked}
      >
        <div className="h-full w-[264px]">{sidebar.docked && sidebarContent}</div>
      </motion.aside>

      {/* On narrow windows (or once hidden) it slides over the content instead. */}
      <AnimatePresence>
        {sidebar.drawerOpen && (
          <>
            <motion.div
              key="sidebar-scrim"
              className="fixed inset-0 z-40 bg-[var(--overlay)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeDrawer}
            />
            <motion.aside
              key="sidebar-drawer"
              aria-label="Projects and groups"
              className="desk-grain fixed inset-y-2 left-2 z-40 w-[288px] max-w-[calc(100vw-48px)] select-none overflow-hidden rounded-[16px] shadow-float"
              initial={{ x: "-110%" }}
              animate={{ x: 0 }}
              exit={{ x: "-110%" }}
              transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className={cn("flex min-w-0 flex-1 flex-col p-2", sidebar.docked && "pl-0")}>
        <main
          className={cn(
            "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] bg-background shadow-sheet",
          )}
          onClick={() => setActiveRegion("list")}
        >
          <TopBar
            isMac={isMac}
            sidebarDocked={sidebar.docked}
            onShowSidebar={sidebar.toggle}
            project={currentProject}
            trail={trail}
            onSelectGroup={selectGroup}
            onSearch={() => setSearchOpen(true)}
            onAddLinks={() => setAddLinksOpen(true)}
            canAddLinks={canAddLinks}
          />

          {activeFolderId ? (
            <div className="@container/view flex min-h-0 flex-1 flex-col px-5 pt-7 @[720px]/view:px-9 @[720px]/view:pt-9">
              <GroupHeader
                folders={folders}
                folderId={activeFolderId}
                sourceCount={items.length}
                highlightCount={highlightCount}
                tab={groupTab}
                onTabChange={setGroupTab}
                isFocusedRegion={activeRegion === "list"}
                onSelectGroup={selectGroup}
                onNewNote={() => setNewNoteOpen(true)}
                onRefresh={handleRefresh}
              />
              {groupTab === "highlights" ? (
                <HighlightsList
                  key={activeFolderId}
                  items={items}
                  highlights={groupHighlights.highlights}
                  loading={groupHighlights.loading}
                  error={groupHighlights.error}
                  isFocusedRegion={activeRegion === "list"}
                  onRefresh={refreshHighlights}
                  onOpenHighlight={(item, highlightId) => {
                    setFocusedItemId(item.id);
                    setReaderHighlightId(highlightId);
                    setReaderItem(item);
                  }}
                />
              ) : (
                <>
                  <SubgroupList
                    folders={folders}
                    folderId={activeFolderId}
                    onSelectGroup={selectGroup}
                  />
                  <ItemList
                    key={activeFolderId}
                    items={items}
                    folders={folders}
                    isFocusedRegion={activeRegion === "list"}
                    focusedItemId={focusedItemId}
                    onFocusedItemChange={setFocusedItemId}
                    onRefresh={refreshItems}
                    onOpenReader={(item) => {
                      setReaderHighlightId(null);
                      setReaderItem(item);
                    }}
                  />
                </>
              )}
            </div>
          ) : !hasProjects ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={Layers}
                title="Start your first project"
                description="Create your first project to start collecting sources. A project holds the groups and sources for one video or topic."
                actions={<Button onClick={() => setProjectSwitcherOpen(true)}>New project</Button>}
              />
            </div>
          ) : isProjectWithNoGroups ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={FolderPlus}
                title="This project has no groups yet"
                description="Create a group, for example “Engines”, then add links to it."
                actions={
                  <Button
                    onClick={() => {
                      if (!sidebar.docked) sidebar.toggle();
                      requestNewGroup();
                    }}
                  >
                    New group
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={FolderOpen}
                title="Open a group"
                description="Pick a group in the sidebar to see its sources and highlights."
                actions={
                  !sidebar.docked ? (
                    <Button variant="outline" onClick={sidebar.toggle}>
                      Show groups
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </main>
      </div>

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
              reader: (source) => {
                setReaderHighlightId(null);
                setReaderItem(source);
              },
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
        onOpenHit={(hit, query) => void openSearchHit(hit, query)}
        onSelectItem={(item) => {
          setActiveFolderId(item.folder_id);
          setFocusedFolderId(item.folder_id);
          setFocusedItemId(item.id);
          setActiveRegion("list");
          if (opensInReader(item)) {
            setReaderHighlightId(null);
            setReaderItem(item);
          }
        }}
      />

      {activeFolderId && (
        <>
          <AddLinksDialog
            open={addLinksOpen}
            onOpenChange={(open) => {
              setAddLinksOpen(open);
              if (!open) {
                setAddLinksText("");
                setAddLinksFolderId(null);
              }
            }}
            folders={folders}
            defaultFolderId={addLinksFolderId ?? activeFolderId}
            initialText={addLinksText}
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
        onOpenChange={(open) => {
          if (!open) {
            setReaderItem(null);
            setReaderHighlightId(null);
          }
        }}
        onClose={() => {
          setReaderItem(null);
          setReaderHighlightId(null);
        }}
        groupItems={items}
        onNavigate={(next) => {
          setReaderHighlightId(null);
          setFocusedItemId(next.id);
          setReaderItem(items.find((i) => i.id === next.id) ?? (next as unknown as Item));
        }}
        initialHighlightId={readerHighlightId}
        initialSearch={initialSearch}
        onHighlightsChanged={() => void refreshHighlights()}
        onSaveLinks={(urls, folderId) => {
          setAddLinksText(urls.join("\n"));
          setAddLinksFolderId(folderId);
          setAddLinksOpen(true);
        }}
      />

      <MeaningIndexer currentProjectId={activeProjectId} />

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
