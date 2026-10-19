import { describe, expect, it } from "vitest";
import { findQuote, readerTextOf, stripMarkdown } from "../reader-text";
import { registerHighlightsTools } from "../tools/highlights";
import type { Highlight } from "../types";
import { connect, fakeWeb } from "./harness";

const FILE = `---
url: "https://grokipedia.com/page/Turbocharger"
kind: grokipedia
---

# Turbocharger

> Saved from [Grokipedia](https://grokipedia.com/page/Turbocharger) on 2026-10-18

A **turbocharger** uses exhaust gas to spin a turbine.[^1] The delay before boost builds is called *turbo lag*.

## History

Early designs appeared in the 1900s.[^2]

[^1]: [How turbos work](https://example.com/turbo) - example.com
[^2]: <https://example.com/history> - example.com
`;

const TRANSCRIPT = `---
url: "https://www.youtube.com/watch?v=aircAruvnKk"
kind: youtube
---

# A video

> Saved from [YouTube](https://www.youtube.com/watch?v=aircAruvnKk) on 2026-10-18

## Transcript

[0:00](https://www.youtube.com/watch?v=aircAruvnKk&t=0s) Hello and welcome.

[1:05](https://www.youtube.com/watch?v=aircAruvnKk&t=65s) Now the turbine spins faster.

## Description

A description.
`;

describe("readerTextOf", () => {
  it("is the rendered body text without front matter, title or source line", () => {
    const { text } = readerTextOf(FILE);
    expect(text).not.toContain("Saved from");
    expect(text).not.toContain("**");
    expect(text).toContain("A turbocharger uses exhaust gas to spin a turbine.[1]");
    expect(text).toContain("History");
  });

  it("finds timestamps and footnotes at their offsets", () => {
    const reader = readerTextOf(TRANSCRIPT);
    expect(reader.timestamps.marks.map((m) => m.seconds)).toEqual([0, 65]);
    const second = reader.timestamps.marks[1]!;
    expect(reader.text.slice(second.offset, second.offset + 4)).toBe("1:05");
    expect(reader.text.slice(reader.timestamps.end)).toMatch(/^Description/);

    const notes = readerTextOf(FILE).footnotes;
    expect(notes.refs.map((r) => r.label)).toEqual(["1", "2"]);
    expect(notes.defs.get("1")).toMatchObject({
      title: "How turbos work",
      url: "https://example.com/turbo",
    });
  });
});

describe("findQuote", () => {
  const { text } = readerTextOf(FILE);
  it("matches a quote copied from Markdown", () => {
    const quote = "A **turbocharger** uses exhaust gas to spin a turbine.[^1]";
    expect(stripMarkdown(quote)).toBe("A turbocharger uses exhaust gas to spin a turbine.[1]");
    const m = findQuote(text, quote)!;
    expect(text.slice(m.start, m.end)).toBe(
      "A turbocharger uses exhaust gas to spin a turbine.[1]",
    );
  });

  it("ignores spacing, case and curly quotes, and spans first … last words", () => {
    const m = findQuote(text, "the  DELAY before\nboost")!;
    expect(text.slice(m.start, m.end)).toBe("The delay before boost");
    const span = findQuote(text, "uses exhaust gas … called turbo lag")!;
    expect(text.slice(span.start, span.end)).toMatch(/^uses exhaust gas[\s\S]*called turbo lag$/);
    expect(findQuote(text, "not in the article")).toBeNull();
  });

  it("matches a quote that leaves out a footnote marker it crosses", () => {
    const reader = readerTextOf(FILE);
    const quote = "spin a turbine. The delay before boost";
    expect(findQuote(reader.text, quote)).toBeNull();
    const m = findQuote(reader.text, quote, reader.footnoteMarkers)!;
    expect(reader.text.slice(m.start, m.end)).toBe("spin a turbine.[1] The delay before boost");
    const span = findQuote(
      reader.text,
      "spin a turbine. The delay … in the 1900s.",
      reader.footnoteMarkers,
    )!;
    expect(reader.text.slice(span.start, span.end)).toMatch(
      /^spin a turbine\.\[1\][\s\S]*1900s\.$/,
    );
  });
});

describe("highlight tools", () => {
  function web(existing: Highlight[] = []) {
    return fakeWeb({
      "GET /items/*": ({ path }) => ({
        json: {
          data: {
            id: path.split("/")[2],
            folder_id: "g1",
            kind: "grokipedia",
            title: "Turbocharger",
          },
        },
      }),
      "GET /items/*/content": () => ({ text: FILE }),
      "GET /highlights": () => ({ json: { data: existing } }),
      "PUT /highlights/*": ({ body }) => ({ json: { data: body } }),
      "PATCH /highlights/*": ({ path, body }) => ({
        json: {
          data: {
            ...(existing[0] as Highlight),
            id: path.split("/")[2],
            note: (body as { note: string | null }).note,
          },
        },
      }),
    });
  }

  it("adds a highlight with the reader's offsets and the cited reference", async () => {
    const w = web();
    const h = await connect(registerHighlightsTools, { web: w });
    const result = await h.call("add_highlight", {
      source_id: "s1",
      quote: "uses exhaust gas to spin a turbine.[^1]",
      note: "key idea",
    });
    expect(result.isError).toBe(false);
    const put = w.bodies[w.calls.findIndex((c) => c.startsWith("PUT /highlights/"))] as Highlight;
    const { text } = readerTextOf(FILE);
    expect(text.slice(put.start_offset, put.end_offset)).toBe(put.quote);
    expect(put.quote).toBe("uses exhaust gas to spin a turbine.[1]");
    expect(put.prefix.endsWith("A turbocharger ")).toBe(true);
    expect(put.cited).toEqual([
      { n: "1", title: "How turbos work", url: "https://example.com/turbo" },
    ]);
    expect(put.note).toBe("key idea");
    expect(result.text).toContain("key idea");
  });

  it("names an overlapping highlight instead of making a new one", async () => {
    const { text } = readerTextOf(FILE);
    const start = text.indexOf("exhaust gas");
    const old: Highlight = {
      id: "h-old",
      item_id: "s1",
      kind: "text",
      quote: "exhaust gas",
      prefix: "",
      suffix: "",
      start_offset: start,
      end_offset: start + "exhaust gas".length,
      image_src: null,
      note: null,
      seconds: null,
      cited: [],
      created_at: "",
      updated_at: "",
    };
    const w = web([old]);
    const h = await connect(registerHighlightsTools, { web: w });
    const result = await h.call("add_highlight", {
      source_id: "s1",
      quote: "uses exhaust gas to spin",
    });
    expect(result.text).toContain("overlaps an existing highlight");
    expect(result.text).toContain("[h-old]");
    expect(w.calls.some((c) => c.startsWith("PUT"))).toBe(false);
  });

  it("explains when the quote isn't there", async () => {
    const h = await connect(registerHighlightsTools, { web: web() });
    const result = await h.call("add_highlight", {
      source_id: "s1",
      quote: "superchargers are belt driven",
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/isn't in "Turbocharger"/);
  });

  it("lists a source's highlights", async () => {
    const h = await connect(registerHighlightsTools, {
      web: web([
        {
          id: "h1",
          item_id: "s1",
          kind: "text",
          quote: "turbo lag",
          prefix: "",
          suffix: "",
          start_offset: 10,
          end_offset: 19,
          image_src: null,
          note: "remember this",
          seconds: null,
          cited: [],
          created_at: "",
          updated_at: "",
        },
      ]),
    });
    const result = await h.call("list_highlights", { source_id: "s1" });
    expect(result.text).toContain('[h1] "turbo lag"');
    expect(result.text).toContain("note: remember this");
    const bad = await h.call("list_highlights", {});
    expect(bad.isError).toBe(true);
  });
});
