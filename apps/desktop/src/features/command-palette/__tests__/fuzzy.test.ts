import { describe, expect, it } from "vitest";
import { filterFuzzy, fuzzyMatch } from "../fuzzy";

describe("fuzzyMatch", () => {
  it("matches exact strings with highest score", () => {
    const exact = fuzzyMatch("command", "command");
    const partial = fuzzyMatch("com", "command");
    expect(exact.match).toBe(true);
    expect(partial.match).toBe(true);
    expect(exact.score).toBeGreaterThan(partial.score);
  });

  it("matches subsequences", () => {
    const res = fuzzyMatch("cp", "Command Palette");
    expect(res.match).toBe(true);
  });

  it("rejects non-matching targets", () => {
    const res = fuzzyMatch("xyz", "Command Palette");
    expect(res.match).toBe(false);
  });

  it("rewards word boundaries", () => {
    // "sp" matching "Search Projects" vs "Super"
    const scoreWordBoundary = fuzzyMatch("sp", "Search Projects").score;
    const scoreMidWord = fuzzyMatch("sp", "Super Person").score;
    expect(scoreWordBoundary).toBeGreaterThan(0);
  });
});

describe("filterFuzzy", () => {
  it("filters and sorts items by relevance", () => {
    const items = [
      { id: "1", title: "Add links" },
      { id: "2", title: "Command palette" },
      { id: "3", title: "Archive project" },
      { id: "4", title: "Keyboard shortcuts" },
    ];

    const results = filterFuzzy(items, "com", (item) => item.title);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBe("Command palette");
  });

  it("returns all items when query is empty", () => {
    const items = [
      { id: "1", title: "A" },
      { id: "2", title: "B" },
    ];
    expect(filterFuzzy(items, "", (i) => i.title)).toEqual(items);
  });
});
