import { type CardInput, type CardKind, cardProblem } from "@sourcefold/core";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import {
  CARD_COLUMNS,
  cardIdSchema,
  cardInputSchema,
  cardPatchSchema,
  isLiveItem,
} from "@/features/research/cards";
import { isProjectId, loadLiveFolders, projectIdOf } from "@/features/research/projects";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!cardIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid card ID");
  }

  const json = await readJson(request);
  if (!json.ok) return jsonError(400, "Invalid JSON body");

  const parsed = cardInputSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  if (parsed.data.id !== id) {
    return jsonError(400, "The card id in the body must match the URL.");
  }

  // Load live folders for project validation
  let folders;
  try {
    folders = await loadLiveFolders(auth.db, auth.userId);
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "Failed to load folders.");
  }

  if (!isProjectId(folders, parsed.data.project_id)) {
    return jsonError(400, "Invalid project ID: must be a top-level project.");
  }

  // If item_id is provided, must be a live source of the user in this project
  if (parsed.data.item_id) {
    const { data: itemData, error: itemError } = await auth.db
      .from("items")
      .select("id, folder_id")
      .eq("id", parsed.data.item_id)
      .eq("user_id", auth.userId)
      .is("deleted_at", null)
      .maybeSingle();

    if (itemError) return jsonError(500, itemError.message);
    const item = Array.isArray(itemData) ? itemData[0] : itemData;
    if (!item) return jsonError(404, "Item not found.");

    const itemProjectId = projectIdOf(folders, item.folder_id);
    if (!itemProjectId) {
      return jsonError(404, "Item not found.");
    }
    if (itemProjectId !== parsed.data.project_id) {
      return jsonError(400, "Item does not belong to this project.");
    }
  }

  // If highlight_id is provided, must be a highlight of item_id
  if (parsed.data.highlight_id) {
    if (!parsed.data.item_id) {
      return jsonError(400, "A highlight card needs an item.");
    }

    const { data: highlight, error: hlError } = await auth.db
      .from("highlights")
      .select("id")
      .eq("id", parsed.data.highlight_id)
      .eq("item_id", parsed.data.item_id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (hlError) return jsonError(500, hlError.message);
    if (!highlight) return jsonError(400, "Highlight not found.");
  }

  // If section_id is provided, must be an outline section of this project
  if (parsed.data.section_id) {
    const { data: section, error: secError } = await auth.db
      .from("outline_sections")
      .select("id")
      .eq("id", parsed.data.section_id)
      .eq("project_id", parsed.data.project_id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (secError) return jsonError(500, secError.message);
    if (!section) return jsonError(400, "Section not found.");
  }

  // Check if card with this id exists
  const { data: existing, error: existingError } = await auth.db
    .from("cards")
    .select("id, user_id, item_id, project_id")
    .eq("id", id)
    .maybeSingle();

  if (existingError) return jsonError(500, existingError.message);
  if (existing && existing.user_id !== auth.userId) {
    return jsonError(404, "Card not found.");
  }

  if (existing && existing.item_id) {
    let live = false;
    try {
      live = await isLiveItem(auth.db, auth.userId, existing.item_id, existing.project_id, folders);
    } catch (err) {
      return jsonError(500, err instanceof Error ? err.message : "Failed to verify source.");
    }
    if (!live) {
      return jsonError(404, "Card not found.");
    }
  }

  const row = {
    project_id: parsed.data.project_id,
    kind: parsed.data.kind,
    item_id: parsed.data.item_id,
    highlight_id: parsed.data.highlight_id,
    quote: parsed.data.quote,
    seconds: parsed.data.seconds,
    end_seconds: parsed.data.end_seconds,
    url: parsed.data.url,
    note: parsed.data.note,
    script_line: parsed.data.script_line,
    section_id: parsed.data.section_id,
    position: parsed.data.position,
  };

  const result = existing
    ? await auth.db
        .from("cards")
        .update(row)
        .eq("id", id)
        .eq("user_id", auth.userId)
        .select(CARD_COLUMNS)
        .maybeSingle()
    : await auth.db
        .from("cards")
        .insert({ ...row, id, user_id: auth.userId })
        .select(CARD_COLUMNS)
        .maybeSingle();

  if (result.error) {
    if (result.error.code === "23505") return jsonError(404, "Card not found.");
    return jsonError(500, result.error.message);
  }
  if (!result.data) return jsonError(404, "Card not found.");

  return jsonData(result.data);
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!cardIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid card ID");
  }

  const json = await readJson(request);
  if (!json.ok) return jsonError(400, "Invalid JSON body");

  const parsed = cardPatchSchema.safeParse(json.body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body");
  }

  const { data: existing, error: existingError } = await auth.db
    .from("cards")
    .select(CARD_COLUMNS)
    .eq("id", id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (existingError) return jsonError(500, existingError.message);
  if (!existing) return jsonError(404, "Card not found.");

  if (existing.item_id) {
    let live = false;
    try {
      live = await isLiveItem(auth.db, auth.userId, existing.item_id, existing.project_id);
    } catch (err) {
      return jsonError(500, err instanceof Error ? err.message : "Failed to verify source.");
    }
    if (!live) {
      return jsonError(404, "Card not found.");
    }
  }

  const candidate: CardInput = {
    id: existing.id,
    project_id: existing.project_id,
    kind: existing.kind as CardKind,
    item_id: existing.item_id,
    highlight_id: existing.highlight_id,
    quote: parsed.data.quote !== undefined ? parsed.data.quote : existing.quote,
    seconds: parsed.data.seconds !== undefined ? parsed.data.seconds : existing.seconds,
    end_seconds:
      parsed.data.end_seconds !== undefined ? parsed.data.end_seconds : existing.end_seconds,
    url: parsed.data.url !== undefined ? parsed.data.url : existing.url,
    note: parsed.data.note !== undefined ? parsed.data.note : existing.note,
    script_line:
      parsed.data.script_line !== undefined ? parsed.data.script_line : existing.script_line,
    section_id: parsed.data.section_id !== undefined ? parsed.data.section_id : existing.section_id,
    position: parsed.data.position !== undefined ? parsed.data.position : existing.position,
  };

  const problem = cardProblem(candidate);
  if (problem) {
    return jsonError(400, problem);
  }

  if (parsed.data.section_id) {
    const { data: section, error: secError } = await auth.db
      .from("outline_sections")
      .select("id")
      .eq("id", parsed.data.section_id)
      .eq("project_id", existing.project_id)
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (secError) return jsonError(500, secError.message);
    if (!section) return jsonError(400, "Section not found.");
  }

  const { data: updated, error: updateError } = await auth.db
    .from("cards")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select(CARD_COLUMNS)
    .maybeSingle();

  if (updateError) return jsonError(500, updateError.message);
  if (!updated) return jsonError(404, "Card not found.");

  return jsonData(updated);
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!cardIdSchema.safeParse(id).success) {
    return jsonError(400, "Invalid card ID");
  }

  const { data, error } = await auth.db
    .from("cards")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select("id")
    .maybeSingle();

  if (error) return jsonError(500, error.message);
  if (!data) return jsonError(404, "Card not found.");

  return jsonData({ id });
}
