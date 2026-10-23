import { describe, expect, it } from "vitest";
import { buildGoogleDocHtml } from "./google-doc";

const IMG = "https://substack-post-media.s3.amazonaws.com/public/images/9a0a_1630x1630.jpeg";

const substack = [
  "---",
  "source: substack",
  "title: The Architecture of Tomorrow",
  "folder: Newsletters/Tech",
  "---",
  "",
  "# The Architecture of Tomorrow",
  "",
  "*How modular software is changing productivity*",
  "",
  "> Saved from [Future Architecture](https://future.substack.com/p/a) on 2026-10-15. By Jane Doe.",
  "",
  "## Introduction",
  "",
  "Before the picture.",
  "",
  `![A diagram](${IMG})`,
  "",
  "*The caption under it.*",
  "",
  "After the picture, with a [link](https://example.com/x?a=1&b=2).",
  "",
  "## My note",
  "",
  "Check this later.",
  "",
].join("\n");

const at = (html: string, needle: string) => {
  const index = html.indexOf(needle);
  expect(index, `missing: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe("buildGoogleDocHtml", () => {
  const html = buildGoogleDocHtml(substack);

  it("drops the front matter and puts title, subtitle and source line first", () => {
    expect(html).not.toContain("source: substack");
    expect(html).not.toContain("folder:");
    const title = at(html, "<h1");
    const subtitle = at(html, "How modular software");
    const source = at(html, "Saved from");
    const intro = at(html, "<h2");
    expect(title).toBeLessThan(subtitle);
    expect(subtitle).toBeLessThan(source);
    expect(source).toBeLessThan(intro);
    expect(html).toContain("<em>How modular software is changing productivity</em>");
    expect(html).toContain('<a href="https://future.substack.com/p/a">Future Architecture</a>');
    // The source line is a small muted paragraph, not a quote.
    expect(html).toMatch(/<p style="[^"]*font-size:9pt[^"]*">Saved from/);
  });

  it("keeps text, image, caption, text in order, with the image scaled to the page", () => {
    const before = at(html, "Before the picture.");
    const image = at(html, "<img ");
    const caption = at(html, "The caption under it.");
    const after = at(html, "After the picture");
    expect(before).toBeLessThan(image);
    expect(image).toBeLessThan(caption);
    expect(caption).toBeLessThan(after);
    expect(html).toContain(`src="${IMG}"`);
    expect(html).toContain('alt="A diagram"');
    // 1630x1630 shown at the 624 px page width.
    expect(html).toContain('width="624" height="624"');
    expect(html).toContain("max-width:624px");
    // The caption is centered under the image, in its own small paragraph.
    expect(html).toMatch(
      /<p style="[^"]*text-align:center[^"]*font-size:9pt[^"]*"><em>The caption/,
    );
  });

  it("does not scale up images smaller than the page", () => {
    const small = buildGoogleDocHtml("![](https://cdn.example/a_300x200.png)\n");
    expect(small).toContain('width="300" height="200"');
    const unknown = buildGoogleDocHtml("![](https://cdn.example/photo.png)\n");
    expect(unknown).not.toContain("width=");
    expect(unknown).toContain("max-width:624px");
  });

  it("puts the note under its own heading and escapes ampersands in links", () => {
    expect(at(html, "My note")).toBeGreaterThan(at(html, "After the picture"));
    expect(html).toContain('href="https://example.com/x?a=1&amp;b=2"');
  });

  it("renders GFM tables, lists and code", () => {
    const out = buildGoogleDocHtml(
      "# T\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- one\n- two\n\n1. first\n\n```\nx < y\n```\n",
    );
    expect(out).toContain('<table border="1"');
    expect(out).toContain("<th>A</th>");
    expect(out).toContain("<ul>");
    expect(out).toContain("<ol>");
    expect(out).toContain("x &lt; y");
  });

  it("numbers footnotes in first-seen order and lists them as Notes", () => {
    const out = buildGoogleDocHtml(
      [
        "# T",
        "",
        "Claim.[^76][^77] Again.[^76]",
        "",
        "More.[^12] Unknown.[^99]",
        "",
        "## References",
        "",
        "[^12]: [Third](https://c.example/3) - c.example",
        "[^76]: [First](https://a.example/1) - a.example",
        "[^77]: [Second](https://b.example/2) - b.example",
        "",
      ].join("\n"),
    );
    expect(out).toContain("Claim.<sup>1</sup><sup>2</sup> Again.<sup>1</sup>");
    expect(out).toContain("More.<sup>3</sup> Unknown.[^99]");
    expect(out).not.toContain("References");
    const first = at(out, "First");
    const second = at(out, "Second");
    const third = at(out, "Third");
    expect(at(out, ">Notes<")).toBeLessThan(first);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(out).toContain('<li><a href="https://a.example/1">First</a> - a.example</li>');
  });

  it("keeps X thread replies as nested blockquotes", () => {
    const out = buildGoogleDocHtml(
      [
        "# Thread by Alice (@alice)",
        "",
        "**Alice** (@alice) · 2026-10-14 · [link](https://x.com/alice/status/1)",
        "",
        "First post.",
        "",
        "> **Bob** (@bob) · 2026-10-14 · [link](https://x.com/bob/status/2)",
        ">",
        "> Reply.",
        ">",
        "> > **Carol** (@carol) · 2026-10-14",
        "> >",
        "> > Reply to the reply.",
        "",
      ].join("\n"),
    );
    expect(out.match(/<blockquote /g)).toHaveLength(2);
    expect(at(out, "First post.")).toBeLessThan(at(out, "Bob"));
    expect(at(out, "Bob")).toBeLessThan(at(out, "Carol"));
    expect(at(out, "<blockquote")).toBeLessThan(at(out, "Carol"));
  });

  it("never lets scripts, handlers or unsafe links through", () => {
    const out = buildGoogleDocHtml(
      [
        "# <script>alert(1)</script>",
        "",
        '<script>alert(2)</script> <img src=x onerror="alert(3)">',
        "",
        '<div onclick="alert(4)">block</div>',
        "",
        "[bad](javascript:alert(5)) and [data](data:text/html,x) and [rel](../x.md)",
        "",
        "![pic](javascript:alert(6)) ![p2](data:image/png;base64,AAAA)",
        "",
        "`<b>` \"quoted\" & 'single'",
        "",
      ].join("\n"),
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img src=x/i);
    expect(out).not.toMatch(/<div/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/data:/i);
    expect(out).not.toContain('<a href="../x.md"');
    expect(out).not.toContain("<img ");
    expect(out).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(out).toContain("bad and data and rel");
    expect(out).toContain("&lt;b&gt;");
  });

  it("copes with a note: no source line, CRLF and no title", () => {
    const note = buildGoogleDocHtml(
      "---\r\nsource: note\r\n---\r\n\r\n# Idea\r\n\r\nJust text.\r\n",
    );
    expect(note).toContain("<h1");
    expect(note).toContain("Just text.");
    const bare = buildGoogleDocHtml("Only a paragraph.\n");
    expect(bare).not.toContain("<h1");
    expect(bare).toContain("Only a paragraph.");
  });

  it("renders an X animated GIF as a linked thumbnail image", () => {
    const out = buildGoogleDocHtml(
      "![A funny reaction](https://video.twimg.com/tweet_video/abc_123-XYZ.mp4)\n",
    );
    expect(out).toContain(
      '<a href="https://video.twimg.com/tweet_video/abc_123-XYZ.mp4"><img src="https://pbs.twimg.com/tweet_video_thumb/abc_123-XYZ.jpg" alt="A funny reaction" style="max-width:624px;"></a>',
    );
  });

  it("renders a generic https mp4 with text and with empty text as Video", () => {
    const withText = buildGoogleDocHtml("![Product Demo](https://example.com/videos/demo.mp4)\n");
    expect(withText).toContain('<a href="https://example.com/videos/demo.mp4">Product Demo</a>');
    expect(withText).not.toContain("<img ");

    const emptyText = buildGoogleDocHtml("![](https://example.com/clip.MP4)\n");
    expect(emptyText).toContain('<a href="https://example.com/clip.MP4">Video</a>');

    const whitespaceText = buildGoogleDocHtml("![   ](https://example.com/clip.mp4)\n");
    expect(whitespaceText).toContain('<a href="https://example.com/clip.mp4">Video</a>');
  });

  it("rejects unsafe URLs even when ending in .mp4", () => {
    const out = buildGoogleDocHtml(
      [
        "![bad js](javascript:alert('x').mp4)",
        "",
        "![bad data](data:video/mp4;base64,AAAA.mp4)",
      ].join("\n"),
    );
    expect(out).not.toContain("<a href=");
    expect(out).not.toContain("<img ");
    expect(out).toContain("bad js");
    expect(out).toContain("bad data");
  });

  it("renders an X animated GIF inside a blockquote reply", () => {
    const out = buildGoogleDocHtml("> ![GIF](https://video.twimg.com/tweet_video/AB1.mp4)\n");
    expect(out).toContain("<blockquote");
    expect(out).toContain(
      '<a href="https://video.twimg.com/tweet_video/AB1.mp4"><img src="https://pbs.twimg.com/tweet_video_thumb/AB1.jpg" alt="GIF" style="max-width:624px;"></a>',
    );
  });
});
