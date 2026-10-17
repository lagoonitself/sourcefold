import type { Folder } from "./api";

export interface FolderTreeItem {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
  position: number;
  itemCount?: number;
}

export function buildFolderTree(folders: Folder[]): FolderTreeItem[] {
  const byParent = new Map<string | null, Folder[]>();
  const idSet = new Set<string>();

  for (const folder of folders) {
    idSet.add(folder.id);
  }

  for (const folder of folders) {
    const parentKey = folder.parent_id && idSet.has(folder.parent_id) ? folder.parent_id : null;
    const existing = byParent.get(parentKey) ?? [];
    existing.push(folder);
    byParent.set(parentKey, existing);
  }

  const sortFolders = (list: Folder[]) => {
    list.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.name.localeCompare(b.name);
    });
  };

  for (const list of byParent.values()) {
    sortFolders(list);
  }

  const result: FolderTreeItem[] = [];
  const visited = new Set<string>();

  function traverse(parentId: string | null, depth: number) {
    const children = byParent.get(parentId);
    if (!children) return;

    for (const child of children) {
      if (visited.has(child.id)) {
        continue;
      }
      visited.add(child.id);

      result.push({
        id: child.id,
        name: child.name,
        depth,
        parentId: child.parent_id,
        position: child.position,
        itemCount: child.item_count,
      });

      traverse(child.id, depth + 1);
    }
  }

  traverse(null, 0);

  for (const folder of folders) {
    if (!visited.has(folder.id)) {
      result.push({
        id: folder.id,
        name: folder.name,
        depth: 0,
        parentId: folder.parent_id,
        position: folder.position,
        itemCount: folder.item_count,
      });
      visited.add(folder.id);
    }
  }

  return result;
}

export function formatFolderLabel(name: string, depth: number): string {
  return "\u00A0\u00A0".repeat(depth) + name;
}

/** Top-level folders are projects; sources are saved into the groups inside them. */
export interface ProjectSection {
  project: FolderTreeItem;
  groups: FolderTreeItem[];
}

export function buildProjectSections(tree: FolderTreeItem[]): ProjectSection[] {
  const sections: ProjectSection[] = [];
  for (const item of tree) {
    if (item.depth === 0) {
      sections.push({ project: item, groups: [] });
    } else {
      sections[sections.length - 1]?.groups.push(item);
    }
  }
  return sections;
}

export function projectIdOf(tree: FolderTreeItem[], folderId: string): string | null {
  const byId = new Map(tree.map((item) => [item.id, item]));
  let current = byId.get(folderId);
  for (let steps = 0; current && steps < 1000; steps++) {
    if (current.depth === 0) return current.id;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

/** The group to open in a project: the one used last there, else its first group, else none. */
export function pickGroupInProject(
  section: ProjectSection,
  groupByProject: Record<string, string>,
): string {
  const remembered = groupByProject[section.project.id];
  if (remembered && section.groups.some((g) => g.id === remembered)) return remembered;
  return section.groups[0]?.id ?? "";
}

/**
 * Where the popup opens. The project stays put between saves (one project per video), so the
 * last open project wins, even when it has no groups yet; then the last used group's project;
 * then the first project that has groups.
 */
export function pickStartingPlace(
  tree: FolderTreeItem[],
  places: {
    groupId: string | null;
    projectId: string | null;
    groupByProject: Record<string, string>;
  },
): { projectId: string; groupId: string } {
  const sections = buildProjectSections(tree);
  const byId = (id: string | null) => sections.find((s) => s.project.id === id);

  const groupProject =
    places.groupId && tree.some((item) => item.id === places.groupId && item.depth > 0)
      ? projectIdOf(tree, places.groupId)
      : null;
  const section =
    byId(places.projectId) ??
    byId(groupProject) ??
    sections.find((s) => s.groups.length > 0) ??
    sections[0];
  if (!section) return { projectId: "", groupId: "" };

  const groupId =
    groupProject === section.project.id && places.groupId
      ? places.groupId
      : pickGroupInProject(section, places.groupByProject);
  return { projectId: section.project.id, groupId };
}

/** The last used group, else the first group of the last used project, else the first group. */
export function pickDefaultGroup(tree: FolderTreeItem[], lastFolderId: string | null): string {
  const groups = tree.filter((item) => item.depth > 0);
  if (lastFolderId && groups.some((g) => g.id === lastFolderId)) return lastFolderId;
  const inLastProject = lastFolderId
    ? groups.find((g) => projectIdOf(tree, g.id) === lastFolderId)
    : undefined;
  return inLastProject?.id ?? groups[0]?.id ?? "";
}
