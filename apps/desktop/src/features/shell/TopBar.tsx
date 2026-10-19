import * as React from "react";
import { PanelLeftOpen, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { DriveSyncStatus } from "@/features/drive";
import type { Folder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PROJECT_VIEW_LABELS, type ProjectView } from "../research/project-view";

export interface TopBarProps {
  isMac: boolean;
  /** False when the sidebar is hidden; the bar then shows a button to bring it back. */
  sidebarDocked: boolean;
  onShowSidebar: () => void;
  project: Folder | undefined;
  /** From the project's first group down to the open group. */
  trail: Folder[];
  onSelectGroup: (id: string) => void;
  onSearch: () => void;
  onAddLinks: () => void;
  canAddLinks: boolean;
  projectView?: ProjectView | null;
}

/** Where you are, search, Drive status and the main action. It also drags the window on macOS. */
export function TopBar({
  isMac,
  sidebarDocked,
  onShowSidebar,
  project,
  trail,
  onSelectGroup,
  onSearch,
  onAddLinks,
  canAddLinks,
  projectView,
}: TopBarProps) {
  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "@container/topbar flex h-[52px] shrink-0 items-center gap-2 border-b border-border pl-3 pr-3",
        // The macOS traffic lights sit over the sheet's corner when the sidebar is hidden.
        !sidebarDocked && "[.platform-mac_&]:pl-[78px]",
      )}
    >
      {!sidebarDocked && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onShowSidebar}
          title={`Show sidebar (${mod}B)`}
          aria-label="Show sidebar"
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" aria-hidden="true" />
        </Button>
      )}

      <nav
        aria-label="Breadcrumb"
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-1 pl-1 text-[13px] leading-[18px] text-muted-foreground"
      >
        {project && (
          <span className="hidden max-w-[16ch] shrink-0 truncate @[560px]/topbar:inline">
            {project.name}
          </span>
        )}
        {projectView && (
          <>
            <span aria-hidden="true" className="shrink-0 text-border-strong">
              /
            </span>
            <span aria-current="page" className="min-w-0 truncate font-medium text-foreground">
              {PROJECT_VIEW_LABELS[projectView]}
            </span>
          </>
        )}
        {trail.map((folder, index) => {
          const last = index === trail.length - 1;
          return (
            <React.Fragment key={folder.id}>
              <span
                aria-hidden="true"
                className={cn(
                  "shrink-0 text-border-strong",
                  index === 0 && "hidden @[560px]/topbar:inline",
                )}
              >
                /
              </span>
              {last ? (
                <span aria-current="page" className="min-w-0 truncate font-medium text-foreground">
                  {folder.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectGroup(folder.id)}
                  className="hidden min-w-0 max-w-[18ch] cursor-pointer truncate rounded-[5px] px-0.5 transition-colors hover:text-foreground @[640px]/topbar:inline"
                >
                  {folder.name}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={onSearch}
        title="Search titles and the text of every source (/)"
        className="group flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-muted text-[13px] text-muted-foreground transition-[background-color,color,width] duration-200 hover:bg-accent hover:text-foreground @[520px]/topbar:w-[200px] @[520px]/topbar:justify-start @[520px]/topbar:px-2.5 @[880px]/topbar:w-[260px]"
      >
        <Search className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 text-left @[520px]/topbar:inline">Search sources</span>
        <Kbd className="hidden @[520px]/topbar:inline-flex">/</Kbd>
      </button>

      <DriveSyncStatus />

      <Button
        onClick={onAddLinks}
        disabled={!canAddLinks}
        title={canAddLinks ? "Add links (a)" : "Open a group to add links to it"}
        className="px-2.5 @[720px]/topbar:px-3.5"
      >
        <Plus className="size-4" aria-hidden="true" />
        <span className="hidden @[400px]/topbar:inline">Add links</span>
        <Kbd className="hidden @[720px]/topbar:inline-flex">A</Kbd>
      </Button>
    </div>
  );
}
