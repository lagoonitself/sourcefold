import * as React from "react";

/**
 * How the reader lays out text: font, size, spacing, width, page colour. One set for every
 * source, kept in localStorage and shared by the reader's Aa popover and Settings → Reading.
 */

export type ReaderFont = "newsreader" | "literata" | "geist" | "atkinson";
export type ReaderLeading = "tight" | "normal" | "loose";
export type ReaderParagraphs = "spaced" | "indented";
export type ReaderAlign = "left" | "justify";
export type ReaderPage = "app" | "paper" | "sepia" | "dark" | "black";
/** Characters per line, or "fill" for the whole sheet. */
export type ReaderWidth = number | "fill";

export interface ReaderPrefs {
  font: ReaderFont;
  size: number;
  leading: ReaderLeading;
  width: ReaderWidth;
  paragraphs: ReaderParagraphs;
  align: ReaderAlign;
  page: ReaderPage;
  /** The contents list beside the text on wide sheets. */
  contents: boolean;
}

export const SIZE_MIN = 14;
export const SIZE_MAX = 28;
export const WIDTH_MIN = 50;
export const WIDTH_MAX = 120;
export const WIDTH_STEP = 5;

export const DEFAULT_PREFS: ReaderPrefs = {
  font: "newsreader",
  size: 19,
  leading: "normal",
  width: 70,
  paragraphs: "spaced",
  align: "left",
  page: "app",
  contents: true,
};

export interface FontOption {
  id: ReaderFont;
  name: string;
  /** What it's good for, shown under the name. */
  hint: string;
  family: string;
  serif: boolean;
}

export const FONT_OPTIONS: ReadonlyArray<FontOption> = [
  {
    id: "newsreader",
    name: "Newsreader",
    hint: "Serif, the app's own",
    family: `"Newsreader Variable", "Iowan Old Style", Georgia, serif`,
    serif: true,
  },
  {
    id: "literata",
    name: "Literata",
    hint: "Serif made for long reading",
    family: `"Literata Variable", Georgia, serif`,
    serif: true,
  },
  {
    id: "geist",
    name: "Geist",
    hint: "Sans, clean and compact",
    family: `"Geist Variable", -apple-system, "Segoe UI", sans-serif`,
    serif: false,
  },
  {
    id: "atkinson",
    name: "Atkinson",
    hint: "Hyperlegible: every letter distinct",
    family: `"Atkinson Hyperlegible Next Variable", -apple-system, "Segoe UI", sans-serif`,
    serif: false,
  },
];

export const LEADING_OPTIONS: ReadonlyArray<{ id: ReaderLeading; name: string; value: number }> = [
  { id: "tight", name: "Tight", value: 1.45 },
  { id: "normal", name: "Normal", value: 1.65 },
  { id: "loose", name: "Loose", value: 1.85 },
];

export const PAGE_OPTIONS: ReadonlyArray<{ id: ReaderPage; name: string }> = [
  { id: "app", name: "Match the app" },
  { id: "paper", name: "Paper" },
  { id: "sepia", name: "Sepia" },
  { id: "dark", name: "Dark" },
  { id: "black", name: "Black" },
];

export interface ReaderPreset {
  id: string;
  name: string;
  hint: string;
  prefs: Omit<ReaderPrefs, "page" | "contents">;
}

export const PRESETS: ReadonlyArray<ReaderPreset> = [
  {
    id: "comfortable",
    name: "Comfortable",
    hint: "The defaults",
    prefs: {
      font: "newsreader",
      size: 19,
      leading: "normal",
      width: 70,
      paragraphs: "spaced",
      align: "left",
    },
  },
  {
    id: "dense",
    name: "Dense",
    hint: "Most text on screen",
    prefs: {
      font: "geist",
      size: 16,
      leading: "tight",
      width: 100,
      paragraphs: "spaced",
      align: "left",
    },
  },
  {
    id: "book",
    name: "Book",
    hint: "Like a printed page",
    prefs: {
      font: "literata",
      size: 20,
      leading: "loose",
      width: 62,
      paragraphs: "indented",
      align: "justify",
    },
  },
];

const STORAGE_KEY = "sourcefold:reader:prefs";
const OLD_TYPOGRAPHY_KEY = "sourcefold:reader:typography";

function pick<T extends string>(value: unknown, allowed: ReadonlyArray<T>, fallback: T): T {
  return typeof value === "string" && (allowed as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : fallback;
}

export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PREFS.size;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(size)));
}

export function clampWidth(width: unknown): ReaderWidth {
  if (width === "fill") return "fill";
  if (typeof width !== "number" || !Number.isFinite(width)) return DEFAULT_PREFS.width;
  const stepped = Math.round(width / WIDTH_STEP) * WIDTH_STEP;
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, stepped));
}

/** Any stored value, made safe: unknown fields fall back to the defaults. */
export function normalizePrefs(raw: unknown): ReaderPrefs {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    font: pick(
      value.font,
      FONT_OPTIONS.map((f) => f.id),
      DEFAULT_PREFS.font,
    ),
    size: typeof value.size === "number" ? clampSize(value.size) : DEFAULT_PREFS.size,
    leading: pick(
      value.leading,
      LEADING_OPTIONS.map((l) => l.id),
      DEFAULT_PREFS.leading,
    ),
    width: clampWidth(value.width),
    paragraphs: pick(value.paragraphs, ["spaced", "indented"], DEFAULT_PREFS.paragraphs),
    align: pick(value.align, ["left", "justify"], DEFAULT_PREFS.align),
    page: pick(
      value.page,
      PAGE_OPTIONS.map((p) => p.id),
      DEFAULT_PREFS.page,
    ),
    contents: typeof value.contents === "boolean" ? value.contents : DEFAULT_PREFS.contents,
  };
}

/** Reads the saved settings; the old Serif / Sans choice carries over once. */
export function loadPrefs(storage: Pick<Storage, "getItem"> | null): ReaderPrefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) return normalizePrefs(JSON.parse(saved));
    if (storage.getItem(OLD_TYPOGRAPHY_KEY) === "sans") {
      return { ...DEFAULT_PREFS, font: "geist", size: 17 };
    }
  } catch {
    // Unreadable settings: start from the defaults.
  }
  return DEFAULT_PREFS;
}

/** The preset these settings match, if any. */
export function matchingPreset(prefs: ReaderPrefs): ReaderPreset | null {
  return (
    PRESETS.find((preset) =>
      (Object.keys(preset.prefs) as Array<keyof ReaderPreset["prefs"]>).every(
        (key) => preset.prefs[key] === prefs[key],
      ),
    ) ?? null
  );
}

export function fontOption(font: ReaderFont): FontOption {
  return FONT_OPTIONS.find((f) => f.id === font) ?? FONT_OPTIONS[0]!;
}

export function leadingValue(leading: ReaderLeading): number {
  return LEADING_OPTIONS.find((l) => l.id === leading)?.value ?? 1.65;
}

/** The next width one step narrower (-1) or wider (+1); "fill" sits past the widest. */
export function stepWidth(width: ReaderWidth, direction: 1 | -1): ReaderWidth {
  if (width === "fill") return direction === 1 ? "fill" : WIDTH_MAX;
  if (direction === 1 && width >= WIDTH_MAX) return "fill";
  return clampWidth(width + direction * WIDTH_STEP);
}

/** CSS variables for the article; `reader.css` reads them. */
export function prefsStyle(prefs: ReaderPrefs): React.CSSProperties {
  const font = fontOption(prefs.font);
  return {
    "--reader-font": font.family,
    "--reader-heading-font": font.serif ? font.family : "var(--font-serif)",
    "--reader-size": `${prefs.size}px`,
    "--reader-leading": String(leadingValue(prefs.leading)),
    "--reader-measure": prefs.width === "fill" ? "100%" : `${prefs.width}ch`,
  } as React.CSSProperties;
}

/** Classes for the reader sheet that switch its colours (see `index.css`, "Reader pages"). */
export function pageClass(page: ReaderPage): string {
  switch (page) {
    case "paper":
      return "theme-light";
    case "sepia":
      return "theme-light theme-sepia";
    case "dark":
      return "dark";
    case "black":
      return "dark theme-black";
    default:
      return "";
  }
}

// One shared copy, so the popover, Settings and the reader agree without a provider.
let current: ReaderPrefs | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function getReaderPrefs(): ReaderPrefs {
  if (!current) current = loadPrefs(storage());
  return current;
}

export function setReaderPrefs(
  update: Partial<ReaderPrefs> | ((prev: ReaderPrefs) => ReaderPrefs),
) {
  const prev = getReaderPrefs();
  const next = normalizePrefs(typeof update === "function" ? update(prev) : { ...prev, ...update });
  current = next;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not saved; it still applies until the app closes.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReaderPrefs(): ReaderPrefs {
  return React.useSyncExternalStore(subscribe, getReaderPrefs, getReaderPrefs);
}
