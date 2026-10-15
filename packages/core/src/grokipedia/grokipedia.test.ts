import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../html-to-markdown";
import { parseGrokipediaHtml, GrokipediaParseError, type GrokipediaArticle } from "./parse";
import { grokipediaToMarkdown } from "./markdown";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = new URL("../../test/fixtures/grokipedia-impact-of-ai.html", import.meta.url);
const fixtureHtml = readFileSync(fixtureUrl, "utf-8");
const articleUrl = "https://grokipedia.com/page/Impact_of_Artificial_Intelligence_on_the_Future";

const shortFixtureUrl = new URL(
  "../../test/fixtures/grokipedia-short-article.html",
  import.meta.url,
);
const shortFixtureHtml = readFileSync(shortFixtureUrl, "utf-8");
const shortArticleUrl = "https://grokipedia.com/page/Quantum_Teleportation";

const tablesFixtureUrl = new URL(
  "../../test/fixtures/grokipedia-tables-lists.html",
  import.meta.url,
);
const tablesFixtureHtml = readFileSync(tablesFixtureUrl, "utf-8");
const tablesArticleUrl = "https://grokipedia.com/page/Global_Space_Missions";

describe("htmlToMarkdown", () => {
  it("converts tables to GFM tables, preserves nested lists, and keeps links", () => {
    const html = `
      <div>
        <p>A paragraph with <a href="https://example.com">a link</a>.</p>
        <table>
          <thead>
            <tr><th>Header A</th><th>Header B</th></tr>
          </thead>
          <tbody>
            <tr><td>Cell 1</td><td>Cell 2</td></tr>
          </tbody>
        </table>
        <ul>
          <li>Item 1
            <ul>
              <li>Subitem 1</li>
            </ul>
          </li>
          <li>Item 2</li>
        </ul>
        <button>Click me</button>
        <svg><circle cx="5" cy="5" r="5"></circle></svg>
        <img src="https://example.com/pic.png" alt="Test Pic" />
        <script>console.log("bad");</script>
      </div>
    `;

    const md = htmlToMarkdown(html);

    // Table conversion
    expect(md).toContain("| Header A | Header B |");
    expect(md).toContain("| Cell 1 | Cell 2 |");

    // Nested list preservation
    expect(md).toMatch(/-\s+Item 1/);
    expect(md).toMatch(/\s+-\s+Subitem 1/);
    expect(md).toMatch(/-\s+Item 2/);

    // Links preserved
    expect(md).toContain("[a link](https://example.com)");

    // Stripped elements
    expect(md).not.toContain("Click me");
    expect(md).not.toContain("circle");
    expect(md).not.toContain("![Test Pic]");
    expect(md).not.toContain("console.log");
  });

  it("reuses converter singleton across multiple calls consistently", () => {
    const md1 = htmlToMarkdown("<p>First call</p>");
    const md2 = htmlToMarkdown("<p>Second call</p>");
    expect(md1).toBe("First call\n");
    expect(md2).toBe("Second call\n");
  });
});

describe("parseGrokipediaHtml and grokipediaToMarkdown", () => {
  it("throws GrokipediaParseError for missing article or h1", () => {
    expect(() => parseGrokipediaHtml("<div>No article</div>", "https://grokipedia.com")).toThrow(
      GrokipediaParseError,
    );
    expect(() => parseGrokipediaHtml("<article>No h1</article>", "https://grokipedia.com")).toThrow(
      GrokipediaParseError,
    );
    expect(() =>
      parseGrokipediaHtml("<article><h1>   </h1></article>", "https://grokipedia.com"),
    ).toThrow(GrokipediaParseError);
  });

  it("preserves gene-editing, protocols, and math superscripts", () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>Biotechnology and Protocols</h1>
            <div class=\"protocol-guide\">
              <h2 id=\"gene-editing\">Gene Editing Techniques</h2>
              <p>CRISPR enables targeted edits in DNA. Energy is given by E=mc<sup>2</sup>.</p>
              <h2 id=\"copyright-notice\">Copyright Information</h2>
              <p>All rights reserved.</p>
            </div>
            <section class=\"references\">
              <ol>
                <li id=\"ref-1\">
                  <span class=\"ref-num\">1</span>
                  <a class=\"ref-link\" href=\"https://example.com/crispr\">CRISPR Review</a>
                </li>
              </ol>
            </section>
          </article>
        </body>
      </html>
    `;
    const article = parseGrokipediaHtml(html, "https://grokipedia.com/page/Biotechnology");
    const md = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    expect(md).toContain("Gene Editing Techniques");
    expect(md).toContain("Copyright Information");
    expect(article.bodyHtml).toContain("<sup>2</sup>");
    expect(md).toContain("E=mc2");
    expect(md).toContain("All rights reserved.");
    expect(article.references.length).toBe(1);
    expect(article.references[0]?.title).toBe("CRISPR Review");
  });

  it("resolves references inside article before document-level references", () => {
    const html = `
      <html>
        <body>
          <div id="references">
            <ol><li id="ref-99"><a class="ref-link" href="https://wrong.com">Wrong</a></li></ol>
          </div>
          <article>
            <h1>Test Title</h1>
            <p>Body text</p>
            <div id="references">
              <ol><li id="ref-1"><a class="ref-link" href="https://correct.com">Correct</a></li></ol>
            </div>
          </article>
        </body>
      </html>
    `;
    const article = parseGrokipediaHtml(html, "https://grokipedia.com/page/Test");
    expect(article.references.length).toBe(1);
    expect(article.references[0]?.url).toBe("https://correct.com/");
  });

  it("removes standalone References headings to avoid duplicate '## References' in markdown", () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>Heading Test</h1>
            <p>Some text</p>
            <h2>References</h2>
            <div id="references">
              <ol><li id="ref-1"><a class="ref-link" href="https://example.com">Example</a></li></ol>
            </div>
          </article>
        </body>
      </html>
    `;
    const article = parseGrokipediaHtml(html, "https://grokipedia.com/page/Heading_Test");
    const md = grokipediaToMarkdown(article, { savedAt: "2026-10-14" });
    const matches = md.match(/## References/g);
    expect(matches?.length).toBe(1);
  });

  it("removes standalone h2#references-title and h3 with id containing references", () => {
    const html = `
      <html>
        <body>
          <article>
            <h1>Title</h1>
            <h2 id="references-title">References</h2>
            <h3 id="section-references">Further References</h3>
            <p>Body</p>
          </article>
        </body>
      </html>
    `;
    const article = parseGrokipediaHtml(html, "https://grokipedia.com/page/Test");
    expect(article.bodyHtml).not.toContain("references-title");
    expect(article.bodyHtml).not.toContain("section-references");
  });

  it("escapes brackets in reference titles, wraps URLs with parens/spaces in angle brackets, and handles empty domain", () => {
    const article: GrokipediaArticle = {
      url: "https://grokipedia.com/page/Test",
      title: "Test Article",
      summary: null,
      factCheckedAt: null,
      bodyHtml: "<p>Content [^1] [^2] [^3] [^4]</p>",
      references: [
        {
          number: 1,
          title: "Paper [2024] Title",
          url: "https://example.com/paper",
          domain: "example.com",
        },
        {
          number: 2,
          title: "Transformer Overview",
          url: "https://grokipedia.com/page/Transformer_(machine_learning)",
          domain: "grokipedia.com",
        },
        {
          number: 3,
          title: "URL With Space",
          url: "https://example.com/foo bar",
          domain: "",
        },
        {
          number: 4,
          title: "Standard Simple Reference",
          url: "https://example.com/simple",
          domain: "example.com",
        },
      ],
    };

    const md = grokipediaToMarkdown(article, { savedAt: "2026-10-14" });
    expect(md).toContain("[^1]: [Paper \\[2024\\] Title](https://example.com/paper) - example.com");
    expect(md).toContain(
      "[^2]: [Transformer Overview](<https://grokipedia.com/page/Transformer_(machine_learning)>) - grokipedia.com",
    );
    expect(md).toContain("[^3]: [URL With Space](<https://example.com/foo bar>)");
    expect(md).not.toContain("[^3]: [URL With Space](<https://example.com/foo bar>) - ");
    expect(md).toContain(
      "[^4]: [Standard Simple Reference](https://example.com/simple) - example.com",
    );
  });

  it("extracts and formats full fixture correctly", () => {
    const article = parseGrokipediaHtml(fixtureHtml, articleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    // markdown contains "## Overview"
    expect(markdown).toContain("## Overview");

    // contains "[^1]"
    expect(markdown).toContain("[^1]");

    // contains "[^139]: <" (url in angle brackets since title is empty / url-only)
    expect(markdown).toContain("[^139]: <https://hbr.org");

    // does NOT contain "Fact-checked by Grok"
    expect(markdown).not.toContain("Fact-checked by Grok");

    // does NOT contain "<script"
    expect(markdown).not.toContain("<script");

    // does NOT contain "Suggest edit"
    expect(markdown).not.toContain("Suggest edit");

    // does NOT contain "\[^"
    expect(markdown).not.toContain("\\[^");

    // does NOT contain any "<sup" (for citation sups)
    expect(markdown).not.toContain("<sup class");

    // markdown has no image syntax "!["
    expect(markdown).not.toContain("![");

    // produces body-only without "# Title" or "> Saved from Grokipedia"
    expect(markdown).not.toContain("# Impact of Artificial Intelligence on the Future\n");
    expect(markdown).not.toContain("> Saved from Grokipedia");

    // every [^N] used in the body has a matching [^N]: definition
    const bodyCitations = Array.from(markdown.matchAll(/\[\^(\d+)\](?!:)/g)).map((m) =>
      parseInt(m[1]!, 10),
    );
    expect(bodyCitations.length).toBeGreaterThan(0);
    for (const num of bodyCitations) {
      expect(markdown).toContain(`[^${num}]: `);
    }

    // 1. Text before "## Overview" contains at least 4 paragraphs separated by a blank line
    const overviewIndex = markdown.indexOf("## Overview");
    expect(overviewIndex).toBeGreaterThan(0);
    const introSection = markdown.slice(0, overviewIndex).trim();
    const introParagraphs = introSection
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    expect(introParagraphs.length).toBeGreaterThanOrEqual(4);

    // 2. "Expert analyses indicate" starts a line (preceded by "\n\n")
    expect(markdown).toContain("\n\nExpert analyses indicate");

    // 3. No line in the Markdown body is longer than 3000 characters
    const bodyLines = markdown.split("\n");
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(3000);
    }

    // Write full generated Markdown to packages/core/test/output/grokipedia-impact-of-ai.md
    const outputDir = join(currentDir, "../../test/output");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, ".gitignore"), "*\n", "utf-8");
    writeFileSync(join(outputDir, "grokipedia-impact-of-ai.md"), markdown, "utf-8");
  });

  it("dedupes citation runs preserving first-seen order", () => {
    const article: GrokipediaArticle = {
      url: "https://grokipedia.com/page/Test",
      title: "Test",
      summary: null,
      factCheckedAt: null,
      bodyHtml: "<p>Text with multiple citations: [^76][^77][^76] and [^1] [^2] [^1].</p>",
      references: [],
    };
    const md = grokipediaToMarkdown(article);
    expect(md).toContain("citations: [^76][^77] and [^1][^2].");
  });

  it("formats references with empty title or title equal to URL with angle brackets", () => {
    const article: GrokipediaArticle = {
      url: "https://grokipedia.com/page/Test",
      title: "Test",
      summary: null,
      factCheckedAt: null,
      bodyHtml: "<p>Content</p>",
      references: [
        {
          number: 1,
          title: "",
          url: "https://example.com/empty-title",
          domain: "example.com",
        },
        {
          number: 2,
          title: "https://example.com/url-as-title",
          url: "https://example.com/url-as-title",
          domain: "example.com",
        },
        {
          number: 3,
          title: "Real Title",
          url: "https://example.com/real-title",
          domain: "example.com",
        },
      ],
    };
    const md = grokipediaToMarkdown(article);
    expect(md).toContain("[^1]: <https://example.com/empty-title> - example.com");
    expect(md).toContain("[^2]: <https://example.com/url-as-title> - example.com");
    expect(md).toContain("[^3]: [Real Title](https://example.com/real-title) - example.com");
  });

  it("ensures body headings start at ## and collapses 3+ newlines to 2", () => {
    const article: GrokipediaArticle = {
      url: "https://grokipedia.com/page/Test",
      title: "Test",
      summary: null,
      factCheckedAt: null,
      bodyHtml: "<h1>Top Level</h1>\n\n\n\n<p>Paragraph</p>",
      references: [],
    };
    const md = grokipediaToMarkdown(article);
    expect(md).toContain("## Top Level\n\nParagraph");
    expect(md).not.toContain("\n\n\n");
  });

  it("formats short articles without references properly", () => {
    const article = parseGrokipediaHtml(shortFixtureHtml, shortArticleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    expect(markdown).toContain("Quantum teleportation is a technique");
    expect(markdown).not.toContain("# Quantum Teleportation");
    expect(markdown).not.toContain("> Saved from Grokipedia");
    expect(markdown).not.toContain("## References");
    expect(markdown).not.toContain("Fact-checked by Grok");
  });

  it("formats tables and nested lists with GFM formatting and references", () => {
    const article = parseGrokipediaHtml(tablesFixtureHtml, tablesArticleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    expect(markdown).not.toContain("# Global Space Missions");
    expect(markdown).toContain("| Mission | Destination | Launch Year | Status |");
    expect(markdown).toContain("| Artemis III | Lunar South Pole | 2026 | Planned |");
    expect(markdown).toMatch(/-\s+Planetary Surveying/);
    expect(markdown).toMatch(/\s+-\s+Surface mapping and spectrometry/);
    expect(markdown).toContain("[^1]");
    expect(markdown).toContain("[^2]");
    expect(markdown).toContain("## References");
    expect(markdown).toContain(
      "[^1]: [NASA Planetary Science Overview](https://www.nasa.gov/missions)",
    );
    expect(markdown).toContain(
      "[^2]: [ESA Exploration Horizons](https://www.esa.int/space-exploration)",
    );
  });
});
