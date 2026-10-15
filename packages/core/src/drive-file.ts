import { buildFrontMatter, formatDate, type FrontMatterValue } from "./front-matter";

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const NOTE_HEADING = "\n## My note\n";

export type ItemKind = "grokipedia" | "substack" | "wikipedia" | "x" | "note" | string;

export interface BuildItemInput {
  kind: ItemKind;
  title: string;
  url?: string | null;
  source_url?: string | null;
  canonical_url?: string | null;
  folder?: string | null;
  saved?: string | null;
  created?: string | null;
  created_at?: string | Date | null;
  meta?: Record<string, unknown> | null;
  markdown?: string | null;
  body?: string | null;
  note?: string | null;
}

function tryFormatDate(val?: unknown): string | undefined {
  if (!val) return undefined;
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  try {
    return formatDate(val as string | Date);
  } catch {
    return undefined;
  }
}

// A Wikipedia revision id is a whole number; it goes into the front matter unquoted.
function revisionNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isSafeInteger(val) && val > 0) return val;
  if (typeof val === "string" && /^\d{1,15}$/.test(val.trim())) return Number(val.trim());
  return undefined;
}

// Recovers the Markdown body from a file Sourcefold wrote to Drive: drops the front matter
// and the trailing "## My note" section, which are rebuilt from the database on every save.
export function bodyFromDriveFile(fileText: string): string {
  let body = fileText.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
  body = body.replace(FRONT_MATTER, "");

  const noteStart = body.lastIndexOf(NOTE_HEADING);
  if (noteStart !== -1) {
    body = body.slice(0, noteStart);
  }

  return body.replace(/^\n+/, "").trimEnd() + "\n";
}

/**
 * Builds the canonical Drive Markdown file content for an item.
 * Layout:
 * ---
 * <front matter>
 * ---
 *
 * # <Title>
 *
 * [*<subtitle>*] (Substack only)
 *
 * [> Saved from ...] (source line, omitted for notes)
 *
 * <body>
 *
 * [## My note]
 */
export function buildItemFile(item: BuildItemInput, folderPath?: string): string {
  const folder = folderPath !== undefined ? folderPath : (item.folder ?? "");
  const meta = (item.meta ?? {}) as Record<string, unknown>;

  const itemUrl =
    (typeof item.canonical_url === "string" && item.canonical_url.length > 0
      ? item.canonical_url
      : item.source_url || item.url) || undefined;

  let fields: Record<string, FrontMatterValue>;

  if (item.kind === "grokipedia") {
    fields = {
      source: "grokipedia",
      title: item.title,
      url: itemUrl,
      summary:
        typeof meta.summary === "string" && meta.summary.trim() ? meta.summary.trim() : undefined,
      fact_checked: tryFormatDate(meta.fact_checked ?? meta.fact_checked_at),
      saved: tryFormatDate(item.saved ?? item.created_at),
      folder: folder || undefined,
    };
  } else if (item.kind === "wikipedia") {
    fields = {
      source: "wikipedia",
      title: item.title,
      url: itemUrl,
      summary:
        typeof meta.summary === "string" && meta.summary.trim() ? meta.summary.trim() : undefined,
      language:
        typeof meta.language === "string" && meta.language.trim()
          ? meta.language.trim()
          : undefined,
      revision: revisionNumber(meta.revision),
      last_edited: tryFormatDate(meta.last_edited),
      saved: tryFormatDate(item.saved ?? item.created_at),
      folder: folder || undefined,
    };
  } else if (item.kind === "substack") {
    fields = {
      source: "substack",
      title: item.title,
      subtitle:
        typeof meta.subtitle === "string" && meta.subtitle.trim()
          ? meta.subtitle.trim()
          : undefined,
      url: itemUrl,
      author:
        typeof meta.author === "string" && meta.author.trim() ? meta.author.trim() : undefined,
      author_url:
        typeof meta.author_url === "string" && meta.author_url.trim()
          ? meta.author_url.trim()
          : undefined,
      publication:
        typeof meta.publication === "string" && meta.publication.trim()
          ? meta.publication.trim()
          : undefined,
      publication_url:
        typeof meta.publication_url === "string" && meta.publication_url.trim()
          ? meta.publication_url.trim()
          : undefined,
      published: tryFormatDate(meta.published),
      access:
        typeof meta.access === "string" && meta.access.trim() ? meta.access.trim() : undefined,
      saved: tryFormatDate(item.saved ?? item.created_at),
      folder: folder || undefined,
    };
  } else if (item.kind === "x") {
    const postUrl =
      typeof meta.post_url === "string" && meta.post_url.length > 0 ? meta.post_url : itemUrl;
    fields = {
      source: "x",
      title: item.title,
      url: postUrl,
      author:
        typeof meta.author === "string" && meta.author.trim() ? meta.author.trim() : undefined,
      author_url:
        typeof meta.author_url === "string" && meta.author_url.trim()
          ? meta.author_url.trim()
          : undefined,
      posted: tryFormatDate(meta.posted),
      saved: tryFormatDate(item.saved ?? item.created_at),
      folder: folder || undefined,
    };
  } else if (item.kind === "note") {
    fields = {
      source: "note",
      title: item.title,
      created: tryFormatDate(item.created ?? item.created_at),
      folder: folder || undefined,
    };
  } else {
    fields = {
      source: item.kind,
      title: item.title,
      url: itemUrl,
      saved: tryFormatDate(item.saved ?? item.created_at),
      folder: folder || undefined,
    };
  }

  const frontMatter = buildFrontMatter(fields);

  // Compute Source line
  let sourceLine: string | null = null;
  const savedDate = tryFormatDate(item.saved ?? item.created_at) || "";

  if (item.kind === "grokipedia") {
    const url = itemUrl || "";
    sourceLine = `> Saved from [Grokipedia](${url}) on ${savedDate}. Grokipedia articles change; check the live page for edits.`;
  } else if (item.kind === "wikipedia") {
    const url = itemUrl || "";
    sourceLine = `> Saved from [Wikipedia](${url}) on ${savedDate}. Wikipedia articles change; check the live page for edits.`;
  } else if (item.kind === "substack") {
    const pub = (typeof meta.publication === "string" && meta.publication.trim()) || "Substack";
    const url = itemUrl || "";
    let line = `> Saved from [${pub}](${url}) on ${savedDate}.`;
    if (typeof meta.author === "string" && meta.author.trim()) {
      line += ` By ${meta.author.trim()}.`;
    }
    const published = tryFormatDate(meta.published);
    if (published) {
      line += ` Published ${published}.`;
    }
    sourceLine = line;
  } else if (item.kind === "x") {
    const url =
      (typeof meta.post_url === "string" && meta.post_url.length > 0 ? meta.post_url : itemUrl) ||
      "";
    sourceLine = `> Saved from [X](${url}) on ${savedDate}.`;
  } else if (item.kind === "note") {
    sourceLine = null;
  } else if (itemUrl) {
    sourceLine = `> Saved from [${item.kind}](${itemUrl}) on ${savedDate}.`;
  }

  // Clean raw body
  let rawBody = (item.markdown ?? item.body ?? "").replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
  rawBody = rawBody.replace(FRONT_MATTER, "");

  const noteIdx = rawBody.lastIndexOf(NOTE_HEADING);
  if (noteIdx !== -1) {
    rawBody = rawBody.slice(0, noteIdx);
  }

  let text = rawBody.trim();

  // Strip leading # Title if present (repeatedly or once)
  if (text.startsWith("# ")) {
    text = text.replace(/^#[^\n]*\n*/, "").trimStart();
  }

  // If Substack and has subtitle, strip matching *subtitle* line if present
  if (item.kind === "substack" && typeof meta.subtitle === "string" && meta.subtitle.trim()) {
    const expectedSubtitle = `*${meta.subtitle.trim()}*`;
    if (text.startsWith(expectedSubtitle)) {
      text = text.slice(expectedSubtitle.length).trimStart();
    }
  }

  // Strip any old or existing source lines: "> Saved from ..."
  while (text.startsWith("> Saved from ") || text.startsWith(">Saved from ")) {
    text = text.replace(/^>[^\n]*\n*/, "").trimStart();
  }

  // In case there was another leading "# " before or after the source line
  if (text.startsWith("# ")) {
    text = text.replace(/^#[^\n]*\n*/, "").trimStart();
  }

  // Ensure body headings start at ##
  text = text.replace(/^#\s+(.+)$/gm, "## $1");

  // Collapse 3+ newlines to 2
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // Assemble sections
  const sections: string[] = [];

  // # Title
  sections.push(`# ${item.title.trim()}`);

  // Substack subtitle
  if (item.kind === "substack" && typeof meta.subtitle === "string" && meta.subtitle.trim()) {
    sections.push(`*${meta.subtitle.trim()}*`);
  }

  // Source line
  if (sourceLine) {
    sections.push(sourceLine);
  }

  // Body
  if (text) {
    sections.push(text);
  }

  // User note (omitted for kind "note" where the body is the note)
  if (item.kind !== "note" && typeof item.note === "string" && item.note.trim()) {
    sections.push(`## My note\n\n${item.note.trim()}`);
  }

  return `${frontMatter}\n${sections.join("\n\n")}\n`;
}
