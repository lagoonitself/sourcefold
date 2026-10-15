import {
  buildItemFile as buildItemFileCore,
  safeName,
  uniqueNames,
  type BuildItemInput,
} from "@sourcefold/core";

export interface FolderRef {
  id: string;
  parent_id: string | null;
  name: string;
}

export interface ItemData {
  id: string;
  kind: string;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  created_at: string;
  markdown?: string | null;
  meta?: unknown;
  note?: string | null;
}

export interface SiblingItem {
  id?: string;
  title: string;
  ext?: string;
  kind?: string;
  meta?: unknown;
  created_at?: string | Date;
}

export type SiblingRef = string | SiblingItem;

export function itemExtension(kind?: string, meta?: unknown): string {
  if (!kind || kind !== "image") {
    return "md";
  }
  const m = typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {};
  if (typeof m.file_name === "string" && m.file_name.includes(".")) {
    const ext = m.file_name.split(".").pop()?.trim();
    if (ext) return ext;
  }
  const mimeType = (m.mime_type as string) || "";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "bin";
}

function parseSibling(sibling: SiblingRef): {
  id?: string;
  name: string;
  ext: string;
  createdAt?: string | Date;
} {
  if (typeof sibling === "string") {
    if (sibling.includes(".")) {
      const lastDot = sibling.lastIndexOf(".");
      const namePart = sibling.slice(0, lastDot);
      const extPart = sibling.slice(lastDot + 1).toLowerCase();
      return { name: safeName(namePart), ext: extPart };
    }
    return { name: safeName(sibling), ext: "md" };
  }

  const ext = (sibling.ext ?? itemExtension(sibling.kind, sibling.meta))
    .replace(/^\./, "")
    .toLowerCase();
  return {
    id: sibling.id,
    name: safeName(sibling.title),
    ext,
    createdAt: sibling.created_at,
  };
}

export function driveFileName(
  title: string,
  itemId: string,
  siblingTitles: SiblingRef[],
  ext = "md",
  createdAt?: string | Date,
): string {
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  const currentSafeName = safeName(title);

  const collidingEntries: { id: string; name: string; createdAt: string | Date | number }[] = [];
  let currentFound = false;

  for (let i = 0; i < siblingTitles.length; i++) {
    const parsed = parseSibling(siblingTitles[i]!);
    if (parsed.ext === cleanExt && parsed.name.toLowerCase() === currentSafeName.toLowerCase()) {
      const id = parsed.id || `sibling-${i}`;
      if (id === itemId) {
        currentFound = true;
        collidingEntries.push({
          id: itemId,
          name: currentSafeName,
          createdAt: createdAt ?? parsed.createdAt ?? 0,
        });
      } else {
        collidingEntries.push({
          id,
          name: parsed.name,
          createdAt: parsed.createdAt ?? 0,
        });
      }
    }
  }

  if (!currentFound) {
    collidingEntries.push({
      id: itemId,
      name: currentSafeName,
      createdAt: createdAt ?? 0,
    });
  }

  if (collidingEntries.length === 1) {
    return cleanExt ? `${currentSafeName}.${cleanExt}` : currentSafeName;
  }

  const resolved = uniqueNames(collidingEntries);
  const finalName = resolved.get(itemId) ?? currentSafeName;
  return cleanExt ? `${finalName}.${cleanExt}` : finalName;
}

export function folderPathOf(
  folderId: string | null | undefined,
  foldersById: Map<string, FolderRef>,
): string {
  if (!folderId) return "";
  const parts: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) {
      break;
    }
    parts.unshift(safeName(folder.name));
    currentId = folder.parent_id;
  }

  return parts.join("/");
}

export function buildItemFile(item: ItemData, folderPath: string): string {
  return buildItemFileCore(item as unknown as BuildItemInput, folderPath);
}
