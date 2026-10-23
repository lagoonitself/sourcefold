// The manifest inside a `.sourcefold` project file (docs/PROJECT-FILE.md). The website, the
// desktop app (both modes) and later Claude read and write exactly this shape.
// Pure and browser-safe: no Node APIs.

import { z } from "zod";

export const PROJECT_FILE_FORMAT = "sourcefold-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = ".sourcefold";
/** Name of the manifest entry, always the first entry in the zip. */
export const MANIFEST_PATH = "sourcefold.json";

/** Caps applied when reading a file someone sent (it is untrusted). */
export const PROJECT_FILE_LIMITS = {
  /** The whole `.sourcefold` file. */
  fileBytes: 2 * 1024 * 1024 * 1024,
  /** Everything inside it, unpacked. */
  unpackedBytes: 4 * 1024 * 1024 * 1024,
  /** One entry, unpacked. */
  entryBytes: 200 * 1024 * 1024,
  /** The manifest, unpacked. */
  manifestBytes: 100 * 1024 * 1024,
  entries: 200_000,
  groups: 10_000,
  sources: 100_000,
  highlights: 500_000,
  cards: 100_000,
  outlineSections: 10_000,
} as const;

/** File types a project file may carry, by extension. Everything else is refused. */
export const PROJECT_FILE_MEDIA_TYPES: Record<string, string> = {
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
};

const id = z.string().min(1).max(100);
const date = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable();
const path = z.string().min(1).max(1000);

export const projectFileGroupSchema = z.object({
  id,
  /** Null for a group directly inside the project. */
  parent_id: id.nullable(),
  name: text(500),
  position: z.number().finite(),
  created_at: date,
});

export const projectFileSourceSchema = z.object({
  id,
  group_id: id,
  /** `items.kind`: grokipedia, wikipedia, substack, x, note, image, youtube, web, … */
  kind: text(40),
  title: text(1000),
  source_url: nullableText(5000),
  canonical_url: nullableText(5000),
  /** `items.meta` as stored (front matter fields of the kind). */
  meta: z.record(z.string(), z.unknown()),
  note: nullableText(100_000),
  position: z.number().finite(),
  created_at: date,
  updated_at: date,
  triage: nullableText(20),
  tags: z.array(text(200)).max(100),
  summary: nullableText(20_000),
  author: nullableText(1000),
  author_type: nullableText(40),
  /**
   * Path of the source's file in the zip: the Drive-format `.md` (docs/FILE-FORMAT.md), or the
   * image itself for `image` sources. Null when the export couldn't read it (`missing`).
   */
  file: path.nullable(),
  /** Path of the `<name>_files/` folder holding the post's images and GIFs, if any were copied. */
  media_folder: path.nullable(),
});

export const projectFileXPostSchema = z.object({
  id,
  source_id: id,
  parent_id: id.nullable(),
  post_url: text(5000),
  canonical_url: text(5000),
  author_name: text(1000),
  handle: text(200),
  author_url: text(5000),
  posted_at: date.nullable(),
  text: text(200_000),
  media: z.array(z.unknown()).max(50),
  position: z.number().finite(),
  created_at: date,
});

export const projectFileHighlightSchema = z.object({
  id,
  source_id: id,
  kind: z.enum(["text", "image"]),
  quote: text(50_000),
  prefix: text(1000),
  suffix: text(1000),
  start_offset: z.number().int().min(0),
  end_offset: z.number().int().min(0),
  image_src: nullableText(5000),
  note: nullableText(20_000),
  seconds: z.number().int().min(0).nullable(),
  cited: z.array(z.unknown()).max(200),
  created_at: date,
});

export const projectFileOutlineSectionSchema = z.object({
  id,
  title: text(500),
  position: z.number().finite(),
  created_at: date,
});

export const projectFileCardSchema = z.object({
  id,
  kind: z.enum(["quote", "broll", "line"]),
  source_id: id.nullable(),
  highlight_id: id.nullable(),
  quote: text(50_000),
  seconds: z.number().int().min(0).nullable(),
  end_seconds: z.number().int().min(0).nullable(),
  url: nullableText(5000),
  note: nullableText(20_000),
  script_line: nullableText(20_000),
  section_id: id.nullable(),
  position: z.number().finite(),
  created_at: date,
});

export const projectFileManifestSchema = z.object({
  format: z.literal(PROJECT_FILE_FORMAT),
  version: z.number().int().min(1),
  exported_at: date,
  /** Which app made it, for support: "Sourcefold web", "Sourcefold desktop (offline)". */
  app: text(200),
  project: z.object({ id, name: text(500), created_at: date }),
  groups: z.array(projectFileGroupSchema).max(PROJECT_FILE_LIMITS.groups),
  sources: z.array(projectFileSourceSchema).max(PROJECT_FILE_LIMITS.sources),
  x_posts: z.array(projectFileXPostSchema).max(PROJECT_FILE_LIMITS.sources * 50),
  highlights: z.array(projectFileHighlightSchema).max(PROJECT_FILE_LIMITS.highlights),
  outline_sections: z
    .array(projectFileOutlineSectionSchema)
    .max(PROJECT_FILE_LIMITS.outlineSections),
  cards: z.array(projectFileCardSchema).max(PROJECT_FILE_LIMITS.cards),
});

export type ProjectFileManifest = z.infer<typeof projectFileManifestSchema>;
export type ProjectFileGroup = z.infer<typeof projectFileGroupSchema>;
export type ProjectFileSource = z.infer<typeof projectFileSourceSchema>;
export type ProjectFileXPost = z.infer<typeof projectFileXPostSchema>;
export type ProjectFileHighlight = z.infer<typeof projectFileHighlightSchema>;
export type ProjectFileOutlineSection = z.infer<typeof projectFileOutlineSectionSchema>;
export type ProjectFileCard = z.infer<typeof projectFileCardSchema>;

export class ProjectFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFileError";
  }
}

/**
 * Checks a parsed `sourcefold.json`: its shape, its version, and that every reference points at
 * something in the file (a group's parent, a source's group, a highlight's source, …). Throws a
 * `ProjectFileError` with a sentence for the user.
 */
export function parseProjectManifest(json: unknown): ProjectFileManifest {
  if (
    typeof json === "object" &&
    json !== null &&
    (json as { format?: unknown }).format === PROJECT_FILE_FORMAT &&
    typeof (json as { version?: unknown }).version === "number" &&
    (json as { version: number }).version > PROJECT_FILE_VERSION
  ) {
    throw new ProjectFileError(
      "This project file was made by a newer version of Sourcefold. Update Sourcefold and try again.",
    );
  }
  const parsed = projectFileManifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new ProjectFileError(`This isn't a Sourcefold project file, or it's damaged${where}.`);
  }
  const manifest = parsed.data;
  const problem = manifestReferenceProblem(manifest);
  if (problem) throw new ProjectFileError(`This project file is damaged: ${problem}`);
  return manifest;
}

function manifestReferenceProblem(m: ProjectFileManifest): string | null {
  const unique = (ids: string[], what: string): string | null => {
    const seen = new Set<string>();
    for (const value of ids) {
      if (seen.has(value)) return `${what} ${value} appears twice.`;
      seen.add(value);
    }
    return null;
  };
  const allIds = [
    m.project.id,
    ...m.groups.map((g) => g.id),
    ...m.sources.map((s) => s.id),
    ...m.x_posts.map((p) => p.id),
    ...m.highlights.map((h) => h.id),
    ...m.outline_sections.map((s) => s.id),
    ...m.cards.map((c) => c.id),
  ];
  const duplicate = unique(allIds, "id");
  if (duplicate) return duplicate;

  const groups = new Map(m.groups.map((g) => [g.id, g]));
  for (const group of m.groups) {
    if (group.parent_id !== null && !groups.has(group.parent_id)) {
      return `group "${group.name}" is inside a group that isn't in the file.`;
    }
  }
  // No loops: walking up from any group must end at the project.
  for (const group of m.groups) {
    let current: ProjectFileGroup | undefined = group;
    for (let depth = 0; current; depth++) {
      if (depth > m.groups.length) return `group "${group.name}" is inside itself.`;
      current = current.parent_id === null ? undefined : groups.get(current.parent_id);
    }
  }

  const sources = new Map(m.sources.map((s) => [s.id, s]));
  for (const source of m.sources) {
    if (!groups.has(source.group_id)) return `source "${source.title}" has no group.`;
  }
  const posts = new Set(m.x_posts.map((p) => p.id));
  for (const post of m.x_posts) {
    if (!sources.has(post.source_id))
      return `an X post belongs to a source that isn't in the file.`;
    if (post.parent_id !== null && !posts.has(post.parent_id)) {
      return `an X post replies to a post that isn't in the file.`;
    }
  }
  const highlights = new Set<string>();
  for (const highlight of m.highlights) {
    if (!sources.has(highlight.source_id)) {
      return `a highlight belongs to a source that isn't in the file.`;
    }
    if (highlight.end_offset < highlight.start_offset) return `a highlight ends before it starts.`;
    highlights.add(highlight.id);
  }
  const sections = new Set(m.outline_sections.map((s) => s.id));
  for (const card of m.cards) {
    if (card.source_id !== null && !sources.has(card.source_id)) {
      return `a card comes from a source that isn't in the file.`;
    }
    if (card.highlight_id !== null && !highlights.has(card.highlight_id)) {
      return `a card comes from a highlight that isn't in the file.`;
    }
    if (card.section_id !== null && !sections.has(card.section_id)) {
      return `a card is in an outline section that isn't in the file.`;
    }
  }
  return null;
}

/** "Cars: 6 groups, 212 sources, 1,034 highlights, 38 MB" and its parts, for the import preview. */
export interface ProjectFileSummary {
  name: string;
  groups: number;
  sources: number;
  highlights: number;
  cards: number;
  /** Unpacked size of everything in the file. */
  bytes: number;
}

export function summarizeProjectFile(
  manifest: ProjectFileManifest,
  bytes: number,
): ProjectFileSummary {
  return {
    name: manifest.project.name,
    groups: manifest.groups.length,
    sources: manifest.sources.length,
    highlights: manifest.highlights.length,
    cards: manifest.cards.length,
    bytes,
  };
}

export function formatProjectFileSummary(summary: ProjectFileSummary): string {
  const n = (count: number, one: string, many: string) =>
    `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
  const parts = [
    n(summary.groups, "group", "groups"),
    n(summary.sources, "source", "sources"),
    n(summary.highlights, "highlight", "highlights"),
  ];
  if (summary.cards > 0) parts.push(n(summary.cards, "card", "cards"));
  parts.push(formatBytes(summary.bytes));
  return `${summary.name}: ${parts.join(", ")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** "Cars" → "Cars (2)" when "Cars" is taken (compared without case), then "(3)", … */
export function uniqueProjectName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  const base = name.trim() || "Imported project";
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}
