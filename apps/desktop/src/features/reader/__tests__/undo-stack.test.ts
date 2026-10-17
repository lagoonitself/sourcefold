import { describe, expect, it } from "vitest";
import type { Highlight } from "@sourcefold/core";
import { createUndoStack } from "../undo-stack";

function highlight(id: string): Highlight {
  return {
    id,
    item_id: "item",
    kind: "text",
    quote: "q",
    prefix: "",
    suffix: "",
    start_offset: 0,
    end_offset: 1,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
  };
}

describe("undo stack", () => {
  it("returns the newest change first", () => {
    const stack = createUndoStack();
    stack.push({ kind: "create", highlight: highlight("a") });
    stack.push({ kind: "note", id: "a", before: null, after: "hi" });
    stack.push({ kind: "delete", highlight: highlight("a") });
    expect(stack.pop()?.kind).toBe("delete");
    expect(stack.pop()?.kind).toBe("note");
    expect(stack.pop()?.kind).toBe("create");
    expect(stack.pop()).toBeUndefined();
  });

  it("keeps only the most recent entries", () => {
    const stack = createUndoStack(3);
    for (const id of ["a", "b", "c", "d", "e"])
      stack.push({ kind: "create", highlight: highlight(id) });
    expect(stack.size).toBe(3);
    const popped = [stack.pop(), stack.pop(), stack.pop()].map((e) =>
      e?.kind === "create" ? e.highlight.id : "?",
    );
    expect(popped).toEqual(["e", "d", "c"]);
  });

  it("drops entries that can no longer apply", () => {
    const stack = createUndoStack();
    stack.push({ kind: "create", highlight: highlight("a") });
    stack.push({ kind: "note", id: "a", before: null, after: "x" });
    stack.push({ kind: "create", highlight: highlight("b") });
    stack.discard((e) => (e.kind === "note" ? e.id === "a" : e.highlight.id === "a"));
    expect(stack.size).toBe(1);
    expect(stack.pop()).toMatchObject({ kind: "create", highlight: { id: "b" } });
  });

  it("clears", () => {
    const stack = createUndoStack();
    stack.push({ kind: "create", highlight: highlight("a") });
    stack.clear();
    expect(stack.size).toBe(0);
  });
});
