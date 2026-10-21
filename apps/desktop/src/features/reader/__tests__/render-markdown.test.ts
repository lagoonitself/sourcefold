import { describe, expect, it } from "vitest";
import { footnoteId, renderMarkdown, safeImageUrl, safeLinkUrl } from "../render-markdown";

describe("sanitizing", () => {
  it("removes script blocks and event handler attributes", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\nHello <img src=x onerror="alert(2)"> world\n\n<div onclick="x()">text</div>',
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror|onclick/i);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<div");
    expect(html).toContain("Hello");
    expect(html).toContain("world");
    expect(html).not.toContain("alert(1)");
  });

  it("escapes what is left of a tag that never closes", () => {
    const html = renderMarkdown("before <script src=x");
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script");
  });

  it("drops javascript: links but keeps their text", () => {
    const html = renderMarkdown("[click](javascript:alert(1)) and [tab](java\tscript:alert(2))");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain("<a");
    expect(html).toContain("click");
  });

  it("drops images with a script, data or relative address", () => {
    const html = renderMarkdown(
      "![a](javascript:x) ![b](data:text/html;base64,AAAA) ![c](pic.png)",
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("a");
  });

  it("keeps http, https and mailto links and escapes attributes", () => {
    const html = renderMarkdown(
      '[x](https://example.com/a?b=1&c=2 "a \\"quoted\\" title") [m](mailto:a@b.co)',
    );
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
    expect(html).toContain('href="mailto:a@b.co"');
    expect(html).not.toContain('title="a "quoted""');
  });

  it("recognizes safe and unsafe addresses", () => {
    expect(safeLinkUrl("https://a.co")).toBe("https://a.co");
    expect(safeLinkUrl("#fn-1")).toBe("#fn-1");
    expect(safeLinkUrl("  JavaScript:alert(1)")).toBeNull();
    expect(safeLinkUrl("vbscript:x")).toBeNull();
    expect(safeLinkUrl("/relative")).toBeNull();
    expect(safeLinkUrl("")).toBeNull();
    expect(safeImageUrl("https://a.co/i.png")).toBe("https://a.co/i.png");
    expect(safeImageUrl("#x")).toBeNull();
    expect(safeImageUrl("file:///c:/x.png")).toBeNull();
  });
});

describe("images", () => {
  it("renders a remote image inline with its alt text, and the caption as its own paragraph", () => {
    const html = renderMarkdown(
      "![A chart](https://substack-post-media.s3.amazonaws.com/p/a.png)\n\n*The caption*",
    );
    expect(html).toContain(
      '<img src="https://substack-post-media.s3.amazonaws.com/p/a.png" alt="A chart"',
    );
    expect(html).toContain("<p><em>The caption</em></p>");
  });

  it("renders an mp4 image as an autoplay looping muted playsinline video tag with no img tag", () => {
    const html = renderMarkdown("![GIF](https://video.twimg.com/tweet_video/AB1.mp4)");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.mp4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });

  it("renders uppercase .MP4 as a video tag too", () => {
    const html = renderMarkdown("![GIF](https://video.twimg.com/tweet_video/AB1.MP4)");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.MP4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });

  it("drops javascript: or data: URLs ending in .mp4 without rendering video or img", () => {
    const jsHtml = renderMarkdown("![GIF](javascript:alert(1).mp4)");
    expect(jsHtml).not.toContain("<video");
    expect(jsHtml).not.toContain("<img");

    const dataHtml = renderMarkdown("![GIF](data:video/mp4;base64,AAAA.mp4)");
    expect(dataHtml).not.toContain("<video");
    expect(dataHtml).not.toContain("<img");
  });

  it("still renders a normal .png image with an img tag", () => {
    const html = renderMarkdown("![chart](https://example.com/pic.png)");
    expect(html).toContain('<img src="https://example.com/pic.png" alt="chart"');
    expect(html).not.toContain("<video");
  });

  it("renders a GIF inside a blockquote as a video", () => {
    const html = renderMarkdown("> ![GIF](https://video.twimg.com/tweet_video/AB1.mp4)");
    expect(html).toContain("<blockquote>");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.mp4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });
});

describe("footnotes", () => {
  const source = [
    "AGI is hypothetical.[^76][^77] It is debated.[^76]",
    "",
    "## References",
    "",
    "[^76]: [First](https://example.com/a) - example.com",
    "[^77]: <https://example.com/b> - example.com",
  ].join("\n");

  it("links each marker to its definition and shows the original number", () => {
    const html = renderMarkdown(source);
    expect(html).toContain('<sup class="fn-ref"><a id="fnref-76" href="#fn-76">[76]</a></sup>');
    expect(html).toContain('<a id="fnref-77" href="#fn-77">[77]</a>');
    // A second use of the same note gets its own id.
    expect(html).toContain('id="fnref-76-2"');
  });

  it("lists the definitions at the bottom with links back to the text", () => {
    const html = renderMarkdown(source);
    expect(html).toContain('<li id="fn-76">');
    expect(html).toContain('<a href="https://example.com/a">First</a>');
    expect(html).toContain('href="#fnref-76"');
    expect(html).toContain('href="#fnref-77"');
    expect(html.indexOf("## References")).toBe(-1);
    expect(html.indexOf("References")).toBeLessThan(html.indexOf('<ul class="footnotes">'));
    // The definition lines are not printed as paragraphs.
    expect(html).not.toContain("[^76]:");
  });

  it("leaves a marker without a definition as plain text", () => {
    const html = renderMarkdown("Text[^9] here.");
    expect(html).toContain("Text[^9] here.");
    expect(html).not.toContain("fn-ref");
  });

  it("joins an indented continuation to its definition", () => {
    const html = renderMarkdown("A[^a]\n\n[^a]: first line\n    second line");
    expect(html).toContain("first line");
    expect(html).toContain("second line");
  });

  it("builds ids that are safe in an attribute", () => {
    expect(footnoteId("76")).toBe("76");
    expect(footnoteId('a "b"')).toBe("a_20_22b_22");
  });
});

describe("X threads", () => {
  it("renders replies as nested blockquotes", () => {
    const html = renderMarkdown(
      [
        "**Alice** (@alice) · 2026-10-14 · [link](https://x.com/alice/status/1)",
        "",
        "First post.",
        "",
        "> **Bob** (@bob) · 2026-10-14 · [link](https://x.com/bob/status/2)",
        ">",
        "> Reply.",
        ">",
        "> > **Carol** (@carol) · [link](https://x.com/carol/status/3)",
        "> >",
        "> > Nested reply.",
      ].join("\n"),
    );
    expect(html.match(/<blockquote>/g)).toHaveLength(2);
    expect(html).toContain("Nested reply.");
    expect(html).toContain('href="https://x.com/bob/status/2"');
  });
});
