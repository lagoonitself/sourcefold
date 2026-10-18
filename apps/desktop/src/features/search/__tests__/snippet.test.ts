import { describe, expect, it } from "vitest";
import { formatTimestamp, plainSnippet, splitSnippet } from "../snippet";

const S = "\u0002";
const E = "\u0003";

describe("splitSnippet", () => {
  it("bolds the marked words", () => {
    expect(splitSnippet(`the ${S}turbo${E} lag was`)).toEqual([
      { text: "the ", bold: false },
      { text: "turbo", bold: true },
      { text: " lag was", bold: false },
    ]);
  });

  it("handles several marks and a mark at either end", () => {
    expect(splitSnippet(`${S}boost${E} and ${S}delay${E}`)).toEqual([
      { text: "boost", bold: true },
      { text: " and ", bold: false },
      { text: "delay", bold: true },
    ]);
  });

  it("returns plain text as one segment", () => {
    expect(splitSnippet("no marks here")).toEqual([{ text: "no marks here", bold: false }]);
  });

  it("returns nothing for an empty snippet", () => {
    expect(splitSnippet("")).toEqual([]);
  });

  it("turns line breaks into spaces", () => {
    expect(plainSnippet(`one\n\ntwo ${S}three${E}\nfour`)).toBe("one two three four");
  });

  it("never lets a stray or unclosed marker into the text", () => {
    expect(plainSnippet(`${E}a${S}b`)).toBe("ab");
    expect(splitSnippet(`a ${S}b`)).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
    ]);
  });

  it("keeps markup as text, since it is never rendered as HTML", () => {
    const segments = splitSnippet(`<img src=x onerror=alert(1)> ${S}<b>${E}`);
    expect(segments.map((s) => s.text).join("")).toBe("<img src=x onerror=alert(1)> <b>");
  });

  it("trims the space at the ends", () => {
    expect(plainSnippet(`  ${S}word${E}  `)).toBe("word");
  });
});

describe("formatTimestamp", () => {
  it("formats minutes and seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(75)).toBe("1:15");
    expect(formatTimestamp(75.9)).toBe("1:15");
  });

  it("adds hours when needed", () => {
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("clamps negatives to zero", () => {
    expect(formatTimestamp(-5)).toBe("0:00");
  });
});
