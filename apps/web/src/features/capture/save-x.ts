import {
  canonicalizeUrl,
  renderXThreadMarkdown,
  xThreadTitle,
  type XTreeNode,
} from "@sourcefold/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  findDuplicate,
  formatDuplicateMessage,
  invalidFolderMessage,
  nextPosition,
} from "./find-duplicate";
import type { SavedCaptureItem } from "./save-substack";

export type SaveXSuccess = {
  success: true;
  status: 201;
  item: SavedCaptureItem;
};

export type SaveXDuplicateError = {
  success: false;
  status: 409;
  error: {
    code: "duplicate";
    message: string;
    item_id: string;
    folder_id: string;
    folder_name: string;
  };
};

export type SaveXGeneralError = {
  success: false;
  status: 400 | 500;
  error: {
    code: string;
    message: string;
  };
};

export type SaveXResult = SaveXSuccess | SaveXDuplicateError | SaveXGeneralError;

export interface XPostInput {
  postUrl: string;
  authorName: string;
  handle: string;
  authorUrl: string;
  postedAt?: string | null;
  text: string;
}

export async function rerenderXItem(
  db: SupabaseClient<Database>,
  userId: string,
  itemId: string,
): Promise<{ title: string; markdown: string }> {
  // Load all x_posts of the item (user filtered)
  const { data: posts, error: postsError } = await db
    .from("x_posts")
    .select("*")
    .eq("item_id", itemId)
    .eq("user_id", userId);

  if (postsError) {
    throw new Error(postsError.message);
  }

  // Map to XTreeNode
  const nodes: XTreeNode[] = (posts ?? []).map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    position: r.position,
    postUrl: r.post_url,
    authorName: r.author_name,
    handle: r.handle,
    authorUrl: r.author_url,
    postedAt: r.posted_at,
    text: r.text,
  }));

  // Load the item's current title
  const { data: item, error: itemError } = await db
    .from("items")
    .select("title")
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();

  if (itemError || !item) {
    throw new Error(itemError?.message ?? "Item not found");
  }

  // If the item title still equals the auto title for the previous node count
  // (starts with "Post by " or "Thread by "), update the title to xThreadTitle(nodes) first,
  // then render with it (user renames are kept).
  let currentTitle = item.title;
  const isAutoTitle = currentTitle.startsWith("Post by ") || currentTitle.startsWith("Thread by ");
  if (isAutoTitle) {
    currentTitle = xThreadTitle(nodes);
  }

  const markdown = renderXThreadMarkdown(nodes, currentTitle);

  const updatePayload: { markdown: string; title?: string } = { markdown };
  if (isAutoTitle) {
    updatePayload.title = currentTitle;
  }

  const { error: updateError } = await db
    .from("items")
    .update(updatePayload)
    .eq("id", itemId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return { title: currentTitle, markdown };
}

export async function saveXThread(
  db: SupabaseClient<Database>,
  userId: string,
  folderId: string,
  posts: XPostInput[],
): Promise<SaveXResult> {
  if (posts.length === 0) {
    return {
      success: false,
      status: 400,
      error: { code: "invalid_request", message: "Thread must contain at least one post." },
    };
  }

  // Canonicalize each post's URL
  const canonicalUrls: string[] = [];
  for (const post of posts) {
    try {
      canonicalUrls.push(canonicalizeUrl(post.postUrl));
    } catch {
      return {
        success: false,
        status: 400,
        error: { code: "invalid_url", message: "That isn't a valid link." },
      };
    }
  }

  const rootCanonical = canonicalUrls[0]!;

  // Duplicate check on root post URL
  const rootExisting = await findDuplicate(db, userId, rootCanonical, folderId);
  if (rootExisting) {
    return {
      success: false,
      status: 409,
      error: {
        code: "duplicate",
        message: formatDuplicateMessage(rootExisting.folder_name),
        item_id: rootExisting.item_id,
        folder_id: rootExisting.folder_id,
        folder_name: rootExisting.folder_name,
      },
    };
  }

  // Check if ANY of the posts is already a node of a live X item in this group
  const { data: existingNodes } = await db
    .from("x_posts")
    .select("item_id, canonical_url")
    .eq("user_id", userId)
    .in("canonical_url", canonicalUrls);

  if (existingNodes && existingNodes.length > 0) {
    const candidateItemIds = Array.from(new Set(existingNodes.map((n) => n.item_id)));
    const { data: liveItem } = await db
      .from("items")
      .select("id, folder_id, folders!items_folder_id_fkey(name, deleted_at)")
      .eq("user_id", userId)
      .in("id", candidateItemIds)
      .eq("folder_id", folderId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (liveItem) {
      const folder = Array.isArray(liveItem.folders) ? liveItem.folders[0] : liveItem.folders;
      const folderName =
        folder && !folder.deleted_at && folder.name ? folder.name : "another folder";

      return {
        success: false,
        status: 409,
        error: {
          code: "duplicate",
          message: formatDuplicateMessage(folderName),
          item_id: liveItem.id,
          folder_id: liveItem.folder_id,
          folder_name: folderName,
        },
      };
    }
  }

  const position = await nextPosition(db, userId, folderId);

  // Pre-generate IDs for x_posts rows
  const postIds = posts.map(() => crypto.randomUUID());

  // Build tree nodes and compute final title and markdown in memory
  const nodes: XTreeNode[] = posts.map((p, idx) => ({
    id: postIds[idx]!,
    parentId: idx === 0 ? null : postIds[idx - 1]!,
    position: 0,
    postUrl: p.postUrl,
    authorName: p.authorName,
    handle: p.handle.replace(/^@/, ""),
    authorUrl: p.authorUrl,
    postedAt: p.postedAt ?? null,
    text: p.text,
  }));

  const title = xThreadTitle(nodes);
  const markdown = renderXThreadMarkdown(nodes, title);

  const cleanRootHandle = posts[0]!.handle.replace(/^@/, "");
  const meta = {
    author: `${posts[0]!.authorName} (@${cleanRootHandle})`,
    author_url: posts[0]!.authorUrl,
    posted: posts[0]!.postedAt ?? null,
    post_url: posts[0]!.postUrl,
  };

  const { data: item, error: insertItemError } = await db
    .from("items")
    .insert({
      user_id: userId,
      folder_id: folderId,
      kind: "x",
      status: "saved",
      title,
      source_url: posts[0]!.postUrl,
      canonical_url: rootCanonical,
      markdown,
      meta,
      position,
    })
    .select("id, folder_id, kind, title, source_url, status, created_at")
    .single();

  if (insertItemError) {
    if (insertItemError.message.includes("invalid folder")) {
      return {
        success: false,
        status: 400,
        error: {
          code: "invalid_folder",
          message: invalidFolderMessage(insertItemError.message),
        },
      };
    }

    if (insertItemError.code === "23505" || insertItemError.message.includes("duplicate key")) {
      const raceExisting = await findDuplicate(db, userId, rootCanonical, folderId);
      const folderName = raceExisting?.folder_name ?? "another folder";
      return {
        success: false,
        status: 409,
        error: {
          code: "duplicate",
          message: formatDuplicateMessage(folderName),
          item_id: raceExisting?.item_id ?? "",
          folder_id: raceExisting?.folder_id ?? folderId,
          folder_name: folderName,
        },
      };
    }

    return {
      success: false,
      status: 500,
      error: {
        code: "save_failed",
        message: insertItemError.message || "Failed to save item.",
      },
    };
  }

  if (!item) {
    return {
      success: false,
      status: 500,
      error: {
        code: "unknown",
        message: "Failed to save item.",
      },
    };
  }

  // Insert x_posts rows in ONE batch insert
  const postRows = posts.map((post, idx) => ({
    id: postIds[idx]!,
    user_id: userId,
    item_id: item.id,
    parent_id: idx === 0 ? null : postIds[idx - 1]!,
    post_url: post.postUrl,
    canonical_url: canonicalUrls[idx]!,
    author_name: post.authorName,
    handle: post.handle.replace(/^@/, ""),
    author_url: post.authorUrl,
    posted_at: post.postedAt || null,
    text: post.text,
    position: 0,
  }));

  try {
    const { error: insertPostsError } = await db.from("x_posts").insert(postRows);
    if (insertPostsError) {
      throw new Error(insertPostsError.message);
    }
  } catch {
    // On failure after the item was inserted, clean up:
    // delete the x_posts for that item (filter user_id) as well as removing the item
    // (hard delete the item row if nothing else references it; otherwise soft-delete as now).
    await db.from("x_posts").delete().eq("item_id", item.id).eq("user_id", userId);

    const { error: hardDeleteError } = await db
      .from("items")
      .delete()
      .eq("id", item.id)
      .eq("user_id", userId);

    if (hardDeleteError) {
      await db
        .from("items")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("user_id", userId);
    }

    return {
      success: false,
      status: 500,
      error: {
        code: "save_failed",
        message: "Couldn't save this thread. Try again.",
      },
    };
  }

  return {
    success: true,
    status: 201,
    item,
  };
}
