import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  PRESETS,
  WIDTH_MAX,
  WIDTH_MIN,
  clampSize,
  clampWidth,
  loadPrefs,
  matchingPreset,
  normalizePrefs,
  pageClass,
  prefsStyle,
  stepWidth,
} from "../reader-prefs";
import { countWords, pickBlock } from "../use-reading-flow";

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

describe("reader prefs", () => {
  it("starts from the defaults", () => {
    expect(loadPrefs(storage({}))).toEqual(DEFAULT_PREFS);
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it("carries the old Sans choice over once", () => {
    const prefs = loadPrefs(storage({ "sourcefold:reader:typography": "sans" }));
    expect(prefs.font).toBe("geist");
  });

  it("prefers saved settings over the old choice", () => {
    const prefs = loadPrefs(
      storage({
        "sourcefold:reader:prefs": JSON.stringify({ font: "literata", size: 22 }),
        "sourcefold:reader:typography": "sans",
      }),
    );
    expect(prefs.font).toBe("literata");
    expect(prefs.size).toBe(22);
  });

  it("survives broken or unknown values", () => {
    expect(loadPrefs(storage({ "sourcefold:reader:prefs": "{not json" }))).toEqual(DEFAULT_PREFS);
    const prefs = normalizePrefs({ font: "comic", size: 99, width: 3, page: "neon", align: 1 });
    expect(prefs.font).toBe(DEFAULT_PREFS.font);
    expect(prefs.size).toBe(28);
    expect(prefs.width).toBe(WIDTH_MIN);
    expect(prefs.page).toBe("app");
    expect(prefs.align).toBe("left");
  });

  it("clamps size and snaps width to steps", () => {
    expect(clampSize(3)).toBe(14);
    expect(clampSize(19.6)).toBe(20);
    expect(clampWidth(73)).toBe(75);
    expect(clampWidth(500)).toBe(WIDTH_MAX);
    expect(clampWidth("fill")).toBe("fill");
  });

  it("steps width up into Fill and back down", () => {
    expect(stepWidth(70, 1)).toBe(75);
    expect(stepWidth(70, -1)).toBe(65);
    expect(stepWidth(WIDTH_MAX, 1)).toBe("fill");
    expect(stepWidth("fill", 1)).toBe("fill");
    expect(stepWidth("fill", -1)).toBe(WIDTH_MAX);
    expect(stepWidth(WIDTH_MIN, -1)).toBe(WIDTH_MIN);
  });

  it("knows which preset the settings match", () => {
    expect(matchingPreset(DEFAULT_PREFS)?.id).toBe("comfortable");
    const book = PRESETS.find((p) => p.id === "book")!;
    expect(matchingPreset({ ...DEFAULT_PREFS, ...book.prefs, page: "sepia" })?.id).toBe("book");
    expect(matchingPreset({ ...DEFAULT_PREFS, size: 23 })).toBeNull();
  });

  it("turns settings into CSS variables", () => {
    const style = prefsStyle({ ...DEFAULT_PREFS, width: 80, size: 20 }) as Record<string, string>;
    expect(style["--reader-measure"]).toBe("80ch");
    expect(style["--reader-size"]).toBe("20px");
    expect(style["--reader-leading"]).toBe("1.65");
    const fill = prefsStyle({ ...DEFAULT_PREFS, width: "fill", font: "geist" }) as Record<
      string,
      string
    >;
    expect(fill["--reader-measure"]).toBe("100%");
    expect(fill["--reader-heading-font"]).toBe("var(--font-serif)");
  });

  it("maps page colours to theme classes", () => {
    expect(pageClass("app")).toBe("");
    expect(pageClass("sepia")).toContain("theme-light");
    expect(pageClass("black")).toContain("dark");
  });
});

describe("reading flow helpers", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one two\nthree ")).toBe(3);
  });

  it("lands on the saved block, else the last one before it", () => {
    const blocks = [{ start: 0 }, { start: 120 }, { start: 400 }];
    expect(pickBlock(blocks, 120)).toEqual({ start: 120 });
    expect(pickBlock(blocks, 300)).toEqual({ start: 120 });
    expect(pickBlock(blocks, 9999)).toEqual({ start: 400 });
    expect(pickBlock([{ start: 50 }], 10)).toBeNull();
  });
});
