import { describe, expect, it } from "vitest";
import { cardProblem } from "@sourcefold/core";
import {
  addTag,
  authorTypeText,
  commonTags,
  currentResearch,
  effectivePatch,
  filterItems,
  groupTags,
  removeTag,
  researchMetaLine,
  resolveFilter,
  tagSuggestions,
  type ListFilter,
  type ResearchItem,
} from "../research-logic";
import {
  buildBrollCard,
  buildQuoteCard,
  highlightIdsWithCards,
  nextParagraphSeconds,
  nextPilePosition,
} from "../card-input";

describe("research-logic", () => {
  describe("authorTypeText & researchMetaLine", () => {
    it("formats explicit author type without guess", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Test Article",
        author_type: "lab",
      };
      expect(authorTypeText(item)).toBe("Lab");
    });

    it("formats guessed author type with (guess)", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Test Article",
        source_url: "https://openai.com/research/gpt-4",
      };
      // OpenAI domain maps to lab author type guess in @sourcefold/core
      expect(authorTypeText(item)).toBe("Lab (guess)");
    });

    it("appends author and author type to metaLine", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Test Article",
        author: "John Doe",
        author_type: "company",
      };
      const baseMeta = "openai.com, 5 min read";
      const line = researchMetaLine(item, baseMeta);
      expect(line).toBe("John Doe, Company, openai.com, 5 min read");
    });

    it("handles null base metaLine cleanly", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Test Article",
        author_type: "journalist",
      };
      const line = researchMetaLine(item, null);
      expect(line).toBe("Journalist");
    });
  });

  describe("filterItems & resolveFilter", () => {
    const items: ResearchItem[] = [
      { id: "1", kind: "web", title: "Item 1", triage: "keep", tags: ["ml", "nlp"] },
      { id: "2", kind: "web", title: "Item 2", triage: "maybe", tags: ["nlp"] },
      { id: "3", kind: "web", title: "Item 3", triage: "cut", tags: ["frontend"] },
      { id: "4", kind: "web", title: "Item 4", triage: null, tags: [] },
    ];

    it("filters by status", () => {
      expect(filterItems(items, { status: "all", tag: null })).toHaveLength(4);
      expect(filterItems(items, { status: "keep", tag: null }).map((i) => i.id)).toEqual(["1"]);
      expect(filterItems(items, { status: "maybe", tag: null }).map((i) => i.id)).toEqual(["2"]);
      expect(filterItems(items, { status: "cut", tag: null }).map((i) => i.id)).toEqual(["3"]);
      expect(filterItems(items, { status: "none", tag: null }).map((i) => i.id)).toEqual(["4"]);
    });

    it("filters by tag and combined status", () => {
      expect(filterItems(items, { status: "all", tag: "nlp" }).map((i) => i.id)).toEqual([
        "1",
        "2",
      ]);
      expect(filterItems(items, { status: "keep", tag: "nlp" }).map((i) => i.id)).toEqual(["1"]);
      expect(filterItems(items, { status: "cut", tag: "nlp" })).toEqual([]);
    });

    it("resolves filter when tag leaves group", () => {
      const activeFilter: ListFilter = { status: "keep", tag: "old-tag" };
      const groupTagList = [
        { tag: "ml", count: 1 },
        { tag: "nlp", count: 2 },
      ];
      expect(resolveFilter(activeFilter, groupTagList)).toEqual({ status: "keep", tag: null });

      const validFilter: ListFilter = { status: "keep", tag: "ml" };
      expect(resolveFilter(validFilter, groupTagList)).toEqual(validFilter);
    });
  });

  describe("tags management & suggestions", () => {
    it("adds unique tags up to limit", () => {
      const res1 = addTag(["ml"], "nlp");
      expect(res1.ok).toBe(true);
      if (res1.ok) expect(res1.tags).toEqual(["ml", "nlp"]);

      // Case-insensitive deduping
      const res2 = addTag(["ml"], "ML");
      expect(res2.ok).toBe(true);
      if (res2.ok) expect(res2.tags).toEqual(["ml"]);

      // 20 limit
      const twenty = Array.from({ length: 20 }, (_, i) => `tag${i}`);
      const res3 = addTag(twenty, "overflow");
      expect(res3.ok).toBe(false);
    });

    it("removes tags", () => {
      expect(removeTag(["alpha", "beta", "gamma"], "BETA")).toEqual(["alpha", "gamma"]);
    });

    it("counts group tags and finds common tags", () => {
      const items = [{ tags: ["shared", "unique1"] }, { tags: ["shared", "unique2"] }];
      expect(commonTags(items)).toEqual(["shared"]);
      expect(groupTags(items)).toEqual([
        { tag: "shared", count: 2 },
        { tag: "unique1", count: 1 },
        { tag: "unique2", count: 1 },
      ]);
    });

    it("provides tag suggestions from sections and project tags", () => {
      const suggestions = tagSuggestions({
        sections: [
          { id: "s1", title: "Introduction", position: 1 },
          { id: "s2", title: "Methodology", position: 2 },
        ],
        projectTags: ["deep-learning", "robotics"],
        current: ["Introduction"],
      });

      // "Introduction" is already in current tags, so it shouldn't be suggested
      expect(suggestions.some((s) => s.tag === "Introduction")).toBe(false);
      expect(suggestions.find((s) => s.tag === "Methodology")?.kind).toBe("section");
      expect(suggestions.find((s) => s.tag === "deep-learning")?.kind).toBe("project");
    });
  });

  describe("patches and rollback state", () => {
    it("computes minimal effective patch", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Item 1",
        triage: "keep",
        tags: ["a"],
      };

      expect(effectivePatch(item, { triage: "keep" })).toBeNull();
      expect(effectivePatch(item, { triage: "cut" })).toEqual({ triage: "cut" });
      expect(effectivePatch(item, { tags: ["a", "b"] })).toEqual({ tags: ["a", "b"] });
    });

    it("captures research fields for item", () => {
      const item: ResearchItem = {
        id: "1",
        kind: "web",
        title: "Item 1",
        triage: "maybe",
        tags: ["tag1"],
        summary: "sum",
        author: "auth",
        author_type: "researcher",
      };
      expect(currentResearch(item)).toEqual({
        triage: "maybe",
        tags: ["tag1"],
        summary: "sum",
        author: "auth",
        author_type: "researcher",
      });
    });
  });
});

describe("card-input", () => {
  describe("nextPilePosition", () => {
    it("computes next pile position for empty and non-empty piles, ignoring placed cards", () => {
      // empty pile without floor starts at 1
      expect(nextPilePosition([])).toBe(1);

      // empty pile with floor
      expect(nextPilePosition([], 5)).toBe(6);

      // pile cards with placed cards ignored
      const cards = [
        { section_id: "sec-1", position: 100 },
        { section_id: null, position: 2 },
        { section_id: "sec-2", position: 50 },
        { section_id: null, position: 7 },
      ];
      // Highest unplaced position is 7; next position after 7 is 8
      expect(nextPilePosition(cards)).toBe(8);

      // Only placed cards in list: falls back to floor or null
      const placedOnly = [
        { section_id: "sec-1", position: 10 },
        { section_id: "sec-2", position: 20 },
      ];
      expect(nextPilePosition(placedOnly)).toBe(1);
      expect(nextPilePosition(placedOnly, 3)).toBe(4);
    });
  });

  describe("nextParagraphSeconds", () => {
    it("finds next paragraph timestamp or returns null when none follows", () => {
      const marks = [
        { offset: 0, seconds: 0 },
        { offset: 50, seconds: 15 },
        { offset: 120, seconds: 42 },
        { offset: 200, seconds: 90 },
      ];

      // Highlight ends at offset 80, starts at 15s:
      // Next paragraph at or after offset 80 with seconds > 15 is offset 120 (42s)
      expect(nextParagraphSeconds(marks, 80, 15)).toBe(42);

      // Skips marks at or after endOffset if seconds <= startSeconds
      const marksWithRewind = [
        { offset: 60, seconds: 10 },
        { offset: 90, seconds: 30 },
      ];
      expect(nextParagraphSeconds(marksWithRewind, 50, 15)).toBe(30);

      // No timestamp after the highlight end
      expect(nextParagraphSeconds(marks, 250, 90)).toBeNull();

      // Empty marks
      expect(nextParagraphSeconds([], 10, 5)).toBeNull();
    });
  });

  describe("buildQuoteCard", () => {
    it("creates quote card with expected fields positioned after the pile's last card", () => {
      const pile = [
        { section_id: null, position: 3 },
        { section_id: "sec-1", position: 10 },
      ];
      const position = nextPilePosition(pile);
      expect(position).toBe(4);

      const highlight = {
        id: "hl-1",
        item_id: "item-42",
        quote: "A key finding in the paper.",
        seconds: 75,
      };

      const card = buildQuoteCard({
        highlight,
        projectId: "proj-1",
        id: "card-1",
        position,
      });

      expect(card).not.toBeNull();
      expect(cardProblem(card!)).toBeNull();
      expect(card).toEqual({
        id: "card-1",
        project_id: "proj-1",
        kind: "quote",
        item_id: "item-42",
        highlight_id: "hl-1",
        quote: "A key finding in the paper.",
        seconds: 75,
        end_seconds: null,
        url: null,
        note: null,
        script_line: null,
        section_id: null,
        position: 4,
      });
    });

    it("returns null when highlight has no quote text", () => {
      const highlight = {
        id: "hl-2",
        item_id: "item-42",
        quote: "   ",
        seconds: null,
      };
      const card = buildQuoteCard({
        highlight,
        projectId: "proj-1",
        id: "card-2",
        position: 1,
      });
      expect(card).toBeNull();
    });
  });

  describe("buildBrollCard", () => {
    it("creates b-roll card with end_seconds from next transcript paragraph or null when none", () => {
      const highlight = {
        id: "hl-3",
        item_id: "item-yt",
        quote: "Demonstrating the assembly line",
        seconds: 120,
      };

      // Case 1: With next paragraph start as end_seconds
      const cardWithEnd = buildBrollCard({
        highlight,
        projectId: "proj-1",
        id: "broll-1",
        position: 5,
        endSeconds: 155,
      });

      expect(cardWithEnd).not.toBeNull();
      expect(cardProblem(cardWithEnd!)).toBeNull();
      expect(cardWithEnd).toEqual({
        id: "broll-1",
        project_id: "proj-1",
        kind: "broll",
        item_id: "item-yt",
        highlight_id: "hl-3",
        quote: "Demonstrating the assembly line",
        seconds: 120,
        end_seconds: 155,
        url: null,
        note: null,
        script_line: null,
        section_id: null,
        position: 5,
      });

      // Case 2: Without next paragraph (null when none)
      const cardWithoutEnd = buildBrollCard({
        highlight,
        projectId: "proj-1",
        id: "broll-2",
        position: 6,
        endSeconds: null,
      });

      expect(cardWithoutEnd).not.toBeNull();
      expect(cardProblem(cardWithoutEnd!)).toBeNull();
      expect(cardWithoutEnd?.end_seconds).toBeNull();

      // Case 3: Refuses b-roll card without start seconds
      const noSecondsCard = buildBrollCard({
        highlight: { ...highlight, seconds: null },
        projectId: "proj-1",
        id: "broll-3",
        position: 7,
        endSeconds: 155,
      });
      expect(noSecondsCard).toBeNull();
    });
  });

  describe("highlightIdsWithCards", () => {
    it("collects highlight IDs ignoring cards without highlight_id", () => {
      const cards = [
        { highlight_id: "hl-1" },
        { highlight_id: null },
        { highlight_id: "hl-2" },
        { highlight_id: "hl-1" },
        { highlight_id: null },
      ];
      const ids = highlightIdsWithCards(cards);
      expect(ids).toBeInstanceOf(Set);
      expect(ids.size).toBe(2);
      expect(ids.has("hl-1")).toBe(true);
      expect(ids.has("hl-2")).toBe(true);
      expect(ids.has("hl-unknown")).toBe(false);
    });
  });
});
