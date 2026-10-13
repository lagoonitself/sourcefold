import { buildFrontMatter, formatDate, slugify } from "@sourcefold/core";

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

export function driveFileName(
  title: string,
  itemId: string,
  siblingTitles: string[],
  ext = "md",
): string {
  const baseSlug = slugify(title) || "untitled";
  const cleanExt = ext.replace(/^\./, "");

  const hasCollision = siblingTitles.some(
    (siblingTitle) => (slugify(siblingTitle) || "untitled") === baseSlug,
  );

  const idSuffix = itemId ? itemId.slice(0, 6) : "";
  const finalSlug = hasCollision && idSuffix ? `${baseSlug}-${idSuffix}` : baseSlug;
  return cleanExt ? `${finalSlug}.${cleanExt}` : finalSlug;
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
    parts.unshift(folder.name);
    currentId = folder.parent_id;
  }

  return parts.join("/");
}

function tryFormatDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  try {
    return formatDate(value as string | Date);
  } catch {
    return undefined;
  }
}

export function buildItemFile(item: ItemData, folderPath: string): string {
  const meta =
    typeof item.meta === "object" && item.meta !== null
      ? (item.meta as Record<string, unknown>)
      : {};

  let fields: Record<string, unknown> = {};

  if (item.kind === "grokipedia") {
    fields = {
      source: "grokipedia",
      title: item.title,
      url: item.source_url ?? undefined,
      summary: typeof meta.summary === "string" ? meta.summary : undefined,
      fact_checked: tryFormatDate(meta.fact_checked_at),
      saved: tryFormatDate(item.created_at),
      folder: folderPath || undefined,
    };
  } else if (item.kind === "substack") {
    fields = {
      source: "substack",
      title: item.title,
      subtitle: typeof meta.subtitle === "string" ? meta.subtitle : undefined,
      url:
        (typeof item.canonical_url === "string" && item.canonical_url.length > 0
          ? item.canonical_url
          : item.source_url) ?? undefined,
      author: typeof meta.author === "string" ? meta.author : undefined,
      author_url: typeof meta.author_url === "string" ? meta.author_url : undefined,
      publication: typeof meta.publication === "string" ? meta.publication : undefined,
      publication_url: typeof meta.publication_url === "string" ? meta.publication_url : undefined,
      published: tryFormatDate(meta.published),
      access: typeof meta.access === "string" ? meta.access : undefined,
      saved: tryFormatDate(item.created_at),
      folder: folderPath || undefined,
    };
  } else if (item.kind === "x") {
    fields = {
      source: "x",
      title: item.title,
      url:
        (typeof meta.post_url === "string" && meta.post_url.length > 0
          ? meta.post_url
          : item.source_url) ?? undefined,
      author: typeof meta.author === "string" ? meta.author : undefined,
      author_url: typeof meta.author_url === "string" ? meta.author_url : undefined,
      posted: tryFormatDate(meta.posted),
      saved: tryFormatDate(item.created_at),
      folder: folderPath || undefined,
    };
  } else if (item.kind === "note") {
    fields = {
      source: "note",
      title: item.title,
      created: tryFormatDate(item.created_at),
      folder: folderPath || undefined,
    };
  } else {
    fields = {
      source: item.kind,
      title: item.title,
      url: item.source_url ?? undefined,
      saved: tryFormatDate(item.created_at),
      folder: folderPath || undefined,
    };
  }

  const rawMarkdown = item.markdown ?? "";
  let body: string;

  const newlineIdx = rawMarkdown.indexOf("\n");
  if (newlineIdx === -1) {
    if (rawMarkdown.startsWith("# ")) {
      body = `# ${item.title}`;
    } else if (rawMarkdown.length > 0) {
      body = `# ${item.title}\n\n${rawMarkdown}`;
    } else {
      body = `# ${item.title}\n\n`;
    }
  } else {
    const firstLine = rawMarkdown.slice(0, newlineIdx).replace(/\r$/, "");
    if (firstLine.startsWith("# ")) {
      body = `# ${item.title}${rawMarkdown.slice(newlineIdx)}`;
    } else {
      body = `# ${item.title}\n\n${rawMarkdown}`;
    }
  }

  if (item.note && item.note.trim() !== "" && item.kind !== "note") {
    if (!body.endsWith("\n")) {
      body += "\n";
    }
    body += `\n## My note\n\n${item.note.trim()}\n`;
  }

  const frontMatter = buildFrontMatter(fields as Parameters<typeof buildFrontMatter>[0]);
  const combined = `${frontMatter}\n${body}`.trimEnd() + "\n";
  return combined;
}
