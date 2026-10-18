import { describe, expect, it } from "vitest";
import { buildRows, selectedIndexOf, stepIndex } from "../rows";
import { item, note, passage } from "./fixtures";

describe("buildRows", () => {
  it("lists sources, then passages, then highlights and notes", () => {
    const rows = buildRows([item("a")], [passage("a", "one two")], [note("b", "three four")]);
    expect(rows.map((r) => r.type)).toEqual(["source", "passage", "note"]);
  });

  it("gives rows keys that stay the same when the list is rebuilt", () => {
    const first = buildRows([], [passage("a", "one"), passage("b", "two")], []);
    const second = buildRows([], [passage("b", "two"), passage("a", "one")], []);
    const keyOf = (rows: typeof first, id: string) =>
      rows.find((r) => r.type === "passage" && r.hit.item_id === id)?.key;
    expect(keyOf(first, "a")).toBe(keyOf(second, "a"));
    expect(keyOf(first, "b")).toBe(keyOf(second, "b"));
  });

  it("keeps keys unique when two hits would share one", () => {
    const rows = buildRows([], [passage("a", "same start"), passage("a", "same start")], []);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("tells a highlight from a note on the same source and place", () => {
    const rows = buildRows(
      [],
      [],
      [note("a", "x", { source: "highlight" }), note("a", "x", { source: "note" })],
    );
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("does not mix up a passage and a source with the same id", () => {
    const rows = buildRows([item("a")], [passage("a", "x")], []);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("returns nothing for empty results", () => {
    expect(buildRows([], [], [])).toEqual([]);
  });
});

describe("selectedIndexOf", () => {
  const rows = buildRows([item("a")], [passage("b", "x"), passage("c", "y")], []);

  it("starts on the first row", () => {
    expect(selectedIndexOf(rows, null)).toBe(0);
  });

  it("follows the selected row when the list is reordered", () => {
    const key = rows[2].key; // passage c
    const reordered = buildRows([item("a")], [passage("c", "y"), passage("b", "x")], []);
    expect(selectedIndexOf(reordered, key)).toBe(1);
  });

  it("follows the row when new rows appear above it", () => {
    const key = rows[1].key;
    const grown = buildRows(
      [item("a")],
      [passage("z", "z"), passage("b", "x"), passage("c", "y")],
      [],
    );
    expect(selectedIndexOf(grown, key)).toBe(2);
  });

  it("falls back to the first row when the selected row is gone", () => {
    const key = rows[2].key;
    const shrunk = buildRows([item("a")], [passage("b", "x")], []);
    expect(selectedIndexOf(shrunk, key)).toBe(0);
  });

  it("is 0 for an empty list", () => {
    expect(selectedIndexOf([], "anything")).toBe(0);
  });
});

describe("stepIndex", () => {
  it("moves down and up", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, -1, 3)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  it("stays at 0 when there are no rows", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(stepIndex(0, -1, 0)).toBe(0);
  });
});
