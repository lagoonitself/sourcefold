import type { Item } from "@/lib/types";
import type { NoteHit, PassageHit } from "../search-api";

export function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    folder_id: "g1",
    kind: "grokipedia",
    title: `Title ${id}`,
    source_url: null,
    status: "saved",
    meta: {},
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

export function passage(
  id: string,
  start: string,
  overrides: Partial<PassageHit> = {},
): PassageHit {
  return {
    item_id: id,
    project_id: "p1",
    folder_id: "g1",
    title: `Title ${id}`,
    kind: "grokipedia",
    url: null,
    heading: "",
    snippet: "",
    passage_start: start,
    seconds: null,
    matched: "keyword",
    score: 1,
    ...overrides,
  };
}

export function note(id: string, start: string, overrides: Partial<NoteHit> = {}): NoteHit {
  return {
    item_id: id,
    project_id: "p1",
    folder_id: "g1",
    title: `Title ${id}`,
    kind: "grokipedia",
    url: null,
    source: "highlight",
    snippet: "",
    passage_start: start,
    seconds: null,
    matched: "keyword",
    score: 1,
    ...overrides,
  };
}
