import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronsUpDown,
  FolderPlus,
  Pencil,
  Trash2,
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
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { Folder } from "@/lib/types";
import { archiveProject, createFolder, deleteFolder, renameFolder } from "@/lib/api";
import { isMacPlatform } from "../shortcuts/key-utils";
import { cn } from "@/lib/utils";

export interface ProjectSwitcherProps {
  projects: Folder[];
  activeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onRefresh: () => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  folders?: Folder[];
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelectProject,
  onRefresh,
  open,
  onOpenChange,
  folders,
}: ProjectSwitcherProps) {
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState("");
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameProjectName, setRenameProjectName] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const isMac = React.useMemo(() => isMacPlatform(), []);

  const activeProjects = projects.filter((p) => !p.archived_at);
  const archivedProjects = projects.filter((p) => Boolean(p.archived_at));

  const currentProject =
    projects.find((p) => p.id === activeProjectId) || activeProjects[0] || null;

  const groupCount = folders
    ? folders.filter((f) => f.parent_id === currentProject?.id && !f.deleted_at).length
    : null;

  const handleCreateProject = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const name = newProjectName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const created = await createFolder(name, null);
      toast.success(`Project "${name}" created`);
      setNewProjectName("");
      setNewProjectOpen(false);
      await onRefresh();
      onSelectProject(created.id);
    } catch (err: any) {
      toast.error(err.message || "Failed to create project");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameProject = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!currentProject) return;
    const name = renameProjectName.trim();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await renameFolder(currentProject.id, name);
      toast.success("Project renamed");
      setRenameOpen(false);
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to rename project");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!currentProject) return;
    const isArchived = Boolean(currentProject.archived_at);
    try {
      await archiveProject(currentProject.id, !isArchived);
      toast.success(isArchived ? "Project unarchived" : "Project archived");
      await onRefresh();
      if (!isArchived) {
        const remaining = activeProjects.filter((p) => p.id !== currentProject.id);
        if (remaining.length > 0) {
          onSelectProject(remaining[0].id);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update project");
    }
  };

  const handleDeleteProject = async () => {
    if (!currentProject || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await deleteFolder(currentProject.id);
      toast.success("Project deleted");
      setDeleteOpen(false);
      await onRefresh();
      const remaining = projects.filter((p) => p.id !== currentProject.id);
      if (remaining.length > 0) {
        onSelectProject(remaining[0].id);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete project");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          title={`Switch project (${isMac ? "p / ⌘P" : "p / Ctrl+P"})`}
          className={cn(
            "group flex h-10 w-full cursor-pointer select-none items-center gap-2.5 rounded-[9px] px-2.5 text-left transition-colors duration-150 outline-none",
            "hover:bg-sidebar-accent",
            "aria-expanded:bg-sidebar-accent aria-expanded:shadow-raised",
            open && "bg-sidebar-accent shadow-raised",
          )}
        >
          {/* 24px ink tile with project's first letter */}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] bg-foreground font-serif text-[13px] font-medium leading-none text-background shadow-raised">
            {(currentProject?.name?.trim()[0] || "P").toUpperCase()}
          </span>

          {/* Project name and optional group count */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-medium leading-4 text-foreground">
              {currentProject ? currentProject.name : "Select project"}
            </span>
            {groupCount !== null && (
              <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
                {groupCount} {groupCount === 1 ? "group" : "groups"}
              </span>
            )}
          </span>

          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64 p-1.5">
          <div className="flex items-center justify-between px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
            <span>Projects</span>
            <span className="font-mono text-[11px] text-muted-foreground">Alt+1…9</span>
          </div>

          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {activeProjects.map((project, idx) => {
              const isSelected = project.id === currentProject?.id;
              return (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px]",
                    isSelected && "bg-accent font-medium text-accent-foreground",
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground font-serif text-[11px] font-medium leading-none text-background">
                    {(project.name.trim()[0] || "P").toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {idx < 9 && <Kbd>Alt+{idx + 1}</Kbd>}
                    {isSelected && <Check className="size-4 shrink-0 !text-foreground" />}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>

          {archivedProjects.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => setShowArchived(!showArchived)}
                className="flex w-full cursor-pointer items-center justify-between rounded-[6px] px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <span>Archived ({archivedProjects.length})</span>
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-150",
                    showArchived && "rotate-180",
                  )}
                />
              </button>
              {showArchived && (
                <div className="max-h-40 space-y-0.5 overflow-y-auto pt-0.5">
                  {archivedProjects.map((project) => {
                    const isSelected = project.id === currentProject?.id;
                    return (
                      <div
                        key={project.id}
                        className={cn(
                          "group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted",
                          isSelected && "bg-accent font-medium text-accent-foreground",
                        )}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left hover:text-foreground"
                          onClick={() => onSelectProject(project.id)}
                        >
                          <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-muted font-serif text-[11px] font-medium leading-none text-muted-foreground">
                            {(project.name.trim()[0] || "P").toUpperCase()}
                          </span>
                          <span className="truncate">{project.name}</span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          {isSelected && <Check className="size-4 text-foreground" />}
                          <button
                            type="button"
                            title="Restore project"
                            aria-label={`Restore ${project.name}`}
                            className="flex size-6 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await archiveProject(project.id, false);
                                toast.success(`Project "${project.name}" restored`);
                                await onRefresh();
                                if (!isSelected) onSelectProject(project.id);
                              } catch (err: any) {
                                toast.error(err?.message || "Failed to restore project");
                              }
                            }}
                          >
                            <ArchiveRestore className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
            <FolderPlus className="size-4" />
            <span>New project</span>
          </DropdownMenuItem>

          {currentProject && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  setRenameProjectName(currentProject.name);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="size-4" />
                <span>Rename project</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleToggleArchive}>
                {currentProject.archived_at ? (
                  <>
                    <ArchiveRestore className="size-4" />
                    <span>Unarchive project</span>
                  </>
                ) : (
                  <>
                    <Archive className="size-4" />
                    <span>Archive project</span>
                  </>
                )}
                <Kbd>{isMac ? "⇧⌘A" : "Ctrl+Shift+A"}</Kbd>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="size-4" />
                <span>Delete project</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* New Project Dialog */}
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent>
          <form onSubmit={handleCreateProject}>
            <DialogHeader>
              <DialogTitle>Create new project</DialogTitle>
              <DialogDescription>
                A project holds groups and sources for a research topic.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="e.g. AI Safety Research"
                autoFocus
                disabled={isSubmitting}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewProjectOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newProjectName.trim() || isSubmitting}>
                {isSubmitting ? "Creating..." : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Project Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <form onSubmit={handleRenameProject}>
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
              <DialogDescription>Give this project a new name.</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Input
                value={renameProjectName}
                onChange={(e) => setRenameProjectName(e.target.value)}
                autoFocus
                disabled={isSubmitting}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!renameProjectName.trim() || isSubmitting}>
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{currentProject?.name}&rdquo;? All groups and
              saved sources within this project will be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isSubmitting}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
