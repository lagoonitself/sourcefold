import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { normalizeWebPageDate, webPageTextLength, webPageToCapture } from "./convert";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;

describe("webPageToCapture", () => {
  it("extracts a news article's metadata and body", () => {
    const url = "https://example.com/2026/03/inside-the-workshop";
    const capture = webPageToCapture(fixture("news-article.html"), url, parseHtml);

    expect(capture.url).toBe(url);
    expect(capture.title).toBe("Inside the Workshop");
    expect(capture.meta).toEqual({
      site: "The Daily Circuit",
      author: "Jane Doe",
      published: "2026-03-04",
      summary: "A visit to the small workshop where the machines are still built by hand.",
    });

    expect(capture.markdown.startsWith("The workshop sits")).toBe(true);
    expect(capture.markdown.endsWith("\n")).toBe(true);
    expect(capture.markdown).toContain("## Why it lasts");
    expect(capture.markdown).toContain(
      "![A workbench covered in tools](https://example.com/images/bench.jpg)\n\n" +
        "*The main bench, where every machine is checked before it ships.*",
    );
    expect(capture.markdown).toContain(
      "[archive of workshop visits](https://example.com/archive/workshops)",
    );
    // No raw HTML, scripts or widgets leak into the body.
    expect(capture.markdown).not.toContain("<");
    expect(capture.markdown).not.toContain("src=");
    expect(capture.markdown).not.toContain("The Daily Circuit. All rights");
  });

  it("makes relative link and image URLs absolute and drops unsafe ones", () => {
    const url = "https://harbour.example/guides/tides/";
    const capture = webPageToCapture(fixture("relative-links.html"), url, parseHtml);

    expect(capture.title).toBe("A Field Guide to Tides");
    expect(capture.meta.site).toBe("Harbour Notes");
    expect(capture.meta.author).toBeNull();
    expect(capture.meta.published).toBeNull();

    expect(capture.markdown).toContain(
      "[spring tide charts](https://harbour.example/guides/charts/spring-tides)",
    );
    expect(capture.markdown).toContain(
      "![A line of seaweed marking the high water mark]" +
        "(https://harbour.example/guides/tides/images/tide-line.jpg)",
    );
    expect(capture.markdown).toContain("interactive tide wheel");
    expect(capture.markdown).not.toContain("javascript:");
    expect(capture.markdown).not.toContain("data:image");
  });

  it("does not repeat the title as a heading", () => {
    const url = "https://example.com/report";
    const html =
      "<html><head><title>Quarterly Report</title></head><body><article>" +
      "<h1>Quarterly Report</h1>" +
      "<p>The numbers this quarter moved in a direction that surprised almost everyone on the " +
      "team, and the reasons are worth a longer look before the next one begins.</p>" +
      "<h2>Revenue</h2><p>Revenue grew by a comfortable margin across every region we track.</p>" +
      "</article></body></html>";

    const capture = webPageToCapture(html, url, parseHtml);
    expect(capture.title).toBe("Quarterly Report");
    expect(capture.markdown.startsWith("The numbers")).toBe(true);
    expect(capture.markdown).toContain("## Revenue");
    expect(capture.markdown).not.toContain("# Quarterly Report");
  });

  it("keeps a heading that differs from the title, starting at level two", () => {
    const url = "https://example.com/notes";
    const html =
      "<html><head><title>Notes</title></head><body><article>" +
      "<h1>A different heading</h1>" +
      "<p>Some ordinary prose that gives the extractor enough to work with here and there.</p>" +
      "</article></body></html>";

    const capture = webPageToCapture(html, url, parseHtml);
    const firstLine = capture.markdown.split("\n").find((line) => line.trim() !== "");
    expect(firstLine).toBe("## A different heading");
  });

  it("returns the page's little text when there is no article", () => {
    const capture = webPageToCapture(
      fixture("empty-page.html"),
      "https://example.com/login",
      parseHtml,
    );
    expect(capture.title).toBe("Sign in");
    expect(capture.markdown.trim()).toBe("Please sign in to continue.");
    expect(webPageTextLength(capture.markdown)).toBeLessThan(100);
  });

  it("falls back to the host when the page has no title", () => {
    const html =
      "<html><head></head><body><article><p>A short page with no title element at all, just " +
      "enough words for the extractor to keep the paragraph it found in the body.</p>" +
      "</article></body></html>";
    const capture = webPageToCapture(html, "https://news.example.com/story", parseHtml);
    expect(capture.title).toBe("news.example.com");
  });
});

describe("normalizeWebPageDate", () => {
  it("keeps a date, trims a timestamp, and rejects anything else", () => {
    expect(normalizeWebPageDate("2026-03-04T10:30:00Z")).toBe("2026-03-04");
    expect(normalizeWebPageDate("2026-03-04")).toBe("2026-03-04");
    expect(normalizeWebPageDate("March 4, 2026")).toBe("2026-03-04");
    expect(normalizeWebPageDate("not a date")).toBeNull();
    expect(normalizeWebPageDate("")).toBeNull();
    expect(normalizeWebPageDate(null)).toBeNull();
  });
});

describe("webPageTextLength", () => {
  it("measures readable text, ignoring markup", () => {
    expect(webPageTextLength("![alt](https://example.com/a.png)")).toBe(0);
    expect(webPageTextLength("[a link](https://example.com)")).toBe(6);
    expect(webPageTextLength("## Heading\n\nBody text.")).toBe("Heading Body text.".length);
  });
});
