import Link from "next/link";
import { Folder } from "lucide-react";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { loadFolders, type FolderItem } from "@/features/folders/load-folders";
import { NewGroupButton } from "@/features/projects/new-group-button";
import { ITEM_LIST_COLUMNS } from "./item-columns";
import { ItemList } from "./item-list";
import { AddImageButton } from "./add-image-button";
import { NewNoteButton } from "./new-note-button";

export interface FolderViewProps {
  folderId: string;
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** Ancestors from the project down to the folder's parent. */
function ancestorsOf(folders: FolderItem[], folder: FolderItem): FolderItem[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderItem[] = [];
  let current = folder.parent_id ? byId.get(folder.parent_id) : undefined;
  while (current && chain.length < 1000) {
    chain.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return chain;
}

export async function FolderView({ folderId }: FolderViewProps) {
  const supabase = await createClient();
  const user = await getSessionUser();

  const [folders, itemsResult] = await Promise.all([
    user ? loadFolders(supabase, user.id).catch(() => null) : Promise.resolve(null),
    supabase
      .from("items")
      .select(ITEM_LIST_COLUMNS)
      .eq("folder_id", folderId)
      .is("deleted_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);

  const currentFolder = folders?.find((f) => f.id === folderId);
  if (!folders || !currentFolder) {
    return (
      <div className="px-8 pt-6 font-sans text-sm text-muted-foreground">
        {"This group doesn't exist or was deleted."}
      </div>
    );
  }

  const isProject = currentFolder.parent_id === null;
  const ancestors = ancestorsOf(folders, currentFolder);
  const groups = folders.filter((f) => f.parent_id === folderId);
  // Sources live only in groups; a project page lists its groups.
  const items = isProject ? [] : (itemsResult.data ?? []);

  const counts = [
    groups.length > 0 || isProject ? plural(groups.length, "group", "groups") : null,
    isProject ? null : plural(items.length, "source", "sources"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="px-8 pt-6">
      <nav
        aria-label="Breadcrumb"
        className="mb-1 font-sans text-[13px] leading-[18px] text-muted-foreground"
      >
        {isProject
          ? "Project"
          : ancestors.map((ancestor, index) => (
              <span key={ancestor.id}>
                {index > 0 && " / "}
                <Link
                  href={`/?folder=${ancestor.id}`}
                  className="rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {ancestor.name}
                </Link>
              </span>
            ))}
      </nav>
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <h1 className="min-w-0 truncate font-serif text-[28px] font-semibold leading-[34px] text-foreground">
          {currentFolder.name}
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {counts}
          </span>
          <NewGroupButton parentId={folderId} label={isProject ? "New group" : "New subgroup"} />
          {!isProject && (
            <>
              <AddImageButton folderId={folderId} />
              <NewNoteButton folderId={folderId} />
            </>
          )}
        </div>
      </div>
      <div className="border-b border-border" />

      {groups.length > 0 && (
        <section aria-label="Groups">
          {!isProject && <SectionLabel>Subgroups</SectionLabel>}
          <ul role="list" className="divide-y divide-border border-b border-border">
            {groups.map((group) => (
              <GroupRow key={group.id} group={group} folders={folders} />
            ))}
          </ul>
        </section>
      )}

      {isProject && groups.length === 0 && (
        <div className="py-12 font-sans text-sm text-muted-foreground">
          This project has no groups yet. Create a group, for example &ldquo;Engines&rdquo;, then
          add links to it.
        </div>
      )}

      {items.length > 0 && (
        <section aria-label="Sources">
          {groups.length > 0 && <SectionLabel>Sources</SectionLabel>}
          <ItemList items={items} />
        </section>
      )}

      {!isProject && items.length === 0 && (
        <div className="py-12 font-sans text-sm text-muted-foreground">
          Nothing here yet. Add Grokipedia links, or save a page with the Sourcefold extension.
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-5 pb-1.5 font-sans text-[12px] font-medium leading-4 text-muted-foreground">
      {children}
    </div>
  );
}

function GroupRow({ group, folders }: { group: FolderItem; folders: FolderItem[] }) {
  const subgroupCount = folders.filter((f) => f.parent_id === group.id).length;
  const meta = [
    subgroupCount > 0 ? plural(subgroupCount, "subgroup", "subgroups") : null,
    plural(group.item_count, "source", "sources"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li>
      <Link
        href={`/?folder=${group.id}`}
        className="flex min-h-[48px] items-center gap-3 px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-medium leading-[22px] text-foreground">
          {group.name}
        </span>
        <span className="shrink-0 font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
          {meta}
        </span>
      </Link>
    </li>
  );
}
