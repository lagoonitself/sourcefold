// Where each source's file sits inside a `.sourcefold` zip: the same layout Drive and the
// desktop's local copy use (docs/FILE-FORMAT.md, "Folder layout" and "Names").

import { safeName, uniqueNames } from "../file-name";
import { postImagesFolderName } from "../post-images";
import { PROJECT_FILE_MEDIA_TYPES } from "./manifest";

export interface PathGroup {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export interface PathSource {
  id: string;
  group_id: string;
  title: string;
  created_at: string;
  /** `md` for text sources; the image's own extension (`png`, `jpg`, …) for image sources. */
  extension: string;
}

export interface SourcePaths {
  /** `Cars/Engines/Turbocharger.md` */
  file: string;
  /** `Cars/Engines/Turbocharger_files` */
  media_folder: string;
}

/**
 * Paths for every source, keyed by source id. Folders use the real project and group names made
 * safe; two siblings with the same name get ` (2)`, ` (3)` by age, as in Drive. A group whose
 * parent isn't among `groups` is placed directly in the project.
 */
export function projectFilePaths(
  projectName: string,
  groups: readonly PathGroup[],
  sources: readonly PathSource[],
): Map<string, SourcePaths> {
  const root = safeName(projectName);
  const groupIds = new Set(groups.map((g) => g.id));
  const parentOf = (g: PathGroup) =>
    g.parent_id !== null && groupIds.has(g.parent_id) ? g.parent_id : null;

  // Sibling names, made unique per parent.
  const siblings = new Map<string | null, PathGroup[]>();
  for (const group of groups) {
    const key = parentOf(group);
    const list = siblings.get(key) ?? [];
    list.push(group);
    siblings.set(key, list);
  }
  const groupName = new Map<string, string>();
  for (const list of siblings.values()) {
    const names = uniqueNames(
      list.map((g) => ({ id: g.id, name: safeName(g.name), createdAt: g.created_at })),
    );
    for (const [id, name] of names) groupName.set(id, name);
  }

  const byId = new Map(groups.map((g) => [g.id, g]));
  const folderPath = new Map<string, string>();
  const pathOf = (id: string): string => {
    const cached = folderPath.get(id);
    if (cached !== undefined) return cached;
    const group = byId.get(id)!;
    const parent = parentOf(group);
    const path = `${parent === null ? root : pathOf(parent)}/${groupName.get(id)!}`;
    folderPath.set(id, path);
    return path;
  };

  const byGroup = new Map<string, PathSource[]>();
  for (const source of sources) {
    const list = byGroup.get(source.group_id) ?? [];
    list.push(source);
    byGroup.set(source.group_id, list);
  }

  // Every path handed out, without case, so nothing in the zip can collide (a subgroup called
  // "Turbocharger_files" next to the post "Turbocharger", say).
  const taken = new Set<string>();
  for (const group of groups) taken.add(pathOf(group.id).toLowerCase());

  const result = new Map<string, SourcePaths>();
  for (const [groupId, list] of byGroup) {
    const folder = byId.has(groupId) ? pathOf(groupId) : root;
    const names = uniqueNames(
      list.map((s) => ({ id: s.id, name: safeName(s.title), createdAt: s.created_at })),
    );
    for (const source of list) {
      const extension = cleanExtension(source.extension);
      let base = names.get(source.id)!;
      let file = `${folder}/${base}.${extension}`;
      let media = `${folder}/${postImagesFolderName(`${base}.md`)}`;
      for (let n = 2; taken.has(file.toLowerCase()) || taken.has(media.toLowerCase()); n++) {
        base = `${names.get(source.id)!} (${n})`;
        file = `${folder}/${base}.${extension}`;
        media = `${folder}/${postImagesFolderName(`${base}.md`)}`;
      }
      taken.add(file.toLowerCase());
      taken.add(media.toLowerCase());
      result.set(source.id, { file, media_folder: media });
    }
  }
  return result;
}

function cleanExtension(extension: string): string {
  const ext = extension.replace(/^\./, "").toLowerCase();
  return ext in PROJECT_FILE_MEDIA_TYPES ? ext : "md";
}

/** The extension of a path or file name, lower-case, without the dot ("" when there is none). */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The media type for a path in a project file, or null when the file type isn't allowed. */
export function projectFileMediaType(path: string): string | null {
  return PROJECT_FILE_MEDIA_TYPES[extensionOf(path)] ?? null;
}

/**
 * A path inside a project file is safe to unpack when it is relative, uses `/`, and has no empty,
 * `.` or `..` parts, drive letters, control characters or characters file systems reject.
 */
export function isSafeEntryPath(path: string): boolean {
  if (path.length === 0 || path.length > 1000) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>:"|?*]/.test(path)) return false;
  for (const part of path.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
    if (part !== part.trim() || part.endsWith(".")) return false;
  }
  return true;
}
