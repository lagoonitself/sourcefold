import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../html-to-markdown.js";
import { parseGrokipediaHtml, GrokipediaParseError } from "./parse.js";
import { grokipediaToMarkdown } from "./markdown.js";

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

    // Link kept
    expect(md).toContain("[a link](https://example.com)");

    // Nested list kept
    expect(md).toMatch(/-\s+Item 1/);
    expect(md).toMatch(/\s+-\s+Subitem 1/);
    expect(md).toMatch(/-\s+Item 2/);

    // Disallowed elements stripped
    expect(md).not.toContain("Click me");
    expect(md).not.toContain("<circle");
    expect(md).not.toContain("Test Pic");
    expect(md).not.toContain("console.log");

    // Ends with single newline
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });
});

describe("parseGrokipediaHtml", () => {
  it("throws GrokipediaParseError if h1 or article is missing", () => {
    expect(() => parseGrokipediaHtml("<div>No article or h1</div>", articleUrl)).toThrow(
      GrokipediaParseError,
    );
    expect(() => parseGrokipediaHtml("<article>No h1</article>", articleUrl)).toThrow(
      GrokipediaParseError,
    );
    expect(() => parseGrokipediaHtml("<h1>No article</h1>", articleUrl)).toThrow(
      GrokipediaParseError,
    );
  });

  it("parses the Grokipedia fixture correctly", () => {
    const article = parseGrokipediaHtml(fixtureHtml, articleUrl);

    // 1. title === "Impact of Artificial Intelligence on the Future"
    expect(article.title).toBe("Impact of Artificial Intelligence on the Future");

    // 2. summary starts with "The impact of artificial intelligence (AI) on the future encompasses"
    expect(article.summary).not.toBeNull();
    expect(
      article.summary?.startsWith(
        "The impact of artificial intelligence (AI) on the future encompasses",
      ),
    ).toBe(true);

    // 3. factCheckedAt === "2026-09-28T21:50:07.000Z"
    expect(article.factCheckedAt).toBe("2026-09-28T21:50:07.000Z");

    // 4. references.length === 139; reference numbers are 1..139 in order
    expect(article.references.length).toBe(139);
    for (let i = 0; i < 139; i++) {
      expect(article.references[i]?.number).toBe(i + 1);
    }

    // 5. reference 69's url contains "propublica.org" and its domain is "propublica.org"
    const ref69 = article.references[68];
    expect(ref69).toBeDefined();
    expect(ref69?.number).toBe(69);
    expect(ref69?.url).toContain("propublica.org");
    expect(ref69?.domain).toBe("propublica.org");
  });

  it("parses short article without references cleanly", () => {
    const article = parseGrokipediaHtml(shortFixtureHtml, shortArticleUrl);
    expect(article.title).toBe("Quantum Teleportation");
    expect(article.summary).toBe(
      "Quantum teleportation is a technique for transferring quantum information from a sender to a receiver.",
    );
    expect(article.factCheckedAt).toBe("2026-10-01T12:00:00.000Z");
    expect(article.references).toHaveLength(0);
  });

  it("parses article with tables, lists and citations accurately", () => {
    const article = parseGrokipediaHtml(tablesFixtureHtml, tablesArticleUrl);
    expect(article.title).toBe("Global Space Missions");
    expect(article.factCheckedAt).toBe("2026-08-15T09:30:00.000Z");
    expect(article.references).toHaveLength(2);
    expect(article.references[0]?.number).toBe(1);
    expect(article.references[0]?.domain).toBe("nasa.gov");
    expect(article.references[1]?.number).toBe(2);
    expect(article.references[1]?.domain).toBe("esa.int");
  });
});

describe("grokipediaToMarkdown", () => {
  it("generates clean Markdown from the Grokipedia fixture", () => {
    const article = parseGrokipediaHtml(fixtureHtml, articleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    // markdown contains "## Overview"
    expect(markdown).toContain("## Overview");

    // contains "[^1]"
    expect(markdown).toContain("[^1]");

    // contains "[^139]: ["
    expect(markdown).toContain("[^139]: [");

    // does NOT contain "Fact-checked by Grok"
    expect(markdown).not.toContain("Fact-checked by Grok");

    // does NOT contain "<script"
    expect(markdown).not.toContain("<script");

    // does NOT contain "Suggest edit"
    expect(markdown).not.toContain("Suggest edit");

    // does NOT contain "\[^"
    expect(markdown).not.toContain("\\[^");

    // does NOT contain any "<sup"
    expect(markdown).not.toContain("<sup");

    // markdown has no image syntax "!["
    expect(markdown).not.toContain("![");

    // every [^N] used in the body has a matching [^N]: definition
    const bodyCitations = Array.from(markdown.matchAll(/\[\^(\d+)\](?!:)/g)).map((m) =>
      parseInt(m[1]!, 10),
    );
    expect(bodyCitations.length).toBeGreaterThan(0);
    for (const num of bodyCitations) {
      expect(markdown).toContain(`[^${num}]: `);
    }

    // 1. Text between "> Saved from Grokipedia" and "## Overview" contains at least 4 paragraphs separated by a blank line
    const savedIndex = markdown.indexOf("> Saved from Grokipedia");
    const overviewIndex = markdown.indexOf("## Overview");
    expect(savedIndex).toBeGreaterThan(-1);
    expect(overviewIndex).toBeGreaterThan(savedIndex);
    const savedLineEnd = markdown.indexOf("\n", savedIndex);
    const introSection = markdown.slice(savedLineEnd, overviewIndex).trim();
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

  it("formats short articles without references properly", () => {
    const article = parseGrokipediaHtml(shortFixtureHtml, shortArticleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    expect(markdown).toContain("# Quantum Teleportation");
    expect(markdown).toContain("> Saved from Grokipedia");
    expect(markdown).toContain("Quantum teleportation is a technique");
    expect(markdown).not.toContain("## References");
    expect(markdown).not.toContain("Fact-checked by Grok");
  });

  it("formats tables and nested lists with GFM formatting and references", () => {
    const article = parseGrokipediaHtml(tablesFixtureHtml, tablesArticleUrl);
    const markdown = grokipediaToMarkdown(article, { savedAt: "2026-10-13" });

    expect(markdown).toContain("# Global Space Missions");
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
