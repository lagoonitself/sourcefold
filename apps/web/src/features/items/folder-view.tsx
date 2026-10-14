import { createClient } from "@/lib/supabase/server";
import { buildFolderPaths } from "./folder-paths";
import { ITEM_LIST_COLUMNS } from "./item-columns";
import { ItemList } from "./item-list";
import { AddImageButton } from "./add-image-button";
import { NewNoteButton } from "./new-note-button";

export interface FolderViewProps {
  folderId: string;
}

export async function FolderView({ folderId }: FolderViewProps) {
  const supabase = await createClient();

  const [foldersResult, itemsResult] = await Promise.all([
    supabase.from("folders").select("id, parent_id, name").is("deleted_at", null),
    supabase
      .from("items")
      .select(ITEM_LIST_COLUMNS)
      .eq("folder_id", folderId)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);

  const { data: folders, error: foldersError } = foldersResult;

  const currentFolder = folders?.find((f) => f.id === folderId);
  if (foldersError || !currentFolder) {
    return (
      <div className="px-8 pt-6 font-sans text-sm text-muted-foreground">
        {"This folder doesn't exist or was deleted."}
      </div>
    );
  }

  const folderPaths = buildFolderPaths(folders ?? []);
  const fullPath = folderPaths.get(folderId) ?? [currentFolder.name];
  const parentPath = fullPath.slice(0, -1);
  const breadcrumb = parentPath.length > 0 ? parentPath.join(" / ") : null;

  const { data: items } = itemsResult;

  const safeItems = items ?? [];
  const countText = safeItems.length === 1 ? "1 source" : `${safeItems.length} sources`;

  return (
    <div className="px-8 pt-6">
      {breadcrumb && (
        <div className="mb-1 font-sans text-[13px] leading-[18px] text-muted-foreground">
          {breadcrumb}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <h1 className="font-serif text-[28px] font-semibold leading-[34px] text-foreground">
          {currentFolder.name}
        </h1>
        <div className="flex items-center gap-3">
          <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {countText}
          </span>
          <AddImageButton folderId={folderId} />
          <NewNoteButton folderId={folderId} />
        </div>
      </div>
      <div className="border-b border-border" />
      {safeItems.length === 0 ? (
        <div className="py-12 font-sans text-sm text-muted-foreground">
          Nothing here yet. Add Grokipedia links, or save a page with the Sourcefold extension.
        </div>
      ) : (
        <ItemList items={safeItems} />
      )}
    </div>
  );
}
