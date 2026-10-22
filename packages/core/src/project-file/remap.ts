// An imported project gets new ids for everything, so importing the same file twice (or into the
// account it came from) never collides. References are rewired to the new ids.

import type { ProjectFileManifest } from "./manifest";

export interface RemappedManifest {
  manifest: ProjectFileManifest;
  /** Old id → new id, for every row. */
  ids: Map<string, string>;
}

export function remapProjectIds(
  manifest: ProjectFileManifest,
  newId: () => string = () => crypto.randomUUID(),
): RemappedManifest {
  const ids = new Map<string, string>();
  const fresh = (old: string): string => {
    let next = ids.get(old);
    if (next === undefined) {
      next = newId();
      ids.set(old, next);
    }
    return next;
  };
  const ref = (old: string | null): string | null => (old === null ? null : fresh(old));

  const remapped: ProjectFileManifest = {
    ...manifest,
    project: { ...manifest.project, id: fresh(manifest.project.id) },
    groups: manifest.groups.map((g) => ({ ...g, id: fresh(g.id), parent_id: ref(g.parent_id) })),
    sources: manifest.sources.map((s) => ({ ...s, id: fresh(s.id), group_id: fresh(s.group_id) })),
    x_posts: manifest.x_posts.map((p) => ({
      ...p,
      id: fresh(p.id),
      source_id: fresh(p.source_id),
      parent_id: ref(p.parent_id),
    })),
    highlights: manifest.highlights.map((h) => ({
      ...h,
      id: fresh(h.id),
      source_id: fresh(h.source_id),
    })),
    outline_sections: manifest.outline_sections.map((s) => ({ ...s, id: fresh(s.id) })),
    cards: manifest.cards.map((c) => ({
      ...c,
      id: fresh(c.id),
      source_id: ref(c.source_id),
      highlight_id: ref(c.highlight_id),
      section_id: ref(c.section_id),
    })),
  };
  return { manifest: remapped, ids };
}

/** Groups ordered so every parent comes before its children (creation order for an import). */
export function groupsParentsFirst<T extends { id: string; parent_id: string | null }>(
  groups: readonly T[],
): T[] {
  const ids = new Set(groups.map((g) => g.id));
  const children = new Map<string | null, T[]>();
  for (const group of groups) {
    const parent = group.parent_id !== null && ids.has(group.parent_id) ? group.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(group);
    children.set(parent, list);
  }
  const out: T[] = [];
  const queue: (string | null)[] = [null];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const group of children.get(parent) ?? []) {
      out.push(group);
      queue.push(group.id);
    }
  }
  return out;
}
