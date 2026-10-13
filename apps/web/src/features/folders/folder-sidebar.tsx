import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadFolders, type FolderItem } from "./load-folders";
import { buildFolderTree } from "./tree";
import { FolderTree } from "./folder-tree";
import { SidebarSkeleton } from "@/features/shell/sidebar-skeleton";

export async function FolderSidebar() {
  const supabase = await createClient();
  let folders: FolderItem[] = [];
  try {
    folders = await loadFolders(supabase);
  } catch (err) {
    console.error("Failed to load folders:", err);
  }

  const tree = buildFolderTree(folders);

  return (
    <Suspense fallback={<SidebarSkeleton />}>
      <FolderTree tree={tree} />
    </Suspense>
  );
}
