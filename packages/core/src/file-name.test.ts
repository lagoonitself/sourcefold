import { describe, expect, it } from "vitest";
import { safeName, uniqueNames } from "./file-name";

describe("safeName", () => {
  it("keeps clean titles unchanged", () => {
    expect(safeName("Quantum Computing")).toBe("Quantum Computing");
    expect(safeName("The Art of Computer Programming")).toBe("The Art of Computer Programming");
  });

  it("replaces colon with space-dash and slashes/pipes with dash", () => {
    expect(safeName("Deep Learning: A Visual Approach")).toBe("Deep Learning - A Visual Approach");
    expect(safeName("Cars/Engines/Diesel")).toBe("Cars-Engines-Diesel");
    expect(safeName("A\\B/C|D")).toBe("A-B-C-D");
    expect(safeName("Alpha:Beta/Gamma|Delta\\Epsilon")).toBe("Alpha -Beta-Gamma-Delta-Epsilon");
  });

  it('removes < > " ? * and control characters', () => {
    expect(safeName('What is "AI"? <Where>*')).toBe("What is AI Where");
    expect(safeName("Hello\u0000World\u001f\u007f\u009f")).toBe("HelloWorld");
  });

  it("collapses whitespace runs and trims spaces and dots from ends", () => {
    expect(safeName("  ...Many    spaces    here...  ")).toBe("Many spaces here");
    expect(safeName("..dots at start and end..")).toBe("dots at start and end");
    expect(safeName(". . .spaced dots. . .")).toBe("spaced dots");
  });

  it("cuts at word break before or at 100 characters", () => {
    const long =
      "This is a very long title that exceeds one hundred characters and must be sliced at the nearest word boundary";
    const res = safeName(long);
    expect(res.length).toBeLessThanOrEqual(100);
    expect(res).toBe(
      "This is a very long title that exceeds one hundred characters and must be sliced at the nearest word",
    );
    expect(res.length).toBe(100);
  });

  it("cuts at 100 characters when there is no word break", () => {
    const longWord = "A".repeat(120);
    const res = safeName(longWord);
    expect(res).toBe("A".repeat(100));
    expect(res.length).toBe(100);
  });

  it("returns Untitled for empty or invalid names", () => {
    expect(safeName("")).toBe("Untitled");
    expect(safeName("   ")).toBe("Untitled");
    expect(safeName("...   ...")).toBe("Untitled");
    expect(safeName('???<>"*')).toBe("Untitled");
  });

  it("appends (file) for Windows reserved names in any case", () => {
    expect(safeName("CON")).toBe("CON (file)");
    expect(safeName("con")).toBe("con (file)");
    expect(safeName("PRN")).toBe("PRN (file)");
    expect(safeName("aux")).toBe("aux (file)");
    expect(safeName("NUL")).toBe("NUL (file)");
    expect(safeName("COM1")).toBe("COM1 (file)");
    expect(safeName("com9")).toBe("com9 (file)");
    expect(safeName("LPT1")).toBe("LPT1 (file)");
    expect(safeName("lpt9")).toBe("lpt9 (file)");

    // Not reserved:
    expect(safeName("contact")).toBe("contact");
    expect(safeName("condo")).toBe("condo");
    expect(safeName("null")).toBe("null");
  });
});

describe("uniqueNames", () => {
  it("keeps unique single names untouched", () => {
    const map = uniqueNames([
      { id: "1", name: "Report", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", name: "Summary", createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(map.get("1")).toBe("Report");
    expect(map.get("2")).toBe("Summary");
  });

  it("resolves collisions by creation order with plain name then (2), (3)", () => {
    const map = uniqueNames([
      { id: "c", name: "Impact of AI", createdAt: "2026-10-13T12:00:00Z" },
      { id: "a", name: "Impact of AI", createdAt: "2026-10-13T10:00:00Z" },
      { id: "b", name: "Impact of AI", createdAt: "2026-10-13T11:00:00Z" },
    ]);
    expect(map.get("a")).toBe("Impact of AI");
    expect(map.get("b")).toBe("Impact of AI (2)");
    expect(map.get("c")).toBe("Impact of AI (3)");
  });

  it("handles case-insensitive collisions", () => {
    const map = uniqueNames([
      { id: "1", name: "report", createdAt: "2026-10-13T10:00:00Z" },
      { id: "2", name: "Report", createdAt: "2026-10-13T11:00:00Z" },
    ]);
    expect(map.get("1")).toBe("report");
    expect(map.get("2")).toBe("Report (2)");
  });

  it("breaks ties using id ascending", () => {
    const map = uniqueNames([
      { id: "z", name: "Notes", createdAt: "2026-10-13T10:00:00Z" },
      { id: "a", name: "Notes", createdAt: "2026-10-13T10:00:00Z" },
    ]);
    expect(map.get("a")).toBe("Notes");
    expect(map.get("z")).toBe("Notes (2)");
  });
});
