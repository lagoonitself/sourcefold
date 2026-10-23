import { z } from "zod";
import { sortCards } from "@sourcefold/core";
import { jsonData, jsonError } from "../http";
import { CARD_COLUMNS, filterLiveCards } from "../features/research/cards";
import type { RouteContext } from "../context";

const idSchema = z.string().uuid();

export async function GET(auth: RouteContext, request: Request) {
  const url = new URL(request.url);
  const project = url.searchParams.get("project")?.trim() || null;
  const item = url.searchParams.get("item")?.trim() || null;

  if (!project && !item) {
    return jsonError(400, "Query parameter 'project' or 'item' is required.");
  }
  if (project && item) {
    return jsonError(400, "Use either 'project' or 'item', not both.");
  }

  if (project) {
    if (!idSchema.safeParse(project).success) {
      return jsonError(400, "Invalid project ID");
    }

    const { data: cards, error } = await auth.db
      .from("cards")
      .select(CARD_COLUMNS)
      .eq("project_id", project)
      .eq("user_id", auth.userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) return jsonError(500, error.message);

    try {
      const liveCards = await filterLiveCards(auth.db, auth.userId, cards ?? []);
      return jsonData(sortCards(liveCards));
    } catch (err) {
      return jsonError(500, err instanceof Error ? err.message : "Failed to filter cards.");
    }
  }

  if (item) {
    if (!idSchema.safeParse(item).success) {
      return jsonError(400, "Invalid item ID");
    }

    const { data: cards, error } = await auth.db
      .from("cards")
      .select(CARD_COLUMNS)
      .eq("item_id", item)
      .eq("user_id", auth.userId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) return jsonError(500, error.message);

    try {
      const liveCards = await filterLiveCards(auth.db, auth.userId, cards ?? []);
      return jsonData(sortCards(liveCards));
    } catch (err) {
      return jsonError(500, err instanceof Error ? err.message : "Failed to filter cards.");
    }
  }

  return jsonError(400, "Query parameter 'project' or 'item' is required.");
}
