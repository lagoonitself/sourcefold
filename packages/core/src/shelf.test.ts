import { describe, expect, it } from "vitest";
import {
  normalizeShelfTags,
  normalizeShelfUrl,
  parseBookmarksHtml,
  parseShelfTagsText,
  parseShelfUrls,
  shelfKey,
  shelfMatches,
  shelfTagCounts,
  shelfTitleFallback,
  sortShelf,
  type ShelfLink,
} from "./shelf";

function link(over: Partial<ShelfLink>): ShelfLink {
  return {
    id: "id",
    url: "https://example.com",
    key: "example.com",
    title: "Example",
    note: "",
    tags: [],
    pinned: false,
    open_count: 0,
    last_opened_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

describe("shelfKey", () => {
  it("drops www, case, default port, hash and trailing slash, keeps the query", () => {
    expect(shelfKey("https://WWW.Example.com:443/Docs/?q=1#top")).toBe("example.com/Docs?q=1");
    expect(shelfKey("http://example.com/")).toBe("example.com");
    expect(shelfKey("http://localhost:3000/app")).toBe("localhost:3000/app");
  });
  it("refuses what isn't http(s)", () => {
    expect(shelfKey("ftp://example.com")).toBeNull();
    expect(shelfKey("javascript:alert(1)")).toBeNull();
    expect(shelfKey("not a url")).toBeNull();
  });
});

describe("normalizeShelfUrl", () => {
  it("adds https when the scheme is missing", () => {
    expect(normalizeShelfUrl("supabase.com/dashboard")).toBe("https://supabase.com/dashboard");
  });
  it("refuses words and other schemes", () => {
    expect(normalizeShelfUrl("hello")).toBeNull();
    expect(normalizeShelfUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeShelfUrl("")).toBeNull();
  });
});

describe("tags", () => {
  it("trims, drops #, dedupes case-insensitively", () => {
    expect(normalizeShelfTags([" #Dev ", "dev", "AI  tools", "", 3])).toEqual(["Dev", "AI tools"]);
    expect(parseShelfTagsText("a, b ,#c,,A")).toEqual(["a", "b", "c"]);
  });
  it("counts tags across links", () => {
    const counts = shelfTagCounts([link({ tags: ["dev", "ai"] }), link({ tags: ["Dev"] })]);
    expect(counts).toEqual([
      { tag: "dev", count: 2 },
      { tag: "ai", count: 1 },
    ]);
  });
});

describe("sortShelf", () => {
  const now = new Date("2026-11-05T00:00:00.000Z");
  it("puts pinned first, then recent heavy use, then never-opened newest first", () => {
    const sorted = sortShelf(
      [
        link({ id: "new", created_at: "2026-11-04T00:00:00.000Z" }),
        link({ id: "old", created_at: "2026-10-01T00:00:00.000Z" }),
        link({ id: "stale", open_count: 10, last_opened_at: "2026-08-01T00:00:00.000Z" }),
        link({ id: "fresh", open_count: 3, last_opened_at: "2026-11-04T00:00:00.000Z" }),
        link({ id: "pin", pinned: true }),
      ],
      now,
    );
    expect(sorted.map((l) => l.id)).toEqual(["pin", "fresh", "stale", "new", "old"]);
  });
});

describe("filters and pasted text", () => {
  it("matches title, url, note and tags", () => {
    const l = link({ title: "Supabase", note: "billing under Org", tags: ["infra"] });
    expect(shelfMatches(l, "billing")).toBe(true);
    expect(shelfMatches(l, "INFRA")).toBe(true);
    expect(shelfMatches(l, "vercel")).toBe(false);
  });
  it("splits pasted URLs and drops duplicates and words", () => {
    expect(parseShelfUrls("https://a.com\nwww.a.com/ hello b.org/x")).toEqual([
      "https://a.com/",
      "https://b.org/x",
    ]);
  });
  it("falls back to the host for a title", () => {
    expect(shelfTitleFallback("https://www.figma.com/files")).toBe("figma.com");
  });
});

describe("parseBookmarksHtml", () => {
  it("reads links with their folders as tags, skipping the browser's top folders", () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://github.com/" ADD_DATE="1">GitHub</A>
    <DT><H3>Dev &amp; Ops</H3>
    <DL><p>
      <DT><A HREF="https://vercel.com/dashboard">Vercel</A>
      <DT><A HREF="javascript:void(0)">Bookmarklet</A>
      <DT><A HREF="https://github.com">GitHub again</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://news.ycombinator.com/">Hacker News</A>
</DL><p>`;
    expect(parseBookmarksHtml(html)).toEqual([
      { url: "https://github.com/", title: "GitHub", tags: [] },
      { url: "https://vercel.com/dashboard", title: "Vercel", tags: ["Dev & Ops"] },
      { url: "https://news.ycombinator.com/", title: "Hacker News", tags: [] },
    ]);
  });
});
