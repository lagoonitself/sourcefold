import { describe, expect, it } from "vitest";
import { foldResponse } from "../merge";
import { buildRows, selectedIndexOf } from "../rows";
import type { SearchResponse } from "../search-api";
import { note, passage } from "./fixtures";

function response(meaning: "used" | "off", ids: string[]): SearchResponse {
  return {
    passages: ids.map((id) => passage(id, `start ${id}`)),
    notes: [note("n", "n start")],
    meaning,
    took_ms: 5,
  };
}

describe("foldResponse", () => {
  it("takes a keyword answer when no meaning answer has landed", () => {
    const folded = foldResponse(response("off", ["a"]), "turbo", false);
    expect(folded?.withMeaning).toBe(false);
    expect(folded?.patch).toMatchObject({ meaning: false, passagesFor: "turbo" });
    expect(folded?.patch.passages.map((p) => p.item_id)).toEqual(["a"]);
  });

  it("lets the meaning answer replace the keyword one", () => {
    const keyword = foldResponse(response("off", ["a"]), "turbo", false);
    const meaning = foldResponse(response("used", ["b", "a"]), "turbo", keyword!.withMeaning);
    expect(meaning?.withMeaning).toBe(true);
    expect(meaning?.patch.meaning).toBe(true);
    expect(meaning?.patch.passages.map((p) => p.item_id)).toEqual(["b", "a"]);
  });

  it("drops a keyword answer that lands after the meaning one", () => {
    expect(foldResponse(response("off", ["a"]), "turbo", true)).toBeNull();
  });

  it("takes a second meaning answer", () => {
    expect(foldResponse(response("used", ["a"]), "turbo", true)).not.toBeNull();
  });

  it("keeps the selection on the same row when meaning results reorder the list", () => {
    const keyword = foldResponse(response("off", ["a", "b"]), "q", false)!.patch;
    const before = buildRows([], keyword.passages, keyword.notes);
    const selected = before.find((r) => r.type === "passage" && r.hit.item_id === "b")!.key;

    const meaning = foldResponse(response("used", ["c", "b", "a"]), "q", false)!.patch;
    const after = buildRows([], meaning.passages, meaning.notes);
    const row = after[selectedIndexOf(after, selected)];
    expect(row.type === "passage" && row.hit.item_id).toBe("b");
  });

  it("moves the selection to the top when its row is no longer listed", () => {
    const keyword = foldResponse(response("off", ["a", "b"]), "q", false)!.patch;
    const before = buildRows([], keyword.passages, keyword.notes);
    const selected = before.find((r) => r.type === "passage" && r.hit.item_id === "b")!.key;

    const meaning = foldResponse(response("used", ["c"]), "q", false)!.patch;
    const after = buildRows([], meaning.passages, meaning.notes);
    expect(selectedIndexOf(after, selected)).toBe(0);
  });
});
