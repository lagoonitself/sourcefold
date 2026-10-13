import { FolderView } from "@/features/items/folder-view";
import { WelcomeState } from "@/features/items/welcome-state";
import { SearchResults } from "@/features/search/search-results";

export const dynamic = "force-dynamic";

function getFirstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { folder: rawFolder, q: rawQ } = await searchParams;
  const folder = getFirstString(rawFolder);
  const q = getFirstString(rawQ);

  if (q && q.trim().length > 0) {
    return <SearchResults query={q} />;
  }

  if (folder && folder.trim().length > 0) {
    return <FolderView folderId={folder} />;
  }

  return <WelcomeState />;
}
