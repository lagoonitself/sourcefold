import { z } from "zod";
import { SECTION_TITLE_MAX } from "@sourcefold/core";

export const OUTLINE_SECTION_COLUMNS =
  "id, project_id, title, position, created_at, updated_at" as const;

export const outlineSectionIdSchema = z.string().uuid("Invalid outline section ID");

export const outlineSectionInputSchema = z.object({
  id: z.string().uuid("Invalid outline section ID"),
  project_id: z.string().uuid("Invalid project ID"),
  title: z
    .string()
    .trim()
    .min(1, "Section title is required.")
    .max(SECTION_TITLE_MAX, `Section title must be at most ${SECTION_TITLE_MAX} characters.`),
  position: z.number().refine((n) => Number.isFinite(n), "Position must be finite."),
});
