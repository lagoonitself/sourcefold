"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronsUpDown,
  Download,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FolderNode } from "@/features/folders/tree";
import { ExportProjectDialog } from "@/features/project-file/export-project-dialog";
import {
  ImportProjectDialog,
  ProjectFileInput,
} from "@/features/project-file/import-project-dialog";
import type { ProjectFileContents } from "@sourcefold/core/project-file";
import { NameDialog } from "./name-dialog";
import { rememberProject } from "./project";

export interface ProjectSwitcherProps {
  projects: FolderNode[];
  current: FolderNode | null;
}

export function ProjectSwitcher({ projects, current }: ProjectSwitcherProps) {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importContents, setImportContents] = useState<ProjectFileContents | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const createProject = useCreateProject();
  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  const openProject = (projectId: string) => {
    rememberProject(projectId);
    router.push(`/?folder=${projectId}`);
  };

  const setArchived = async (archived: boolean) => {
    if (!current) return;
    try {
      const res = await fetch(`/api/folders/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't update the project. Try again.");
        return;
      }
      if (archived) {
        toast("Project archived");
        const next = activeProjects.find((p) => p.id !== current.id);
        if (next) {
          openProject(next.id);
        } else {
          router.push("/");
        }
      } else {
        toast("Project unarchived");
      }
      router.refresh();
    } catch {
      toast.error("Couldn't update the project. Try again.");
    }
  };

  const renameProject = async (name: string) => {
    if (!current) return false;
    try {
      const res = await fetch(`/api/folders/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't rename the project. Try again.");
        return false;
      }
      toast("Project renamed");
      router.refresh();
      return true;
    } catch {
      toast.error("Couldn't rename the project. Try again.");
      return false;
    }
  };

  const deleteProject = async () => {
    if (!current || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/folders/${current.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't delete the project. Try again.");
        return;
      }
      toast("Project deleted");
      const next = activeProjects.find((p) => p.id !== current.id);
      if (next) {
        rememberProject(next.id);
        router.push(`/?folder=${next.id}`);
      } else {
        router.push("/");
      }
      router.refresh();
    } catch {
      toast.error("Couldn't delete the project. Try again.");
    } finally {
      setIsDeleting(false);
      setIsConfirmingDelete(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch project"
          className="flex h-9 w-full items-center gap-2 rounded-[6px] border border-input bg-background px-2.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="flex-1 truncate">{current?.name ?? "Choose a project"}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[248px]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {activeProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isCurrent={project.id === current?.id}
                onOpen={openProject}
              />
            ))}
          </DropdownMenuGroup>
          {archivedProjects.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Archived</DropdownMenuLabel>
                {archivedProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    project={project}
                    isCurrent={project.id === current?.id}
                    onOpen={openProject}
                    muted
                  />
                ))}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => importInputRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" />
            Import project file
          </DropdownMenuItem>
          {current && (
            <>
              <DropdownMenuItem onClick={() => setIsRenaming(true)}>
                <Pencil className="size-4" aria-hidden="true" />
                Rename project
              </DropdownMenuItem>
              {current.archived ? (
                <DropdownMenuItem onClick={() => setArchived(false)}>
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                  Unarchive project
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setArchived(true)}>
                  <Archive className="size-4" aria-hidden="true" />
                  Archive project
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setIsExporting(true)}>
                <Download className="size-4" aria-hidden="true" />
                Download project file
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setIsConfirmingDelete(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Delete project
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <NewProjectDialog open={isCreating} onOpenChange={setIsCreating} onSubmit={createProject} />

      <ProjectFileInput inputRef={importInputRef} onContents={setImportContents} />
      <ImportProjectDialog contents={importContents} onClose={() => setImportContents(null)} />
      <ExportProjectDialog
        open={isExporting}
        onOpenChange={setIsExporting}
        project={current ? { id: current.id, name: current.name } : null}
      />

      <NameDialog
        open={isRenaming}
        onOpenChange={setIsRenaming}
        title="Rename project"
        placeholder="Project name"
        submitLabel="Save"
        initialValue={current?.name}
        onSubmit={renameProject}
      />

      <AlertDialog
        open={isConfirmingDelete}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setIsConfirmingDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{current?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the project, its groups and every source in them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={deleteProject} disabled={isDeleting}>
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProjectItem({
  project,
  isCurrent,
  onOpen,
  muted = false,
}: {
  project: FolderNode;
  isCurrent: boolean;
  onOpen: (projectId: string) => void;
  muted?: boolean;
}) {
  return (
    <DropdownMenuItem onClick={() => onOpen(project.id)}>
      <span className={muted ? "flex-1 truncate text-muted-foreground" : "flex-1 truncate"}>
        {project.name}
      </span>
      {isCurrent && <Check className="size-4 shrink-0" aria-label="Current project" />}
    </DropdownMenuItem>
  );
}

export function NewProjectDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="Each project keeps its own groups and sources."
      placeholder="Project name, for example Cars"
      submitLabel="Create project"
      onSubmit={onSubmit}
    />
  );
}

export function useCreateProject() {
  const router = useRouter();

  return async (name: string) => {
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't create the project. Try again.");
        return false;
      }
      toast("Project created");
      rememberProject(json.data.id);
      router.push(`/?folder=${json.data.id}`);
      router.refresh();
      return true;
    } catch {
      toast.error("Couldn't create the project. Try again.");
      return false;
    }
  };
}
