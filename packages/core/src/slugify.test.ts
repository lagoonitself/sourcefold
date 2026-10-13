import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("handles accents and diacritics", () => {
    expect(slugify("Café & Crème Brûlée")).toBe("cafe-creme-brulee");
  });

  it("handles emoji characters", () => {
    expect(slugify("Rocket 🚀 Launch 🌟")).toBe("rocket-launch");
  });

  it("handles punctuation and symbols", () => {
    expect(slugify("Hello, World! (Part 1): An Intro...")).toBe("hello-world-part-1-an-intro");
  });

  it("truncates long titles and strips trailing hyphens", () => {
    const longTitle = "a".repeat(90);
    const result = slugify(longTitle, 80);
    expect(result).toBe("a".repeat(80));
    expect(result.length).toBe(80);

    expect(slugify("hello-world-test", 6)).toBe("hello");
  });

  it('returns "untitled" for empty string', () => {
    expect(slugify("")).toBe("untitled");
  });

  it('returns "untitled" for only symbols', () => {
    expect(slugify('!@#$%^&*()_+~<>?:{}[]|"')).toBe("untitled");
    expect(slugify("    ")).toBe("untitled");
  });

  it("preserves already-slugged strings", () => {
    expect(slugify("already-a-clean-slug")).toBe("already-a-clean-slug");
  });

  it("converts mixed case to lower case", () => {
    expect(slugify("SoUrCeFoLd ApP")).toBe("sourcefold-app");
  });
});
