import { z } from "zod";
import { HIGHLIGHT_LIMITS } from "@sourcefold/core";

const noteSchema = z
  .string()
  .max(HIGHLIGHT_LIMITS.note, `Note must be at most ${HIGHLIGHT_LIMITS.note} characters.`)
  .nullable()
  // An empty note means "no note".
  .transform((value) => (value === "" ? null : value));

const citationSchema = z.object({
  n: z.string().max(20, "Citation label is too long."),
  title: z.string().max(1000, "Citation title is too long.").nullable(),
  url: z.string().min(1, "Citation URL is required.").max(4096, "Citation URL is too long."),
});

export const highlightIdSchema = z.string().uuid("Invalid highlight ID");

export const highlightInputSchema = z
  .object({
    id: z.string().uuid("Invalid highlight ID"),
    item_id: z.string().uuid("Invalid item ID"),
    kind: z.enum(["text", "image"], "Kind must be text or image."),
    quote: z
      .string()
      .max(HIGHLIGHT_LIMITS.quote, `Quote must be at most ${HIGHLIGHT_LIMITS.quote} characters.`),
    prefix: z
      .string()
      .max(
        HIGHLIGHT_LIMITS.context,
        `Prefix must be at most ${HIGHLIGHT_LIMITS.context} characters.`,
      ),
    suffix: z
      .string()
      .max(
        HIGHLIGHT_LIMITS.context,
        `Suffix must be at most ${HIGHLIGHT_LIMITS.context} characters.`,
      ),
    start_offset: z
      .number()
      .int("Offsets must be whole numbers.")
      .min(0, "Offsets can't be negative."),
    end_offset: z
      .number()
      .int("Offsets must be whole numbers.")
      .min(0, "Offsets can't be negative."),
    image_src: z.string().max(4096, "Image address is too long.").nullable(),
    note: noteSchema,
    seconds: z
      .number()
      .int("Seconds must be a whole number.")
      .min(0, "Seconds can't be negative.")
      .nullable(),
    cited: z
      .array(citationSchema)
      .max(HIGHLIGHT_LIMITS.cited, `At most ${HIGHLIGHT_LIMITS.cited} cited references.`),
  })
  .refine((h) => h.end_offset >= h.start_offset, {
    message: "end_offset can't be before start_offset.",
    path: ["end_offset"],
  })
  .refine((h) => h.kind !== "text" || h.quote.trim().length > 0, {
    message: "A text highlight needs a quote.",
    path: ["quote"],
  })
  .refine((h) => h.kind !== "image" || Boolean(h.image_src), {
    message: "An image highlight needs image_src.",
    path: ["image_src"],
  });

export const highlightNotePatchSchema = z.object({ note: noteSchema });
