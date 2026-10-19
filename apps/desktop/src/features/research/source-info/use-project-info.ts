import * as React from "react";
import type { OutlineSection } from "@sourcefold/core";
import { getFolders, getOutlineSections, getProjectItems } from "@/lib/api";
import { projectIdOf, projectTagsByUse } from "./research-logic";

export interface ProjectTagData {
  /** The project's outline sections, in outline order. */
  sections: OutlineSection[];
  /** Tags used on the project's sources, most used first. */
  projectTags: string[];
  loading: boolean;
}

const NO_TAGS: ProjectTagData = { sections: [], projectTags: [], loading: false };

/**
 * Loads what the tag field suggests: the project's section titles, then the tags already used in
 * the project. Reloads each time `enabled` turns on, so new sections and tags show up.
 */
export function useProjectTagData(projectId: string | null, enabled: boolean): ProjectTagData {
  const [data, setData] = React.useState<ProjectTagData>(NO_TAGS);

  React.useEffect(() => {
    if (!enabled || !projectId) {
      setData(NO_TAGS);
      return;
    }
    let cancelled = false;
    setData((prev) => ({ ...prev, loading: true }));
    void Promise.allSettled([getOutlineSections(projectId), getProjectItems(projectId)]).then(
      ([sections, items]) => {
        if (cancelled) return;
        setData({
          sections: sections.status === "fulfilled" ? sections.value : [],
          projectTags: items.status === "fulfilled" ? projectTagsByUse(items.value) : [],
          loading: false,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, enabled]);

  return data;
}

/**
 * The project a source belongs to, found through its group's chain of parents. Cards and tag
 * suggestions need it, and the reader is only given the source.
 */
export function useItemProjectId(
  item: { folder_id?: string | null } | null,
  active: boolean,
): string | null {
  const folderId = item?.folder_id ?? null;
  const [found, setFound] = React.useState<{ folderId: string; projectId: string | null } | null>(
    null,
  );

  React.useEffect(() => {
    if (!active || !folderId) return;
    let cancelled = false;
    getFolders(true)
      .then((folders) => {
        if (!cancelled) setFound({ folderId, projectId: projectIdOf(folders, folderId) });
      })
      .catch(() => {
        if (!cancelled) setFound({ folderId, projectId: null });
      });
    return () => {
      cancelled = true;
    };
  }, [active, folderId]);

  return found && found.folderId === folderId ? found.projectId : null;
}
