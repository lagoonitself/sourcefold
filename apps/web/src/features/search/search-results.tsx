import { createClient } from "@/lib/supabase/server";
import { ITEM_LIST_COLUMNS } from "@/features/items/item-columns";
import { buildFolderPaths } from "@/features/items/folder-paths";
import { ItemList } from "@/features/items/item-list";
import { findProjectId, projectFolderIds } from "@/features/projects/project";

export interface SearchResultsProps {
  query: string;
  /** The open group or project; results are limited to its project. */
  folderId: string | null;
}

function escapeIlike(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function SearchResults({ query, folderId }: SearchResultsProps) {
  const supabase = await createClient();

  const { data: folders } = await supabase
    .from("folders")
    .select("id, parent_id, name")
    .is("deleted_at", null);
  const safeFolders = folders ?? [];

  const projectId = folderId ? findProjectId(safeFolders, folderId) : null;
  const project = projectId ? safeFolders.find((f) => f.id === projectId) : undefined;

  let itemsQuery = supabase
    .from("items")
    .select(ITEM_LIST_COLUMNS)
    .is("deleted_at", null)
    .ilike("title", `%${escapeIlike(query)}%`);
  if (projectId) {
    itemsQuery = itemsQuery.in("folder_id", projectFolderIds(safeFolders, projectId));
  }
  const { data: items } = await itemsQuery.order("title", { ascending: true }).limit(100);

  const folderPaths = buildFolderPaths(safeFolders);
  const safeItems = items ?? [];
  const countText = safeItems.length === 1 ? "1 result" : `${safeItems.length} results`;
  const scope = project ? ` in ${project.name}` : "";

  return (
    <div className="px-8 pt-6">
      {project && (
        <div className="mb-1 font-sans text-[13px] leading-[18px] text-muted-foreground">
          {project.name}
        </div>
      )}
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <h1 className="font-serif text-[28px] font-semibold leading-[34px] text-foreground">
          Search
        </h1>
        <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
          {countText}
        </span>
      </div>
      <div className="border-b border-border" />
      {safeItems.length === 0 ? (
        <div className="py-12 font-sans text-sm text-muted-foreground">
          {'No titles match "' + query + '"' + scope + "."}
        </div>
      ) : (
        <ItemList
          items={safeItems}
          getSubTitle={(item) => {
            const path = folderPaths.get(item.folder_id);
            // Inside a project, the project name is the same on every row.
            return (project ? path?.slice(1) : path)?.join(" / ");
          }}
        />
      )}
    </div>
  );
}
