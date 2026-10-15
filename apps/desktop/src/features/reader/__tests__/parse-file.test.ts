import { describe, expect, it } from "vitest";
import { parseReaderFile, parseYamlScalar } from "../parse-file";
import { buildReaderHeader, formatIsoDay } from "../reader-meta";

const GROKIPEDIA = `---
source: grokipedia
title: Artificial General Intelligence
url: https://grokipedia.com/page/Artificial_General_Intelligence
summary: An overview of artificial general intelligence.
fact_checked: 2026-10-14
saved: 2026-10-15
folder: Science/AI
---

# Artificial General Intelligence

> Saved from [Grokipedia](https://grokipedia.com/page/Artificial_General_Intelligence) on 2026-10-15. Grokipedia articles change; check the live page for edits.

## Overview

AGI is the hypothetical ability of an agent.[^1]

## References

[^1]: [A source](https://example.com/a) - example.com
`;

const SUBSTACK = `---
source: substack
title: "The Architecture of Tomorrow: Part 1"
subtitle: How modular software is changing developer productivity
url: https://future.substack.com/p/architecture-of-tomorrow
author: Jane Doe
publication: Future Architecture
published: 2026-10-12
saved: 2026-10-15
folder: Newsletters/Tech
---

# The Architecture of Tomorrow: Part 1

*How modular software is changing developer productivity*

> Saved from [Future Architecture](https://future.substack.com/p/architecture-of-tomorrow) on 2026-10-15. By Jane Doe. Published 2026-10-12.

## Introduction

Software architectures have evolved.

## My note

Compare with the other post.
`;

describe("parseReaderFile", () => {
  it("splits a Grokipedia file into front matter, title, source line and body", () => {
    const parsed = parseReaderFile(GROKIPEDIA);
    expect(parsed.hasFrontMatter).toBe(true);
    expect(parsed.frontMatter.source).toBe("grokipedia");
    expect(parsed.frontMatter.fact_checked).toBe("2026-10-14");
    expect(parsed.title).toBe("Artificial General Intelligence");
    expect(parsed.subtitle).toBeNull();
    expect(parsed.sourceLine).toMatch(/^Saved from \[Grokipedia\]/);
    expect(parsed.note).toBeNull();
    expect(parsed.body.startsWith("## Overview")).toBe(true);
    expect(parsed.body).toContain("[^1]: [A source]");
    expect(parsed.body).not.toContain("source: grokipedia");
    expect(parsed.body).not.toContain("# Artificial General Intelligence");
  });

  it("reads a quoted title, the subtitle and the note of a Substack file", () => {
    const parsed = parseReaderFile(SUBSTACK);
    expect(parsed.frontMatter.title).toBe("The Architecture of Tomorrow: Part 1");
    expect(parsed.frontMatter.publication).toBe("Future Architecture");
    expect(parsed.title).toBe("The Architecture of Tomorrow: Part 1");
    expect(parsed.subtitle).toBe("How modular software is changing developer productivity");
    expect(parsed.sourceLine).toContain("By Jane Doe. Published 2026-10-12.");
    expect(parsed.body).toBe("## Introduction\n\nSoftware architectures have evolved.");
    expect(parsed.note).toBe("Compare with the other post.");
  });

  it("keeps an italic first line of the body when it is not a subtitle", () => {
    const parsed = parseReaderFile(
      "---\nsource: note\ntitle: Idea\n---\n\n# Idea\n\n*maybe later*\n\nMore text.\n",
    );
    expect(parsed.subtitle).toBeNull();
    expect(parsed.body).toBe("*maybe later*\n\nMore text.");
  });

  it("parses a note file, which has no source line", () => {
    const parsed = parseReaderFile(
      "---\nsource: note\ntitle: Meeting Notes\ncreated: 2026-10-15\n---\n\n# Meeting Notes\n\nDiscussed Q4.\n",
    );
    expect(parsed.title).toBe("Meeting Notes");
    expect(parsed.sourceLine).toBeNull();
    expect(parsed.body).toBe("Discussed Q4.");
  });

  it("takes plain text with no front matter as the body", () => {
    const parsed = parseReaderFile("# My heading\n\nJust a note.\n");
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.frontMatter).toEqual({});
    expect(parsed.title).toBeNull();
    expect(parsed.body).toBe("# My heading\n\nJust a note.");
  });

  it("does not treat a leading horizontal rule as front matter", () => {
    const text = "---\n\nSome words here\n\n---\n\nAfter the rule.\n";
    const parsed = parseReaderFile(text);
    expect(parsed.hasFrontMatter).toBe(false);
    expect(parsed.body).toBe(text.trim());
  });

  it("handles Windows line endings and a byte order mark", () => {
    const parsed = parseReaderFile(
      `${String.fromCharCode(0xfeff)}---\r\nsource: x\r\ntitle: Thread\r\n---\r\n\r\n# Thread\r\n\r\nHello\r\n`,
    );
    expect(parsed.frontMatter.source).toBe("x");
    expect(parsed.title).toBe("Thread");
    expect(parsed.body).toBe("Hello");
  });

  it("finds a note that follows an empty body", () => {
    const parsed = parseReaderFile(
      "---\nsource: x\ntitle: T\n---\n\n# T\n\n> Saved from [X](https://x.com/a) on 2026-10-15.\n\n## My note\n\nOnly a note.\n",
    );
    expect(parsed.body).toBe("");
    expect(parsed.note).toBe("Only a note.");
  });

  it("accepts an empty front matter block and list values", () => {
    expect(parseReaderFile("---\n---\n\nBody").body).toBe("Body");
    const parsed = parseReaderFile('---\ntags:\n  - one\n  - "two: 2"\nsource: note\n---\n\nBody');
    expect(parsed.frontMatter.tags).toBe("one, two: 2");
    expect(parsed.frontMatter.source).toBe("note");
  });
});

describe("parseYamlScalar", () => {
  it("decodes double quoted escapes", () => {
    expect(parseYamlScalar('"say \\"hi\\"\\nnext\\\\"')).toBe('say "hi"\nnext\\');
  });

  it("decodes single quoted strings and plain values", () => {
    expect(parseYamlScalar("'it''s'")).toBe("it's");
    expect(parseYamlScalar("  plain value ")).toBe("plain value");
  });
});

describe("buildReaderHeader", () => {
  const item = {
    id: "1",
    title: "Post",
    kind: "substack",
    source_url: "https://future.substack.com/p/post",
    created_at: "2026-10-15T08:00:00Z",
  };

  it("uses the front matter for author, publication, date and subtitle", () => {
    const header = buildReaderHeader(item, parseReaderFile(SUBSTACK));
    expect(header.author).toBe("Jane Doe");
    expect(header.publication).toBe("Future Architecture");
    expect(header.dateLabel).toBe("Oct 12, 2026");
    expect(header.subtitle).toBe("How modular software is changing developer productivity");
    expect(header.domain).toBe("future.substack.com");
  });

  it("falls back to the item when there is no file", () => {
    const header = buildReaderHeader({ ...item, meta: { author: "Sam" } }, null);
    expect(header.author).toBe("Sam");
    expect(header.url).toBe("https://future.substack.com/p/post");
    expect(header.dateLabel).toMatch(/^Saved /);
  });
});

describe("formatIsoDay", () => {
  it("formats a calendar day without moving it across time zones", () => {
    expect(formatIsoDay("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatIsoDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatIsoDay("nope")).toBeNull();
    expect(formatIsoDay(undefined)).toBeNull();
  });
});
