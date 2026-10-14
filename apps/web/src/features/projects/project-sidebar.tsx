"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FolderNode } from "@/features/folders/tree";
import { FolderTree } from "@/features/folders/folder-tree";
import { findProjectNode, rememberProject } from "./project";
import { NewProjectDialog, ProjectSwitcher, useCreateProject } from "./project-switcher";

export interface ProjectSidebarProps {
  tree: FolderNode[];
  savedProjectId: string | null;
}

export function ProjectSidebar({ tree, savedProjectId }: ProjectSidebarProps) {
  const searchParams = useSearchParams();
  const selectedFolderId = searchParams.get("folder");

  const project =
    findProjectNode(tree, selectedFolderId) ??
    tree.find((p) => p.id === savedProjectId) ??
    tree[0] ??
    null;

  useEffect(() => {
    if (project && project.id !== savedProjectId) {
      rememberProject(project.id);
    }
  }, [project, savedProjectId]);

  // The tree component treats the project's groups as its top level.
  const groups = useMemo(
    () => project?.children.map((group) => ({ ...group, parentId: null })) ?? [],
    [project],
  );

  const otherProjects = useMemo(
    () => tree.filter((p) => p.id !== project?.id).map((p) => ({ id: p.id, name: p.name })),
    [tree, project],
  );

  if (!project) {
    return <NoProjects />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-2 pb-3">
        <ProjectSwitcher projects={tree} current={project} />
      </div>
      <div className="shrink-0 px-2 pb-1 text-[12px] font-medium leading-4 text-muted-foreground">
        Groups
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FolderTree
          key={project.id}
          tree={groups}
          projectId={project.id}
          otherProjects={otherProjects}
        />
      </div>
    </div>
  );
}

function NoProjects() {
  const [isCreating, setIsCreating] = useState(false);
  const createProject = useCreateProject();

  return (
    <div className="flex flex-col items-center p-4 text-center">
      <p className="mb-3 text-sm text-muted-foreground">
        Create your first project to start collecting sources.
      </p>
      <Button variant="outline" size="sm" onClick={() => setIsCreating(true)}>
        <Plus className="size-4" aria-hidden="true" />
        New project
      </Button>
      <NewProjectDialog open={isCreating} onOpenChange={setIsCreating} onSubmit={createProject} />
    </div>
  );
}
