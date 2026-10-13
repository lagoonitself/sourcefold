import { describe, expect, it } from "vitest";
import { buildFrontMatter, formatDate } from "./front-matter";

describe("buildFrontMatter", () => {
  it("formats simple string, number, and boolean fields", () => {
    const result = buildFrontMatter({
      source: "grokipedia",
      views: 120,
      verified: true,
      archived: false,
    });

    expect(result).toBe(
      "---\nsource: grokipedia\nviews: 120\nverified: true\narchived: false\n---\n",
    );
  });

  it("quotes strings containing colons followed by space", () => {
    const result = buildFrontMatter({
      title: "Part 1: The Beginning",
    });

    expect(result).toBe('---\ntitle: "Part 1: The Beginning"\n---\n');
  });

  it("quotes strings starting with quotes", () => {
    const result = buildFrontMatter({
      doubleQuote: '"Quoted Title"',
      singleQuote: "'Single Quoted'",
    });

    expect(result).toBe(
      '---\ndoubleQuote: "\\"Quoted Title\\""\nsingleQuote: "\'Single Quoted\'"\n---\n',
    );
  });

  it("quotes strings with hash starting or with space-hash", () => {
    const result = buildFrontMatter({
      tagHeader: "#tag",
      inlineComment: "title # not comment",
      safeHash: "C#",
    });

    expect(result).toBe(
      '---\ntagHeader: "#tag"\ninlineComment: "title # not comment"\nsafeHash: C#\n---\n',
    );
  });

  it("quotes strings starting with leading dash or special characters", () => {
    const result = buildFrontMatter({
      leadingDash: "- item style",
      leadingQuestion: "? question",
      leadingColon: ": colon",
      leadingPipe: "| pipe",
      leadingGreater: "> quote",
      leadingAt: "@handle",
      leadingBacktick: "`code`",
    });

    expect(result).toBe(
      '---\nleadingDash: "- item style"\nleadingQuestion: "? question"\nleadingColon: ": colon"\nleadingPipe: "| pipe"\nleadingGreater: "> quote"\nleadingAt: "@handle"\nleadingBacktick: "`code`"\n---\n',
    );
  });

  it("quotes strings with leading or trailing whitespace", () => {
    const result = buildFrontMatter({
      leading: "  leading space",
      trailing: "trailing space ",
    });

    expect(result).toBe(
      '---\nleading: "  leading space"\ntrailing: "trailing space "\n---\n',
    );
  });

  it("quotes reserved YAML keywords", () => {
    const result = buildFrontMatter({
      boolTrue: "true",
      boolFalse: "false",
      yesWord: "yes",
      noWord: "no",
      nullWord: "null",
      tildeWord: "~",
    });

    expect(result).toBe(
      '---\nboolTrue: "true"\nboolFalse: "false"\nyesWord: "yes"\nnoWord: "no"\nnullWord: "null"\ntildeWord: "~"\n---\n',
    );
  });

  it("quotes numeric strings to prevent YAML type coercion", () => {
    const result = buildFrontMatter({
      intStr: "123",
      floatStr: "3.14",
      sciStr: "1e5",
      hexStr: "0x1f",
    });

    expect(result).toBe(
      '---\nintStr: "123"\nfloatStr: "3.14"\nsciStr: "1e5"\nhexStr: "0x1f"\n---\n',
    );
  });

  it("skips null, undefined, empty strings, and empty arrays", () => {
    const result = buildFrontMatter({
      valid: "exists",
      nullVal: null,
      undefinedVal: undefined,
      emptyStr: "",
      emptyArr: [],
    });

    expect(result).toBe("---\nvalid: exists\n---\n");
  });

  it("formats string arrays correctly", () => {
    const result = buildFrontMatter({
      tags: ["news", "tech: update", "123"],
    });

    expect(result).toBe(
      '---\ntags:\n  - news\n  - "tech: update"\n  - "123"\n---\n',
    );
  });

  it("quotes and escapes strings with newline and tab characters", () => {
    const result = buildFrontMatter({
      multiline: "line 1\nline 2",
      tabbed: "col 1\tcol 2",
    });

    expect(result).toBe('---\nmultiline: "line 1\\nline 2"\ntabbed: "col 1\\tcol 2"\n---\n');
  });

  it("quotes and escapes strings with Unicode line and paragraph separators", () => {
    const result = buildFrontMatter({
      titleWithLS: "Line 1\u2028Line 2",
      titleWithPS: "Para 1\u2029Para 2",
    });

    expect(result).toBe('---\ntitleWithLS: "Line 1\\u2028Line 2"\ntitleWithPS: "Para 1\\u2029Para 2"\n---\n');
  });

  it("quotes strings ending with colon", () => {
    const result = buildFrontMatter({
      label: "Chapter:",
    });

    expect(result).toBe('---\nlabel: "Chapter:"\n---\n');
  });

  it("escapes backslashes and double quotes inside quoted strings", () => {
    const result = buildFrontMatter({
      path: "C:\\Users\\name: test",
      quote: '"Hello": World',
    });

    expect(result).toBe(
      '---\npath: "C:\\\\Users\\\\name: test"\nquote: "\\"Hello\\": World"\n---\n',
    );
  });

  it("returns empty front matter block when given an empty object", () => {
    expect(buildFrontMatter({})).toBe("---\n---\n");
  });

  it("preserves insertion order of keys", () => {
    const result = buildFrontMatter({
      zebra: "z",
      apple: "a",
      mango: "m",
    });

    expect(result).toBe("---\nzebra: z\napple: a\nmango: m\n---\n");
  });
});

describe("formatDate", () => {
  it("formats Date object to YYYY-MM-DD in UTC", () => {
    const d = new Date(Date.UTC(2026, 9, 13, 10, 30, 0));
    expect(formatDate(d)).toBe("2026-10-13");
  });

  it("formats ISO date string to YYYY-MM-DD in UTC", () => {
    expect(formatDate("2026-10-13")).toBe("2026-10-13");
    expect(formatDate("2026-01-05T00:00:00Z")).toBe("2026-01-05");
  });

  it("converts timezone offset correctly to UTC date", () => {
    // 23:30 on Oct 13 in UTC-5 is 04:30 on Oct 14 in UTC
    expect(formatDate("2026-10-13T23:30:00-05:00")).toBe("2026-10-14");
    // 01:30 on Oct 13 in UTC+5 is 20:30 on Oct 12 in UTC
    expect(formatDate("2026-10-13T01:30:00+05:00")).toBe("2026-10-12");
  });

  it("throws on invalid Date instance", () => {
    expect(() => formatDate(new Date(NaN))).toThrow("Invalid date");
  });

  it("throws on invalid date string", () => {
    expect(() => formatDate("not-a-date")).toThrow("Invalid date");
    expect(() => formatDate("")).toThrow("Invalid date");
    expect(() => formatDate("   ")).toThrow("Invalid date");
  });
});
