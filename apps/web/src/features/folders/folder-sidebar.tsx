import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { loadFolders, type FolderItem } from "./load-folders";
import { buildFolderTree } from "./tree";
import { SidebarSkeleton } from "@/features/shell/sidebar-skeleton";
import { ProjectSidebar } from "@/features/projects/project-sidebar";
import { PROJECT_COOKIE } from "@/features/projects/project";

export async function FolderSidebar() {
  const supabase = await createClient();
  let folders: FolderItem[] = [];
  try {
    const user = await getSessionUser();
    if (user) {
      folders = await loadFolders(supabase, user.id, { includeArchived: true });
    }
  } catch (err) {
    console.error("Failed to load folders:", err);
  }

  const tree = buildFolderTree(folders);
  const savedProjectId = (await cookies()).get(PROJECT_COOKIE)?.value ?? null;

  return (
    <Suspense fallback={<SidebarSkeleton />}>
      <ProjectSidebar tree={tree} savedProjectId={savedProjectId} />
    </Suspense>
  );
}
