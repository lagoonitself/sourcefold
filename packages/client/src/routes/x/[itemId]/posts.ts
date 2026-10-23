import { z } from "zod";
import { canonicalizeUrl, normalizeXMedia } from "@sourcefold/core";
import { jsonData } from "../../../http";
import { rerenderXItem } from "../../../features/capture/save-x";
import type { RouteContext } from "../../../context";

const addPostSchema = z.object({
  post: z.object({
    postUrl: z.string().trim().min(1, "Post URL is required"),
    authorName: z.string().trim(),
    handle: z.string().trim(),
    authorUrl: z.string().trim(),
    postedAt: z.string().trim().nullable().optional(),
    text: z.string(),
    media: z.array(z.unknown()).max(20).optional(),
  }),
  parent_post_url: z.string().trim().optional(),
});

export async function POST(auth: RouteContext, request: Request, params: { itemId: string }) {
  const { itemId } = params;
  if (!itemId || !z.string().uuid().safeParse(itemId).success) {
    return Response.json(
      { error: { code: "not_found", message: "Thread not found." } },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: "Invalid JSON body",
        },
      },
      { status: 400 },
    );
  }

  const parsed = addPostSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid request body",
        },
      },
      { status: 400 },
    );
  }

  // Item must exist, be live, kind "x", belong to user (404 otherwise)
  const { data: item, error: itemError } = await auth.db
    .from("items")
    .select("id")
    .eq("id", itemId)
    .eq("user_id", auth.userId)
    .eq("kind", "x")
    .is("deleted_at", null)
    .maybeSingle();

  if (itemError || !item) {
    return Response.json(
      { error: { code: "not_found", message: "Thread not found." } },
      { status: 404 },
    );
  }

  let postCanonical: string;
  try {
    postCanonical = canonicalizeUrl(parsed.data.post.postUrl);
  } catch {
    return Response.json(
      { error: { code: "invalid_url", message: "That isn't a valid link." } },
      { status: 400 },
    );
  }

  // If the post's canonical URL is already in the item -> 409
  const { data: existingPost } = await auth.db
    .from("x_posts")
    .select("id")
    .eq("item_id", itemId)
    .eq("user_id", auth.userId)
    .eq("canonical_url", postCanonical)
    .maybeSingle();

  if (existingPost) {
    return Response.json(
      {
        error: {
          code: "duplicate",
          message: "Already in this thread",
        },
      },
      { status: 409 },
    );
  }

  // Determine parent node
  const { data: existingPosts, error: postsError } = await auth.db
    .from("x_posts")
    .select("id, parent_id, canonical_url, position")
    .eq("item_id", itemId)
    .eq("user_id", auth.userId);

  if (postsError) {
    return Response.json(
      { error: { code: "unknown", message: postsError.message } },
      { status: 500 },
    );
  }

  let parentId: string | null = null;
  if (parsed.data.parent_post_url) {
    try {
      const parentCanonical = canonicalizeUrl(parsed.data.parent_post_url);
      const parentNode = existingPosts?.find((p) => p.canonical_url === parentCanonical);
      if (parentNode) {
        parentId = parentNode.id;
      }
    } catch {
      // If invalid url, not found
    }
  }

  if (!parentId) {
    const rootNode = existingPosts?.find((p) => p.parent_id === null);
    parentId = rootNode?.id ?? null;
  }

  // position = max sibling position + 1
  const siblings = existingPosts?.filter((p) => p.parent_id === parentId) ?? [];
  const maxSiblingPosition =
    siblings.length > 0 ? Math.max(...siblings.map((s) => s.position)) : -1;
  const position = maxSiblingPosition + 1;

  const cleanHandle = parsed.data.post.handle.replace(/^@/, "");

  const insertResult = await auth.db
    .from("x_posts")
    .insert({
      user_id: auth.userId,
      item_id: itemId,
      parent_id: parentId,
      post_url: parsed.data.post.postUrl,
      canonical_url: postCanonical,
      author_name: parsed.data.post.authorName,
      handle: cleanHandle,
      author_url: parsed.data.post.authorUrl,
      posted_at: parsed.data.post.postedAt || null,
      text: parsed.data.post.text,
      position,
      media: normalizeXMedia(parsed.data.post.media),
    })
    .select("id")
    .single();

  if (insertResult.error || !insertResult.data) {
    if (
      insertResult.error?.code === "23505" ||
      insertResult.error?.message.includes("duplicate key")
    ) {
      return Response.json(
        {
          error: {
            code: "duplicate",
            message: "Already in this thread",
          },
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error: {
          code: "unknown",
          message: insertResult.error?.message ?? "Failed to save post.",
        },
      },
      { status: 500 },
    );
  }

  const newPost = insertResult.data;

  try {
    await rerenderXItem(auth.db, auth.userId, itemId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to rerender thread.";
    return Response.json(
      {
        error: {
          code: "unknown",
          message,
        },
      },
      { status: 500 },
    );
  }

  auth.host.scheduleDrivePush(auth.userId);
  return jsonData({ item_id: itemId, post_id: newPost.id }, 201);
}
