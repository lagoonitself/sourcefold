import { createClient } from "@/lib/supabase/server";
import { buildFolderPaths } from "@/features/items/folder-paths";
import { ItemList } from "@/features/items/item-list";

export interface SearchResultsProps {
  query: string;
}

function escapeIlike(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function SearchResults({ query }: SearchResultsProps) {
  const supabase = await createClient();

  const [{ data: folders }, { data: items }] = await Promise.all([
    supabase.from("folders").select("id, parent_id, name").is("deleted_at", null),
    supabase
      .from("items")
      .select("*")
      .is("deleted_at", null)
      .ilike("title", `%${escapeIlike(query)}%`)
      .order("title", { ascending: true })
      .limit(100),
  ]);

  const folderPaths = buildFolderPaths(folders ?? []);
  const safeItems = items ?? [];
  const countText = safeItems.length === 1 ? "1 result" : `${safeItems.length} results`;

  return (
    <div className="px-8 pt-6">
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
          {'No titles match "' + query + '".'}
        </div>
      ) : (
        <ItemList
          items={safeItems}
          getSubTitle={(item) => folderPaths.get(item.folder_id)?.join(" / ")}
        />
      )}
    </div>
  );
}
