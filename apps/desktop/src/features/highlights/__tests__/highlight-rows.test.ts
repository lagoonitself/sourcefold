import { describe, expect, it } from "vitest";
import type { Highlight } from "@sourcefold/core";
import {
  buildHighlightRows,
  citedLabel,
  copiedMessage,
  isTabSwitchKey,
  pruneSelection,
  rowsToCopy,
  tabFor,
  toggleGroupTab,
  toggleSelection,
  toHighlightInput,
} from "../highlight-rows";

function highlight(id: string, itemId: string, start: number, created = "2026-10-01T00:00:00Z") {
  return {
    id,
    item_id: itemId,
    kind: "text",
    quote: `quote ${id}`,
    prefix: "",
    suffix: "",
    start_offset: start,
    end_offset: start + 5,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: created,
    updated_at: created,
  } satisfies Highlight;
}

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("buildHighlightRows", () => {
  it("orders by the sources' list order, then start offset, then created_at", () => {
    const rows = buildHighlightRows(
      [
        highlight("h1", "b", 10),
        highlight("h2", "a", 50),
        highlight("h3", "a", 5),
        highlight("h4", "b", 10, "2026-09-01T00:00:00Z"),
        highlight("h5", "c", 0),
      ],
      items,
    );
    expect(rows.map((r) => r.highlight.id)).toEqual(["h3", "h2", "h4", "h1", "h5"]);
  });

  it("joins the source and drops highlights of sources that are not listed", () => {
    const rows = buildHighlightRows([highlight("h1", "a", 0), highlight("h2", "gone", 0)], items);
    expect(rows).toHaveLength(1);
    expect(rows[0].item).toBe(items[0]);
  });

  it("does not change the input order", () => {
    const input = [highlight("h1", "b", 0), highlight("h2", "a", 0)];
    buildHighlightRows(input, items);
    expect(input.map((h) => h.id)).toEqual(["h1", "h2"]);
  });
});

describe("selection", () => {
  const ids = ["1", "2", "3", "4", "5"];

  it("toggles one row", () => {
    const on = toggleSelection(ids, new Set(), "2", null, false);
    expect([...on]).toEqual(["2"]);
    expect(toggleSelection(ids, on, "2", "2", false).size).toBe(0);
  });

  it("selects a Shift-click range from the last clicked row", () => {
    const next = toggleSelection(ids, new Set(["2"]), "4", "2", true);
    expect([...next].sort()).toEqual(["2", "3", "4"]);
  });

  it("works upward and deselects a range when the clicked row is selected", () => {
    const all = new Set(ids);
    const next = toggleSelection(ids, all, "2", "4", true);
    expect([...next].sort()).toEqual(["1", "5"]);
  });

  it("treats Shift-click without an earlier click as a plain toggle", () => {
    expect([...toggleSelection(ids, new Set(), "3", null, true)]).toEqual(["3"]);
  });

  it("prunes ids that left the list", () => {
    expect([...pruneSelection(new Set(["1", "x"]), ids)]).toEqual(["1"]);
  });
});

describe("copy", () => {
  const rows = buildHighlightRows(
    [highlight("h1", "a", 0), highlight("h2", "a", 9), highlight("h3", "b", 0)],
    items,
  );

  it("copies all rows when nothing is selected", () => {
    expect(rowsToCopy(rows, new Set()).map((r) => r.highlight.id)).toEqual(["h1", "h2", "h3"]);
  });

  it("copies only the selected rows, in list order", () => {
    expect(rowsToCopy(rows, new Set(["h3", "h1"])).map((r) => r.highlight.id)).toEqual([
      "h1",
      "h3",
    ]);
  });

  it("words the toast", () => {
    expect(copiedMessage(1)).toBe("Copied 1 highlight with sources");
    expect(copiedMessage(10)).toBe("Copied 10 highlights with sources");
  });

  it("turns a highlight back into the input for undo", () => {
    const input = toHighlightInput(highlight("h1", "a", 0));
    expect(input).not.toHaveProperty("created_at");
    expect(input).not.toHaveProperty("updated_at");
    expect(input.id).toBe("h1");
  });
});

describe("cited label", () => {
  it("lists each domain once without www", () => {
    expect(
      citedLabel([
        { n: "1", title: null, url: "https://www.sae.org/paper" },
        { n: "2", title: null, url: "https://sae.org/other" },
        { n: "3", title: "x", url: "https://nature.com/a" },
      ]),
    ).toBe("cited sae.org, nature.com");
  });

  it("is null when nothing is cited", () => {
    expect(citedLabel([])).toBeNull();
  });
});

describe("tabs", () => {
  const key = (over: Partial<Parameters<typeof isTabSwitchKey>[0]> = {}) => ({
    key: "H",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...over,
  });

  it("switches between Sources and Highlights", () => {
    expect(toggleGroupTab("sources")).toBe("highlights");
    expect(toggleGroupTab("highlights")).toBe("sources");
  });

  it("recognises Shift+H only", () => {
    expect(isTabSwitchKey(key())).toBe(true);
    expect(isTabSwitchKey(key({ key: "h", shiftKey: false }))).toBe(false);
    expect(isTabSwitchKey(key({ ctrlKey: true }))).toBe(false);
    expect(isTabSwitchKey(key({ altKey: true }))).toBe(false);
  });

  it("resets to Sources when another group opens", () => {
    const chosen = { folderId: "g1", tab: "highlights" as const };
    expect(tabFor(chosen, "g1")).toBe("highlights");
    expect(tabFor(chosen, "g2")).toBe("sources");
  });
});
