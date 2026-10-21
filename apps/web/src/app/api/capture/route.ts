import { NextResponse } from "next/server";
import { z } from "zod";
import { isWikipediaArticleUrl, SOURCE_CAPTURE_KINDS } from "@sourcefold/core";
import { requireApiUser } from "@/lib/api";
import { saveSource, saveSourceUnavailable } from "@/features/capture/save-source";
import { saveSubstack, saveSubstackUnavailable } from "@/features/capture/save-substack";
import { saveWikipediaCapture } from "@/features/capture/save-wikipedia";
import { saveXThread } from "@/features/capture/save-x";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const substackCaptureSchema = z.object({
  url: z.string().trim().min(1, "URL is required"),
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  subtitle: z.string().trim().nullable().optional(),
  author: z.string().trim().nullable().optional(),
  authorUrl: z.string().trim().nullable().optional(),
  publication: z.string().trim().nullable().optional(),
  publicationUrl: z.string().trim().nullable().optional(),
  published: z.string().trim().nullable().optional(),
  access: z.enum(["free", "paid"]),
  markdown: z.string().max(500000, "Markdown body is too large"),
});

const wikipediaCaptureSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .refine(isWikipediaArticleUrl, "That isn't a Wikipedia article link."),
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  summary: z.string().trim().nullable().optional(),
  language: z.string().trim().max(32).nullable().optional(),
  revision: z
    .string()
    .trim()
    .regex(/^\d{1,15}$/, "Revision must be a number")
    .nullable()
    .optional(),
  lastEdited: z.string().trim().nullable().optional(),
  markdown: z
    .string()
    .min(1, "Article text is required")
    .max(1500000, "Markdown body is too large"),
});

const xPostCaptureSchema = z.object({
  postUrl: z.string().trim().min(1, "Post URL is required"),
  authorName: z.string().trim(),
  handle: z.string().trim(),
  authorUrl: z.string().trim(),
  postedAt: z.string().trim().nullable().optional(),
  text: z.string(),
  media: z.array(z.unknown()).max(20).optional(),
});

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }, "Enter an http or https link.");

const sourceMetaValueSchema = z.union([
  z.string().max(2000, "Metadata value is too long"),
  z.number(),
  z.null(),
]);

const sourceCaptureSchema = z.object({
  url: httpUrlSchema,
  title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  meta: z
    .record(z.string(), sourceMetaValueSchema)
    .refine((meta) => Object.keys(meta).length <= 30, "Too many metadata fields."),
  markdown: z.string().max(5_000_000, "Markdown body is too large"),
});

const captureRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("substack"),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    capture: substackCaptureSchema,
  }),
  z.object({
    kind: z.literal("wikipedia"),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    capture: wikipediaCaptureSchema,
  }),
  z.object({
    kind: z.enum(SOURCE_CAPTURE_KINDS),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    capture: sourceCaptureSchema,
  }),
  z.object({
    kind: z.literal("source_unavailable"),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    source: z.enum(SOURCE_CAPTURE_KINDS),
    url: httpUrlSchema,
    title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
    reason: z.string().trim().min(1, "Reason is required").max(300, "Reason is too long"),
  }),
  z.object({
    kind: z.literal("substack_unavailable"),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    url: z.string().trim().min(1, "URL is required"),
    title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  }),
  z.object({
    kind: z.literal("x"),
    folder_id: z.string().uuid("Invalid folder ID"),
    allow_duplicate: z.boolean().optional(),
    posts: z
      .array(xPostCaptureSchema)
      .min(1, "At least one post is required")
      .max(50, "At most 50 posts allowed"),
  }),
]);

export async function POST(request: Request) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: "Invalid JSON body",
        },
      },
      { status: 400 },
    );
  }

  const parsed = captureRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        },
      },
      { status: 400 },
    );
  }

  let result;
  if (parsed.data.kind === "substack") {
    result = await saveSubstack(auth.db, auth.userId, parsed.data);
  } else if (parsed.data.kind === "wikipedia") {
    result = await saveWikipediaCapture(
      auth.db,
      auth.userId,
      parsed.data.folder_id,
      parsed.data.capture,
      { allowDuplicate: parsed.data.allow_duplicate },
    );
  } else if (parsed.data.kind === "substack_unavailable") {
    result = await saveSubstackUnavailable(auth.db, auth.userId, parsed.data);
  } else if (parsed.data.kind === "x") {
    result = await saveXThread(auth.db, auth.userId, parsed.data.folder_id, parsed.data.posts, {
      allowDuplicate: parsed.data.allow_duplicate,
    });
  } else if (parsed.data.kind === "source_unavailable") {
    result = await saveSourceUnavailable(auth.db, auth.userId, parsed.data);
  } else {
    result = await saveSource(
      auth.db,
      auth.userId,
      parsed.data.kind,
      parsed.data.folder_id,
      parsed.data.capture,
      { allowDuplicate: parsed.data.allow_duplicate },
    );
  }

  if (result.success) {
    pushToDriveSoon(auth.userId);
    const data: { item: typeof result.item; unavailable?: true } = {
      item: result.item,
    };
    if ("unavailable" in result && result.unavailable) {
      data.unavailable = true;
    }
    return NextResponse.json({ data }, { status: 201 });
  }

  return NextResponse.json({ error: result.error }, { status: result.status });
}
