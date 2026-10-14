import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api";
import { saveSubstack, saveSubstackUnavailable } from "@/features/capture/save-substack";
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

const xPostCaptureSchema = z.object({
  postUrl: z.string().trim().min(1, "Post URL is required"),
  authorName: z.string().trim(),
  handle: z.string().trim(),
  authorUrl: z.string().trim(),
  postedAt: z.string().trim().nullable().optional(),
  text: z.string(),
});

const captureRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("substack"),
    folder_id: z.string().uuid("Invalid folder ID"),
    capture: substackCaptureSchema,
  }),
  z.object({
    kind: z.literal("substack_unavailable"),
    folder_id: z.string().uuid("Invalid folder ID"),
    url: z.string().trim().min(1, "URL is required"),
    title: z.string().trim().min(1, "Title is required").max(500, "Title is too long"),
  }),
  z.object({
    kind: z.literal("x"),
    folder_id: z.string().uuid("Invalid folder ID"),
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
  } else if (parsed.data.kind === "substack_unavailable") {
    result = await saveSubstackUnavailable(auth.db, auth.userId, parsed.data);
  } else {
    result = await saveXThread(auth.db, auth.userId, parsed.data.folder_id, parsed.data.posts);
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
