import { describe, expect, it } from "vitest";
import {
  findAllMatches,
  findPassage,
  foldWord,
  parseFindQuery,
  stemForms,
  tokenize,
} from "../find-text";

function slices(text: string, query: string): string[] {
  return findAllMatches(text, query).map((r) => text.slice(r.start, r.end));
}

describe("tokenize", () => {
  it("folds case, diacritics and apostrophes, and keeps offsets in the original", () => {
    const text = "Café DON’T stop";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.word)).toEqual(["cafe", "dont", "stop"]);
    expect(text.slice(tokens[1].start, tokens[1].end)).toBe("DON’T");
  });

  it("ignores punctuation between words", () => {
    expect(tokenize("Hello, world -- (again)!").map((t) => t.word)).toEqual([
      "hello",
      "world",
      "again",
    ]);
  });

  it("skips timestamps and numeric footnote marks", () => {
    expect(tokenize("Boost 0:47 builds[76] slowly 1:02:15 now").map((t) => t.word)).toEqual([
      "boost",
      "builds",
      "slowly",
      "now",
    ]);
  });

  it("keeps plain numbers", () => {
    expect(tokenize("In 1999 there were 12 cars").map((t) => t.word)).toContain("1999");
  });
});

describe("foldWord", () => {
  it("lowercases and strips accents", () => {
    expect(foldWord("Éclair")).toBe("eclair");
  });
});

describe("stemForms", () => {
  it("relates plurals and verb endings", () => {
    expect(stemForms("engines")).toContain("engine");
    expect(stemForms("batteries")).toContain("battery");
    expect(stemForms("making")).toContain("make");
    expect(stemForms("running")).toContain("run");
    expect(stemForms("tested")).toContain("test");
    expect(stemForms("boxes")).toContain("box");
  });

  it("leaves short words and -ss words alone", () => {
    expect(stemForms("bus")).toEqual(["bus"]);
    expect(stemForms("glass")).toEqual(["glass"]);
  });
});

describe("parseFindQuery", () => {
  it("parses words, phrases and drops exclusions", () => {
    const terms = parseFindQuery('turbo "boost pressure" -diesel lag');
    expect(terms).toEqual([
      { kind: "word", word: "turbo", prefix: false },
      { kind: "phrase", words: ["boost", "pressure"] },
      { kind: "word", word: "lag", prefix: true },
    ]);
  });

  it("returns nothing for blank or only-negative queries", () => {
    expect(parseFindQuery("   ")).toEqual([]);
    expect(parseFindQuery("-diesel")).toEqual([]);
  });
});

describe("findAllMatches", () => {
  const text = "The turbo spools. A Turbocharger adds boost; turbos are loud. Turbo!";

  it("lists every match in order with original offsets, case folded", () => {
    expect(slices(text, '"turbo"')).toEqual(["turbo", "turbos", "Turbo"]);
  });

  it("matches the last bare word as a prefix", () => {
    expect(slices(text, "turb")).toEqual(["turbo", "Turbocharger", "turbos", "Turbo"]);
  });

  it("matches plural and singular forms", () => {
    expect(slices("One engine, two engines.", "engines")).toEqual(["engine", "engines"]);
  });

  it("matches a phrase as one range, ignoring punctuation and case", () => {
    const t = "Boost, pressure rose. The BOOST pressure fell.";
    expect(slices(t, '"boost pressure"')).toEqual(["Boost, pressure", "BOOST pressure"]);
  });

  it("does not overlap a phrase and its words", () => {
    const t = "boost pressure";
    const ranges = findAllMatches(t, 'boost "boost pressure"');
    expect(ranges).toEqual([{ start: 0, end: 14 }]);
  });

  it("finds nothing for an empty query or no match", () => {
    expect(findAllMatches(text, "")).toEqual([]);
    expect(findAllMatches(text, "diesel")).toEqual([]);
  });
});

describe("findPassage", () => {
  const rendered =
    "Intro words here.\n\nHow Turbo lag works: the delay before boost builds comes from exhaust " +
    "energy, spool speed and pipe volume. Later text follows. [12] More.";
  const start12 = "How turbo lag works the delay before boost builds comes from exhaust";

  it("finds the 12-word start with case, whitespace and punctuation folded", () => {
    const loc = findPassage(rendered, start12, "turbo");
    expect(loc?.how).toBe("passage");
    expect(rendered.slice(loc!.start, loc!.end)).toBe(
      "How Turbo lag works: the delay before boost builds comes from exhaust",
    );
  });

  it("falls back to 8 words when the tail of the 12 differs", () => {
    const start = "how turbo lag works the delay before boost XXX YYY ZZZ WWW";
    const loc = findPassage(rendered, start, "nothing");
    expect(loc?.how).toBe("passage");
    expect(rendered.slice(loc!.start, loc!.end)).toBe(
      "How Turbo lag works: the delay before boost",
    );
  });

  it("falls back to 5 words when only the first 5 match", () => {
    const start = "how turbo lag works the AAA BBB CCC DDD EEE FFF GGG";
    const loc = findPassage(rendered, start, "nothing");
    expect(loc?.how).toBe("passage");
    expect(rendered.slice(loc!.start, loc!.end)).toBe("How Turbo lag works: the");
  });

  it("tries a short start whole", () => {
    const loc = findPassage(rendered, "Later text follows", "x");
    expect(loc?.how).toBe("passage");
    expect(rendered.slice(loc!.start, loc!.end)).toBe("Later text follows");
  });

  it("falls back to the first match of a query word", () => {
    const loc = findPassage(rendered, "completely different opening words nowhere here", "spool");
    expect(loc?.how).toBe("word");
    expect(rendered.slice(loc!.start, loc!.end)).toBe("spool");
  });

  it("returns null when neither the start nor a query word is present", () => {
    expect(findPassage(rendered, "completely different opening words", "zebra")).toBeNull();
  });

  it("ignores footnote marks and timestamps present only in the rendered text", () => {
    const text = "Start here [3] and 0:47 then go on to the end of it all.";
    const loc = findPassage(text, "Start here and then go on to the end", "x");
    expect(loc?.how).toBe("passage");
    expect(text.slice(loc!.start, loc!.end)).toBe("Start here [3] and 0:47 then go on to the end");
  });
});
