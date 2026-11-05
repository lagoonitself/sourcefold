import { describe, expect, it } from "vitest";
import type { ShelfLink } from "@sourcefold/core";
import {
  chunkItems,
  filterShelf,
  formatShelfOpened,
  planShelfAdd,
  shelfAddMessage,
  shelfImportMessage,
  shelfNoteLine,
  shelfTileLetter,
} from "../shelf-format";

function link(overrides: Partial<ShelfLink> = {}): ShelfLink {
  return {
    id: "1",
    url: "https://www.example.com/docs",
    key: "example.com/docs",
    title: "Example docs",
    note: "",
    tags: [],
    pinned: false,
    open_count: 0,
    last_opened_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatShelfOpened", () => {
  const now = new Date(2026, 10, 5, 15); // 5 November 2026, afternoon, local time

  it("says never for a link that was not opened", () => {
    expect(formatShelfOpened(null, now)).toBe("Never opened");
  });

  it("counts whole calendar days", () => {
    expect(formatShelfOpened(new Date(2026, 10, 5, 8).toISOString(), now)).toBe("Opened today");
    expect(formatShelfOpened(new Date(2026, 10, 4, 23).toISOString(), now)).toBe(
      "Opened yesterday",
    );
    expect(formatShelfOpened(new Date(2026, 10, 2, 9).toISOString(), now)).toBe(
      "Opened 3 days ago",
    );
  });

  it("shows a date once a week has passed", () => {
    // The date's order follows the machine's locale, so only the shape and the day are checked.
    const text = formatShelfOpened(new Date(2026, 9, 26, 9).toISOString(), now);
    expect(text).toMatch(/^Opened /);
    expect(text).toContain("26");
  });

  it("treats an unreadable date as never opened", () => {
    expect(formatShelfOpened("not a date", now)).toBe("Never opened");
  });
});

describe("shelfNoteLine", () => {
  it("returns the first line that has text", () => {
    expect(shelfNoteLine("\n  First useful line  \nSecond")).toBe("First useful line");
    expect(shelfNoteLine("")).toBe("");
    expect(shelfNoteLine("   \n  ")).toBe("");
  });
});

describe("shelfTileLetter", () => {
  it("uses the first letter of the host, without www", () => {
    expect(shelfTileLetter("https://www.github.com/x")).toBe("G");
    expect(shelfTileLetter("https://arxiv.org/abs/1")).toBe("A");
  });
});

describe("filterShelf", () => {
  const links = [
    link({ id: "a", title: "Engine notes", tags: ["Engines"] }),
    link({ id: "b", title: "Turbo", url: "https://turbo.example/x", tags: ["Engines", "Cars"] }),
    link({ id: "c", title: "Lag", tags: ["Cars"] }),
  ];

  it("keeps everything for an empty filter", () => {
    expect(filterShelf(links, "", []).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("matches the text and requires every chosen tag, ignoring case", () => {
    expect(filterShelf(links, "turbo", []).map((l) => l.id)).toEqual(["b"]);
    expect(filterShelf(links, "", ["engines", "CARS"]).map((l) => l.id)).toEqual(["b"]);
    expect(filterShelf(links, "lag", ["Engines"]).map((l) => l.id)).toEqual([]);
  });
});

describe("planShelfAdd", () => {
  it("is empty and quiet for blank text", () => {
    expect(planShelfAdd("   ")).toEqual({ urls: [], error: null });
  });

  it("reads one link, with the scheme added when it is missing", () => {
    expect(planShelfAdd("example.com")).toEqual({
      urls: ["https://example.com/"],
      error: null,
    });
  });

  it("reads several links, one per line, and drops duplicates", () => {
    const plan = planShelfAdd("https://a.example\nhttps://b.example\nhttps://a.example");
    expect(plan.urls).toHaveLength(2);
    expect(plan.error).toBeNull();
  });

  it("explains text that is not a web address", () => {
    expect(planShelfAdd("hello there").error).toMatch(/web address/);
  });
});

describe("shelf messages", () => {
  const made = (id: string) => link({ id });

  it("says what was added and what was already there", () => {
    expect(shelfAddMessage({ added: [made("1")], existing: [] })).toBe("Added to shelf");
    expect(shelfAddMessage({ added: [1, 2, 3, 4].map((n) => made(`${n}`)), existing: [] })).toBe(
      "Added 4 links",
    );
    expect(
      shelfAddMessage({
        added: [1, 2, 3, 4].map((n) => made(`${n}`)),
        existing: [made("9")],
      }),
    ).toBe("Added 4 links, 1 was already on your shelf");
    expect(shelfAddMessage({ added: [], existing: [made("9")] })).toBe(
      "That link is already on your shelf",
    );
  });

  it("gives the import counts", () => {
    expect(shelfImportMessage(300, 12)).toBe(
      "Imported 300 links, skipped 12 already on your shelf",
    );
    expect(shelfImportMessage(5, 0)).toBe("Imported 5 links to your shelf");
    expect(shelfImportMessage(0, 3)).toBe(
      "Nothing imported, all 3 links were already on your shelf",
    );
  });
});

describe("chunkItems", () => {
  it("splits into batches of at most the size, in order", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([], 2)).toEqual([]);
  });
});
