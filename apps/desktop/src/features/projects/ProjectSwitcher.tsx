import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronsUpDown,
  FolderOpen,
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
}

export function ProjectSwitcher({
  projects,
  activeProjectId,
  onSelectProject,
  onRefresh,
  open,
  onOpenChange,
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
          className="flex h-9 w-full items-center justify-between gap-2 rounded-[6px] border border-border bg-background px-3 py-1.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FolderOpen className="size-4 shrink-0 text-primary" />
            <span className="truncate font-medium">
              {currentProject ? currentProject.name : "Select Project"}
            </span>
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64 p-1.5">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Projects</span>
            <span className="text-[10px] font-mono lowercase">Alt+1…9</span>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {activeProjects.map((project, idx) => {
              const isSelected = project.id === currentProject?.id;
              return (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-xs",
                    isSelected && "bg-accent text-accent-foreground font-semibold",
                  )}
                >
                  <span className="truncate flex-1">{project.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {idx < 9 && (
                      <kbd className="rounded border border-border bg-muted/60 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                        Alt+{idx + 1}
                      </kbd>
                    )}
                    {isSelected && <Check className="size-3.5 text-primary" />}
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
                className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <span>Archived ({archivedProjects.length})</span>
                <ChevronDown
                  className={cn("size-3 transition-transform", showArchived && "rotate-180")}
                />
              </button>
              {showArchived && (
                <div className="max-h-40 overflow-y-auto space-y-0.5 pt-0.5">
                  {archivedProjects.map((project) => {
                    const isSelected = project.id === currentProject?.id;
                    return (
                      <div
                        key={project.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-[4px] px-2 py-1.5 text-xs text-muted-foreground",
                          isSelected && "bg-accent text-accent-foreground font-semibold",
                        )}
                      >
                        <button
                          type="button"
                          className="truncate text-left flex-1 cursor-pointer hover:text-foreground"
                          onClick={() => onSelectProject(project.id)}
                        >
                          {project.name}
                        </button>
                        {isSelected && <Check className="size-3.5 shrink-0 text-primary" />}
                        <button
                          type="button"
                          title="Restore project"
                          className="shrink-0 rounded-[3px] p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
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
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => setNewProjectOpen(true)}>
            <FolderPlus className="mr-2 size-3.5" />
            <span>New project...</span>
          </DropdownMenuItem>

          {currentProject && (
            <>
              <DropdownMenuItem
                onClick={() => {
                  setRenameProjectName(currentProject.name);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="mr-2 size-3.5" />
                <span>Rename project</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={handleToggleArchive}
                className="flex items-center justify-between"
              >
                <div className="flex items-center">
                  {currentProject.archived_at ? (
                    <>
                      <ArchiveRestore className="mr-2 size-3.5" />
                      <span>Unarchive project</span>
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 size-3.5" />
                      <span>Archive project</span>
                    </>
                  )}
                </div>
                <kbd className="ml-2 rounded border border-border bg-muted/60 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                  {isMac ? "⌘⇧A" : "Ctrl+Shift+A"}
                </kbd>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 size-3.5" />
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
