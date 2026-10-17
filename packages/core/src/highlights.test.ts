import { describe, expect, it } from "vitest";
import {
  buildHighlightsSection,
  copySourceFromItem,
  formatHighlightTime,
  formatQuoteWithSource,
  formatQuotesWithSources,
  youtubeTimestampUrl,
  type FileHighlight,
  type Highlight,
} from "./highlights";

function hl(over: Partial<Highlight> = {}): Highlight {
  return {
    id: "h1",
    item_id: "i1",
    kind: "text",
    quote: "A quote.",
    prefix: "",
    suffix: "",
    start_offset: 0,
    end_offset: 8,
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    created_at: "2026-10-16T12:00:00.000Z",
    updated_at: "2026-10-16T12:00:00.000Z",
    ...over,
  };
}

function fh(over: Partial<FileHighlight> = {}): FileHighlight {
  const { id, kind, quote, image_src, note, seconds, cited, start_offset, created_at } = hl(over);
  return { id, kind, quote, image_src, note, seconds, cited, start_offset, created_at };
}

const YT = "https://www.youtube.com/watch?v=abcDEF12345";

describe("copySourceFromItem", () => {
  it("YouTube: channel and YouTube", () => {
    expect(
      copySourceFromItem({
        kind: "youtube",
        title: " Turbos ",
        canonical_url: YT,
        meta: { channel: "Engineering Explained" },
      }),
    ).toEqual({ title: "Turbos", byline: ["Engineering Explained", "YouTube"], url: YT });
  });

  it("drops empty parts", () => {
    expect(
      copySourceFromItem({ kind: "youtube", title: "T", meta: { channel: "  " } }).byline,
    ).toEqual(["YouTube"]);
    expect(copySourceFromItem({ kind: "x", title: "T" }).byline).toEqual(["X"]);
  });

  it("Substack: author and publication, else Substack", () => {
    expect(
      copySourceFromItem({
        kind: "substack",
        title: "T",
        meta: { author: "Ann", publication: "The Pub" },
      }).byline,
    ).toEqual(["Ann", "The Pub"]);
    expect(
      copySourceFromItem({ kind: "substack", title: "T", meta: { author: "Ann" } }).byline,
    ).toEqual(["Ann", "Substack"]);
  });

  it("Grokipedia, Wikipedia, note", () => {
    expect(copySourceFromItem({ kind: "grokipedia", title: "T" }).byline).toEqual(["Grokipedia"]);
    expect(copySourceFromItem({ kind: "wikipedia", title: "T" }).byline).toEqual(["Wikipedia"]);
    expect(copySourceFromItem({ kind: "note", title: "T" }).byline).toEqual(["Note"]);
  });

  it("X, Hacker News, Bluesky", () => {
    const meta = { author: "bob" };
    expect(copySourceFromItem({ kind: "x", title: "T", meta }).byline).toEqual(["bob", "X"]);
    expect(copySourceFromItem({ kind: "hackernews", title: "T", meta }).byline).toEqual([
      "bob",
      "Hacker News",
    ]);
    expect(copySourceFromItem({ kind: "bluesky", title: "T", meta }).byline).toEqual([
      "bob",
      "Bluesky",
    ]);
  });

  it("web: author and site, else the host without www.", () => {
    expect(
      copySourceFromItem({ kind: "web", title: "T", meta: { author: "A", site: "Example Blog" } })
        .byline,
    ).toEqual(["A", "Example Blog"]);
    expect(
      copySourceFromItem({
        kind: "web",
        title: "T",
        source_url: "https://www.example.com/post",
      }).byline,
    ).toEqual(["example.com"]);
  });

  it("Reddit: subreddit or Reddit", () => {
    expect(
      copySourceFromItem({ kind: "reddit", title: "T", meta: { subreddit: "rust" } }).byline,
    ).toEqual(["r/rust"]);
    expect(copySourceFromItem({ kind: "reddit", title: "T" }).byline).toEqual(["Reddit"]);
  });

  it("PDF: arXiv when set, else host", () => {
    expect(
      copySourceFromItem({
        kind: "pdf",
        title: "T",
        meta: { author: "Lee", arxiv: "2401.01234" },
        canonical_url: "https://arxiv.org/pdf/2401.01234",
      }).byline,
    ).toEqual(["Lee", "arXiv"]);
    expect(
      copySourceFromItem({
        kind: "pdf",
        title: "T",
        meta: { author: "Lee" },
        canonical_url: "https://www.example.org/a.pdf",
      }).byline,
    ).toEqual(["Lee", "example.org"]);
  });

  it("prefers canonical_url, then source_url, then null", () => {
    expect(
      copySourceFromItem({
        kind: "web",
        title: "T",
        canonical_url: "https://a.com/",
        source_url: "https://b.com/",
      }).url,
    ).toBe("https://a.com/");
    expect(copySourceFromItem({ kind: "web", title: "T", source_url: "https://b.com/" }).url).toBe(
      "https://b.com/",
    );
    expect(copySourceFromItem({ kind: "note", title: "T", canonical_url: "" }).url).toBeNull();
  });
});

describe("formatHighlightTime", () => {
  it("uses M:SS under an hour", () => {
    expect(formatHighlightTime(0)).toBe("0:00");
    expect(formatHighlightTime(7)).toBe("0:07");
    expect(formatHighlightTime(47)).toBe("0:47");
    expect(formatHighlightTime(600)).toBe("10:00");
    expect(formatHighlightTime(3599)).toBe("59:59");
  });

  it("uses H:MM:SS from an hour", () => {
    expect(formatHighlightTime(3600)).toBe("1:00:00");
    expect(formatHighlightTime(3725)).toBe("1:02:05");
    expect(formatHighlightTime(36000 + 61)).toBe("10:01:01");
  });

  it("floors fractions and clamps bad values to zero", () => {
    expect(formatHighlightTime(47.9)).toBe("0:47");
    expect(formatHighlightTime(-5)).toBe("0:00");
    expect(formatHighlightTime(Number.NaN)).toBe("0:00");
  });
});

describe("youtubeTimestampUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abcDEF12345&t=3s"],
    ["https://youtube.com/watch?v=abcDEF12345"],
    ["https://m.youtube.com/watch?v=abcDEF12345"],
    ["https://music.youtube.com/watch?v=abcDEF12345"],
    ["https://youtu.be/abcDEF12345?si=xyz"],
    ["https://www.youtube.com/shorts/abcDEF12345"],
    ["https://www.youtube.com/live/abcDEF12345?feature=share"],
    ["https://www.youtube.com/embed/abcDEF12345"],
  ])("finds the video id in %s", (url) => {
    expect(youtubeTimestampUrl(url, 47)).toBe("https://youtu.be/abcDEF12345?t=47");
  });

  it("floors seconds", () => {
    expect(youtubeTimestampUrl(YT, 47.8)).toBe("https://youtu.be/abcDEF12345?t=47");
  });

  it("returns null without a video id", () => {
    expect(youtubeTimestampUrl(null, 1)).toBeNull();
    expect(youtubeTimestampUrl(undefined, 1)).toBeNull();
    expect(youtubeTimestampUrl("", 1)).toBeNull();
    expect(youtubeTimestampUrl("not a url", 1)).toBeNull();
    expect(youtubeTimestampUrl("https://example.com/watch?v=abcDEF12345", 1)).toBeNull();
    expect(youtubeTimestampUrl("https://www.youtube.com/", 1)).toBeNull();
    expect(youtubeTimestampUrl("https://www.youtube.com/channel/UC1", 1)).toBeNull();
  });
});

describe("formatQuoteWithSource", () => {
  const source = { title: "Turbos", byline: ["Engineering Explained", "YouTube"], url: YT };

  it("writes the quote, a blank line and the attribution", () => {
    expect(
      formatQuoteWithSource(hl({ quote: "Spin\n  up." }), { ...source, url: "https://a.com/x" }),
    ).toBe("> Spin up.\n\n— Turbos, Engineering Explained, YouTube. https://a.com/x");
  });

  it("adds the time and the timestamp URL with seconds", () => {
    expect(formatQuoteWithSource(hl({ seconds: 3725 }), source)).toBe(
      "> A quote.\n\n— Turbos, Engineering Explained, YouTube, at 1:02:05. https://youtu.be/abcDEF12345?t=3725",
    );
  });

  it("falls back to the plain URL when it is not a YouTube URL", () => {
    expect(formatQuoteWithSource(hl({ seconds: 5 }), { ...source, url: "https://a.com/x" })).toBe(
      "> A quote.\n\n— Turbos, Engineering Explained, YouTube, at 0:05. https://a.com/x",
    );
  });

  it("ends after the period without a URL", () => {
    expect(formatQuoteWithSource(hl(), { title: "My note", byline: ["Note"], url: null })).toBe(
      "> A quote.\n\n— My note, Note.",
    );
    expect(formatQuoteWithSource(hl({ seconds: 5 }), { title: "T", byline: [], url: null })).toBe(
      "> A quote.\n\n— T, at 0:05.",
    );
  });

  it("writes an image highlight as an image", () => {
    expect(
      formatQuoteWithSource(
        hl({ kind: "image", quote: "Cutaway", image_src: "https://e.com/t.png" }),
        { title: "T", byline: ["Wikipedia"], url: "https://w.org/T" },
      ),
    ).toBe("![Cutaway](https://e.com/t.png)\n\n— T, Wikipedia. https://w.org/T");
  });
});

describe("formatQuotesWithSources", () => {
  const a = { title: "Alpha", byline: ["Wikipedia"], url: "https://w.org/A" };
  const b = { title: "Beta", byline: ["Ann", "Substack"], url: null };
  const yt = { title: "Turbos", byline: ["Chan", "YouTube"], url: YT };

  it("is empty without entries", () => {
    expect(formatQuotesWithSources([])).toBe("");
  });

  it("numbers sources by first appearance; repeated items keep their number", () => {
    const out = formatQuotesWithSources([
      { highlight: hl({ quote: "one" }), source: a, itemId: "A" },
      { highlight: hl({ quote: "two" }), source: b, itemId: "B" },
      { highlight: hl({ quote: "three" }), source: a, itemId: "A" },
    ]);
    expect(out).toBe(
      [
        "> one [1]",
        "",
        "> two [2]",
        "",
        "> three [1]",
        "",
        "Sources",
        "1. Alpha, Wikipedia. https://w.org/A",
        "2. Beta, Ann, Substack.",
      ].join("\n"),
    );
  });

  it("adds the time to the number, and uses the plain URL in Sources", () => {
    const out = formatQuotesWithSources([
      { highlight: hl({ quote: "x\ny", seconds: 47 }), source: yt, itemId: "Y" },
      {
        highlight: hl({ kind: "image", quote: "Alt", image_src: "https://e.com/i.png" }),
        source: a,
        itemId: "A",
      },
    ]);
    expect(out).toBe(
      [
        "> x y [1, 0:47]",
        "",
        "![Alt](https://e.com/i.png) [2]",
        "",
        "Sources",
        `1. Turbos, Chan, YouTube. ${YT}`,
        "2. Alpha, Wikipedia. https://w.org/A",
      ].join("\n"),
    );
  });

  it("works with a single entry", () => {
    expect(formatQuotesWithSources([{ highlight: hl(), source: a, itemId: "A" }])).toBe(
      "> A quote. [1]\n\nSources\n1. Alpha, Wikipedia. https://w.org/A",
    );
  });
});

describe("buildHighlightsSection", () => {
  it("returns an empty string without highlights", () => {
    expect(buildHighlightsSection([], YT)).toBe("");
    expect(buildHighlightsSection(null, YT)).toBe("");
    expect(buildHighlightsSection(undefined, YT)).toBe("");
  });

  it("writes a plain text quote with collapsed whitespace", () => {
    expect(buildHighlightsSection([fh({ quote: "  One\n\ntwo \t three  " })], null)).toBe(
      "## My highlights\n\n> One two three",
    );
  });

  it("writes an image block, and gives a details line only when there are details", () => {
    expect(
      buildHighlightsSection(
        [fh({ kind: "image", quote: "Cut\naway", image_src: "https://e.com/t.png" })],
        null,
      ),
    ).toBe("## My highlights\n\n![Cut away](https://e.com/t.png)");
  });

  it("treats an image without a source as text", () => {
    expect(
      buildHighlightsSection([fh({ kind: "image", quote: "Alt", image_src: null })], null),
    ).toBe("## My highlights\n\n> Alt");
  });

  it("orders by start_offset, then created_at, then id", () => {
    const out = buildHighlightsSection(
      [
        fh({ id: "d", quote: "D", start_offset: 5, created_at: "2026-01-02" }),
        fh({ id: "c", quote: "C", start_offset: 5, created_at: "2026-01-01" }),
        fh({ id: "b", quote: "B", start_offset: 5, created_at: "2026-01-01" }),
        fh({ id: "a", quote: "A", start_offset: 9, created_at: "2025-01-01" }),
        fh({ id: "z", quote: "Z", start_offset: 1, created_at: "2027-01-01" }),
      ],
      null,
    );
    expect(out).toBe("## My highlights\n\n> Z\n\n> B\n\n> C\n\n> D\n\n> A");
  });

  it("does not change the input order", () => {
    const list = [fh({ id: "b", start_offset: 2 }), fh({ id: "a", start_offset: 1 })];
    buildHighlightsSection(list, null);
    expect(list.map((h) => h.id)).toEqual(["b", "a"]);
  });

  it("links the timestamp for a YouTube item; plain time otherwise", () => {
    expect(buildHighlightsSection([fh({ seconds: 47 })], YT)).toBe(
      "## My highlights\n\n> A quote.\n\n[0:47](https://youtu.be/abcDEF12345?t=47)",
    );
    expect(buildHighlightsSection([fh({ seconds: 3725 })], "https://youtu.be/abcDEF12345")).toBe(
      "## My highlights\n\n> A quote.\n\n[1:02:05](https://youtu.be/abcDEF12345?t=3725)",
    );
    expect(buildHighlightsSection([fh({ seconds: 47 })], "https://example.com/")).toBe(
      "## My highlights\n\n> A quote.\n\n0:47",
    );
    expect(buildHighlightsSection([fh({ seconds: 0 })], null)).toBe(
      "## My highlights\n\n> A quote.\n\n0:00",
    );
  });

  it("writes citations with the host without www.", () => {
    const out = buildHighlightsSection(
      [
        fh({
          cited: [
            { n: "1", title: "Paper", url: "https://www.sae.org/paper" },
            { n: "2", title: null, url: "https://en.wikipedia.org/wiki/Turbo" },
          ],
        }),
      ],
      null,
    );
    expect(out).toBe(
      "## My highlights\n\n> A quote.\n\nCited: [sae.org](https://www.sae.org/paper), [en.wikipedia.org](https://en.wikipedia.org/wiki/Turbo)",
    );
  });

  it("wraps URLs with a space or a parenthesis in <>", () => {
    const out = buildHighlightsSection(
      [
        fh({
          cited: [
            { n: "1", title: null, url: "https://a.com/x (1).pdf" },
            { n: "2", title: null, url: "https://b.com/w/Foo_(bar)" },
          ],
        }),
      ],
      null,
    );
    expect(out).toContain(
      "[a.com](<https://a.com/x (1).pdf>), [b.com](<https://b.com/w/Foo_(bar)>)",
    );
  });

  it("writes a note with collapsed whitespace and drops an empty one", () => {
    expect(buildHighlightsSection([fh({ note: " Check\n the   date " })], null)).toBe(
      "## My highlights\n\n> A quote.\n\nNote: Check the date",
    );
    expect(buildHighlightsSection([fh({ note: "  \n " })], null)).toBe(
      "## My highlights\n\n> A quote.",
    );
  });

  it("joins timestamp, citations and note with a middle dot, in that order", () => {
    const out = buildHighlightsSection(
      [
        fh({
          seconds: 47,
          note: "N",
          cited: [{ n: "1", title: null, url: "https://sae.org/p" }],
        }),
      ],
      YT,
    );
    expect(out).toBe(
      "## My highlights\n\n> A quote.\n\n[0:47](https://youtu.be/abcDEF12345?t=47) · Cited: [sae.org](https://sae.org/p) · Note: N",
    );
  });

  it("separates blocks with one blank line", () => {
    const out = buildHighlightsSection(
      [fh({ id: "a", start_offset: 1, note: "n" }), fh({ id: "b", start_offset: 2, quote: "Two" })],
      null,
    );
    expect(out).toBe("## My highlights\n\n> A quote.\n\nNote: n\n\n> Two");
  });
});
