import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FolderView } from "@/features/items/folder-view";
import { WelcomeState } from "@/features/items/welcome-state";
import { SearchResults } from "@/features/search/search-results";
import { PROJECT_COOKIE } from "@/features/projects/project";
import { createClient } from "@/lib/supabase/server";

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

async function findProjectToOpen(): Promise<string | null> {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("folders")
    .select("id")
    .is("parent_id", null)
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  if (!projects || projects.length === 0) return null;
  const savedId = (await cookies()).get(PROJECT_COOKIE)?.value;
  return projects.find((p) => p.id === savedId)?.id ?? projects[0].id;
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { folder: rawFolder, q: rawQ } = await searchParams;
  const folder = getFirstString(rawFolder);
  const q = getFirstString(rawQ);

  if (q && q.trim().length > 0) {
    return <SearchResults query={q} folderId={folder?.trim() || null} />;
  }

  if (folder && folder.trim().length > 0) {
    return <FolderView folderId={folder} />;
  }

  const projectId = await findProjectToOpen();
  if (projectId) {
    redirect(`/?folder=${projectId}`);
  }

  return <WelcomeState />;
}
