import { describe, expect, it } from "vitest";
import {
  citationsInRange,
  domainOf,
  isTimestampLabel,
  parseFootnoteDefinition,
  parseTimestampHref,
  secondsAt,
  type FootnoteDef,
} from "../extract";
import { savedUrlKeys, urlKey } from "../url-key";

describe("timestamps", () => {
  it("reads the seconds from a transcript link", () => {
    expect(parseTimestampHref("https://youtu.be/abcDEF12345?t=47")).toBe(47);
    expect(parseTimestampHref("https://www.youtube.com/watch?v=abcDEF12345&t=3725s")).toBe(3725);
    expect(parseTimestampHref("https://youtu.be/abc?t=1h2m3s")).toBe(3723);
  });

  it("ignores links that are not YouTube timestamps", () => {
    expect(parseTimestampHref("https://example.com/?t=47")).toBeNull();
    expect(parseTimestampHref("https://youtu.be/abc")).toBeNull();
    expect(parseTimestampHref("not a url")).toBeNull();
  });

  it("recognises the label form", () => {
    expect(isTimestampLabel("0:47")).toBe(true);
    expect(isTimestampLabel("1:02:05")).toBe(true);
    expect(isTimestampLabel("see 0:47")).toBe(false);
  });

  it("takes the nearest timestamp at or before the highlight start", () => {
    const marks = [
      { offset: 0, seconds: 0 },
      { offset: 300, seconds: 47 },
      { offset: 700, seconds: 120 },
    ];
    expect(secondsAt(marks, 0)).toBe(0);
    expect(secondsAt(marks, 299)).toBe(0);
    expect(secondsAt(marks, 300)).toBe(47);
    expect(secondsAt(marks, 650)).toBe(47);
    expect(secondsAt(marks, 5000)).toBe(120);
  });

  it("is null once the transcript has ended", () => {
    const marks = [{ offset: 0, seconds: 3 }];
    expect(secondsAt(marks, 90, 100)).toBe(3);
    expect(secondsAt(marks, 100, 100)).toBeNull();
  });

  it("is null before the first timestamp", () => {
    expect(secondsAt([{ offset: 100, seconds: 5 }], 40)).toBeNull();
    expect(secondsAt([], 40)).toBeNull();
  });
});

describe("parseFootnoteDefinition", () => {
  it("uses the link text as the title", () => {
    expect(
      parseFootnoteDefinition("12", {
        text: "SAE paper - sae.org",
        links: [{ href: "https://www.sae.org/paper", text: "SAE paper" }],
      }),
    ).toEqual({ label: "12", title: "SAE paper", url: "https://www.sae.org/paper" });
  });

  it("has no title when the link text is the address", () => {
    expect(
      parseFootnoteDefinition("3", {
        text: "https://example.com/a - example.com",
        links: [{ href: "https://example.com/a", text: "https://example.com/a" }],
      }),
    ).toEqual({ label: "3", title: null, url: "https://example.com/a" });
  });

  it("finds a bare address in the text", () => {
    expect(
      parseFootnoteDefinition("4", { text: "Smith 2020. See https://example.com/x.", links: [] }),
    ).toEqual({ label: "4", title: null, url: "https://example.com/x" });
  });

  it("is null without any web address", () => {
    expect(parseFootnoteDefinition("5", { text: "Smith 2020, p. 4", links: [] })).toBeNull();
    expect(
      parseFootnoteDefinition("6", {
        text: "mail",
        links: [{ href: "mailto:a@b.c", text: "mail" }],
      }),
    ).toBeNull();
  });
});

describe("citationsInRange", () => {
  const defs = new Map<string, FootnoteDef>([
    ["1", { label: "1", title: "One", url: "https://one.example/a" }],
    ["2", { label: "2", title: null, url: "https://two.example/b" }],
    ["3", { label: "3", title: "Three", url: "https://three.example/c" }],
  ]);
  const refs = [
    { offset: 10, label: "1" },
    { offset: 40, label: "2" },
    { offset: 55, label: "1" },
    { offset: 80, label: "3" },
    { offset: 90, label: "9" },
  ];

  it("lists the references whose markers sit inside the range, once each", () => {
    expect(citationsInRange(refs, defs, 0, 60)).toEqual([
      { n: "1", title: "One", url: "https://one.example/a" },
      { n: "2", title: null, url: "https://two.example/b" },
    ]);
  });

  it("includes the start and excludes the end", () => {
    expect(citationsInRange(refs, defs, 40, 80).map((c) => c.n)).toEqual(["2", "1"]);
    expect(citationsInRange(refs, defs, 41, 81).map((c) => c.n)).toEqual(["1", "3"]);
  });

  it("skips markers without a definition and respects the limit", () => {
    expect(citationsInRange(refs, defs, 85, 100)).toEqual([]);
    expect(citationsInRange(refs, defs, 0, 100, 2)).toHaveLength(2);
  });
});

describe("links", () => {
  it("names the domain without www", () => {
    expect(domainOf("https://www.sae.org/paper")).toBe("sae.org");
    expect(domainOf("nope")).toBe("nope");
  });

  it("compares saved links ignoring fragment, slash and www", () => {
    expect(urlKey("https://www.Example.com/a/#top")).toBe(urlKey("https://example.com/a"));
    expect(urlKey("ftp://example.com")).toBeNull();
    const keys = savedUrlKeys([
      { canonical_url: "https://example.com/a/", source_url: "https://example.com/a?utm=1" },
      { source_url: null },
    ]);
    expect(keys.has(urlKey("https://example.com/a") as string)).toBe(true);
    expect(keys.has(urlKey("https://example.com/b") as string)).toBe(false);
  });
});
