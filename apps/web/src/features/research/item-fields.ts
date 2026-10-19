import { z } from "zod";
import { AUTHOR_TYPES, RESEARCH_LIMITS, TRIAGE_VALUES, normalizeTags } from "@sourcefold/core";

/** The research columns every item row carries (docs/dev/handoff-research.md). */
export const ITEM_RESEARCH_COLUMNS = "triage, tags, summary, author, author_type" as const;

// An empty (or blank) string clears the field.
const clearable = (limit: number, message: string) =>
  z
    .string()
    .max(limit, message)
    .nullable()
    .transform((val) => (val === null || val.trim() === "" ? null : val.trim()));

/**
 * The research fields `PATCH /api/items/<id>` accepts. A key left out stays as it is; `null` (or
 * an empty string) clears it. Tags are normalized, and more than 20 are refused.
 */
export const researchPatchShape = {
  triage: z
    .enum(TRIAGE_VALUES, { error: "Status must be keep, maybe or cut." })
    .nullable()
    .optional(),
  tags: z
    .array(z.string(), { error: "Tags must be a list of text." })
    // Repeats and blanks go in normalization, so the raw list may run past 20; this only stops
    // an absurd request.
    .max(200, `At most ${RESEARCH_LIMITS.tags} tags.`)
    .transform((tags) => normalizeTags(tags))
    .refine((tags) => tags.length <= RESEARCH_LIMITS.tags, `At most ${RESEARCH_LIMITS.tags} tags.`)
    .optional(),
  summary: clearable(
    RESEARCH_LIMITS.summary,
    `Summary must be at most ${RESEARCH_LIMITS.summary} characters.`,
  ).optional(),
  author: clearable(
    RESEARCH_LIMITS.author,
    `Author must be at most ${RESEARCH_LIMITS.author} characters.`,
  ).optional(),
  author_type: z
    .enum(AUTHOR_TYPES, { error: `Author type must be one of: ${AUTHOR_TYPES.join(", ")}.` })
    .nullable()
    .optional(),
};

export const RESEARCH_KEYS = ["triage", "tags", "summary", "author", "author_type"] as const;
