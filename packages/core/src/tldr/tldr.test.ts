import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseReaderFile } from "../reader/parse-file";
import {
  buildTldrInput,
  findArticleTldr,
  inlineToText,
  markdownBlocks,
  normalizeTldr,
  parseTldrAnswer,
  readingMinutes,
  splitSentences,
  tldrBodyHash,
  TLDR_INPUT_MAX,
} from "./index";

const golden = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../test/golden");

function goldenBody(name: string) {
  const parsed = parseReaderFile(fs.readFileSync(path.join(golden, `${name}.md`), "utf8"));
  return { body: parsed.body, frontMatter: parsed.frontMatter, title: parsed.title ?? "" };
}

describe("inlineToText", () => {
  it("keeps link text and drops images, footnotes and emphasis", () => {
    expect(
      inlineToText(
        "A **[turbo](https://x.y/t)** is *fast*.[^1][12] ![pic](https://x.y/p.png) `code` &amp; more",
      ),
    ).toBe("A turbo is fast. code & more");
  });

  it("keeps transcript times", () => {
    expect(inlineToText("[12:30] the part")).toBe("[12:30] the part");
  });
});

describe("markdownBlocks", () => {
  it("splits headings, paragraphs and lists, and skips tables, code and captions", () => {
    const blocks = markdownBlocks(
      [
        "Lead text here.",
        "",
        "![](https://x.y/a.gif)",
        "",
        "*A caption*",
        "",
        "| a | b |",
        "| --- | --- |",
        "",
        "## History",
        "",
        "- one",
        "- two",
        "  continued",
        "",
        "```",
        "code",
        "```",
        "",
        "[^1]: a footnote",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "paragraph", level: 0, text: "Lead text here.", items: [] },
      { type: "heading", level: 2, text: "History", items: [] },
      { type: "list", level: 0, text: "one\ntwo continued", items: ["one", "two continued"] },
    ]);
  });
});

describe("splitSentences and readingMinutes", () => {
  it("splits on sentence ends before a capital", () => {
    expect(splitSentences('It spins. "Fast," he said! Then 3 more? yes.')).toEqual([
      "It spins.",
      '"Fast," he said!',
      "Then 3 more? yes.",
    ]);
  });

  it("counts minutes at 230 words, at least one", () => {
    expect(readingMinutes("word ".repeat(10))).toBe(1);
    expect(readingMinutes("word ".repeat(2300))).toBe(10);
  });
});

describe("normalizeTldr", () => {
  it("clips, trims list markers and drops empty points", () => {
    const tldr = normalizeTldr({
      gist: "  A   gist. ",
      points: ["- one", "", 2, "3) three", "x".repeat(400)],
      best_part: "none",
    });
    expect(tldr?.gist).toBe("A gist.");
    expect(tldr?.points.slice(0, 2)).toEqual(["one", "three"]);
    expect(tldr?.points[2]!.length).toBeLessThanOrEqual(300);
    expect(tldr?.best_part).toBeNull();
  });

  it("refuses an answer with no gist", () => {
    expect(normalizeTldr({ points: ["a"] })).toBeNull();
    expect(normalizeTldr("text")).toBeNull();
  });
});

describe("tldrBodyHash", () => {
  it("is stable and changes with the text", () => {
    expect(tldrBodyHash("abc")).toBe(tldrBodyHash("abc"));
    expect(tldrBodyHash("abc")).not.toBe(tldrBodyHash("abd"));
  });
});

describe("findArticleTldr", () => {
  it("uses a Wikipedia article's lead", () => {
    const { body } = goldenBody("wikipedia");
    const tldr = findArticleTldr({ kind: "wikipedia", body });
    expect(tldr?.gist).toMatch(
      /^In an internal combustion engine, a turbocharger is a forced induction device/,
    );
    expect(tldr?.gist).not.toContain("[^1]");
  });

  it("uses a Grokipedia article's overview", () => {
    const { body } = goldenBody("grokipedia");
    expect(findArticleTldr({ kind: "grokipedia", body })?.gist).toMatch(
      /^Artificial general intelligence \(AGI\) is the hypothetical ability/,
    );
  });

  it("uses an arXiv paper's abstract", () => {
    const { body } = goldenBody("pdf-arxiv");
    expect(findArticleTldr({ kind: "pdf", body })?.gist).toMatch(
      /^We study turbocharger efficiency/,
    );
  });

  it("finds a plain PDF's Abstract paragraph", () => {
    const body =
      "Some Title\n\nAbstract. We measure boost lag on twelve engines and find it halves.\n\n1 Introduction";
    expect(findArticleTldr({ kind: "pdf", body })?.gist).toBe(
      "We measure boost lag on twelve engines and find it halves.",
    );
  });

  it("finds a TL;DR line in a Reddit post, not in its comments", () => {
    const post =
      "Long story about my car.\n\n**TL;DR:** The turbo kit cost twice the quote. Do the clutch first.\n\n## Comments\n\nTL;DR: a comment summary that must be ignored here.";
    const tldr = findArticleTldr({ kind: "reddit", body: post });
    expect(tldr?.gist).toBe("The turbo kit cost twice the quote. Do the clutch first.");

    const onlyComment =
      "Post text.\n\n## Comments\n\ntldr: a comment summary that must be ignored.";
    expect(findArticleTldr({ kind: "reddit", body: onlyComment })).toBeNull();
  });

  it("uses a Key takeaways section on a web page", () => {
    const body = [
      "Intro paragraph.",
      "",
      "## Key takeaways",
      "",
      "- Twin-scroll housings cut lag.",
      "- They cost more.",
      "- They need a matched manifold.",
      "",
      "## Details",
      "",
      "Lots of text.",
    ].join("\n");
    const tldr = findArticleTldr({ kind: "web", body });
    expect(tldr).toEqual({
      gist: "Twin-scroll housings cut lag.",
      points: ["They cost more.", "They need a matched manifold."],
      best_part: null,
    });
  });

  it("skips a long Summary section (a plot summary, not a TL;DR)", () => {
    const body = `## Summary\n\n${"A long plot sentence goes here. ".repeat(80)}`;
    expect(findArticleTldr({ kind: "web", body })).toBeNull();
  });

  it("finds nothing in a transcript or a page without signals", () => {
    expect(findArticleTldr({ kind: "youtube", body: goldenBody("youtube").body })).toBeNull();
    expect(findArticleTldr({ kind: "web", body: goldenBody("web").body })).toBeNull();
    expect(findArticleTldr({ kind: "web", body: "   " })).toBeNull();
  });
});

describe("buildTldrInput", () => {
  it("sends a short source whole, with a header", () => {
    const { body, frontMatter, title } = goldenBody("reddit");
    const input = buildTldrInput({ title, kind: "reddit", body, frontMatter });
    expect(input.shortened).toBe(false);
    expect(input.text).toMatch(
      /^Title: Should I turbo my car\?\nType: Reddit thread\nAuthor: op_user/,
    );
    expect(input.text).toContain("Do the clutch first.");
  });

  it("cuts a long article down to its lead, outline and section starts", () => {
    const sections = Array.from(
      { length: 120 },
      (_, i) =>
        `## Section ${i + 1}\n\nFirst paragraph of section ${i + 1}. ${"Filler words. ".repeat(40)}\n\n${"More text. ".repeat(200)}`,
    ).join("\n\n");
    const body = `The lead says what it is.\n\n${sections}`;
    const input = buildTldrInput({ title: "Big", kind: "grokipedia", body });
    expect(input.shortened).toBe(true);
    expect(input.text.length).toBeLessThanOrEqual(TLDR_INPUT_MAX);
    expect(input.text).toContain("The lead says what it is.");
    expect(input.text).toContain("## Outline of the whole text");
    expect(input.text).toContain("- Section 120");
    expect(input.text).toContain("First paragraph of section 1.");
    expect(input.text).not.toContain(
      "More text. More text. More text. More text. More text. More text. More text.",
    );
  });

  it("samples a long transcript evenly, keeping the times", () => {
    const paragraphs = Array.from(
      { length: 600 },
      (_, i) =>
        `[${Math.floor(i / 2)}:${i % 2 ? "30" : "00"}](https://youtu.be/abc?t=${i * 30}) Passage ${i} ${"talk ".repeat(30)}`,
    ).join("\n\n");
    const body = `## Transcript\n\n${paragraphs}\n\n## Description\n\nThe video description.`;
    const input = buildTldrInput({ title: "Talk", kind: "youtube", body });
    expect(input.shortened).toBe(true);
    expect(input.text.length).toBeLessThanOrEqual(TLDR_INPUT_MAX);
    expect(input.text).toContain("The video description.");
    expect(input.text).toContain("[0:00] Passage 0");
    expect(input.text).not.toContain("youtu.be");
    // Something from the last third of the video made it in.
    const last = [...input.text.matchAll(/Passage (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...last)).toBeGreaterThan(400);
  });
});

describe("parseTldrAnswer", () => {
  it("reads JSON inside fences and chatter", () => {
    expect(
      parseTldrAnswer(
        'Sure! ```json\n{"gist": "Turbos cut lag.", "points": ["One", "Two"], "best_part": null}\n``` Hope that helps {:}',
      ),
    ).toEqual({ gist: "Turbos cut lag.", points: ["One", "Two"], best_part: null });
  });

  it("gives null for an answer without JSON", () => {
    expect(parseTldrAnswer("I can't do that.")).toBeNull();
    expect(parseTldrAnswer('{"points": []}')).toBeNull();
  });
});
