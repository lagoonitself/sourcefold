import { z } from "zod";
import {
  projectFileCardSchema,
  projectFileGroupSchema,
  projectFileHighlightSchema,
  projectFileOutlineSectionSchema,
  projectFileSourceSchema,
  projectFileXPostSchema,
} from "@sourcefold/core/project-file";

// The body of `POST /api/projects/{id}/import`: the manifest's row schemas, with uuid ids, the
// source fields the import adds, and a cap on the rows of one call.

export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const IMPORT_MAX_MARKDOWN = 5_000_000;

/** Every `items.kind` the database accepts. */
export const IMPORT_SOURCE_KINDS = [
  "grokipedia",
  "substack",
  "wikipedia",
  "x",
  "note",
  "image",
  "youtube",
  "web",
  "reddit",
  "pdf",
  "hackernews",
  "bluesky",
] as const;

const uuid = z.string().uuid("An id in the file isn't valid.");
const nullableUuid = uuid.nullable();

const groupRow = projectFileGroupSchema.extend({ id: uuid, parent_id: nullableUuid });

const sourceRow = projectFileSourceSchema.omit({ file: true, media_folder: true }).extend({
  id: uuid,
  group_id: uuid,
  kind: z.enum(IMPORT_SOURCE_KINDS, { message: "A source in the file has an unknown type." }),
  markdown: z.string().max(IMPORT_MAX_MARKDOWN, "A source's text is too long.").nullable(),
  storage_path: z.string().max(400).nullable(),
});

const xPostRow = projectFileXPostSchema.extend({
  id: uuid,
  source_id: uuid,
  parent_id: nullableUuid,
});

const highlightRow = projectFileHighlightSchema.extend({ id: uuid, source_id: uuid });

const sectionRow = projectFileOutlineSectionSchema.extend({ id: uuid });

const cardRow = projectFileCardSchema.extend({
  id: uuid,
  source_id: nullableUuid,
  highlight_id: nullableUuid,
  section_id: nullableUuid,
});

const rows = <T extends z.ZodType>(row: T) => z.array(row).max(IMPORT_MAX_ROWS).optional();

export const importRequestSchema = z.object({
  project: z
    .object({ name: z.string().trim().min(1, "The project needs a name.").max(500) })
    .optional(),
  groups: rows(groupRow),
  sources: rows(sourceRow),
  x_posts: rows(xPostRow),
  highlights: rows(highlightRow),
  outline_sections: rows(sectionRow),
  cards: rows(cardRow),
  done: z.boolean().optional(),
});

export type ImportRequest = z.infer<typeof importRequestSchema>;
