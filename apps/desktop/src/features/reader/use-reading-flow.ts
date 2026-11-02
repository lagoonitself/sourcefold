import * as React from "react";
import { SOURCE_SPAN_ATTR } from "@sourcefold/core/reader";

/**
 * Where the reader is in a source: the contents (its headings and the one you're in), how far
 * you've read and the time left, and the place you stopped, kept per source so it opens there.
 */

export interface OutlineEntry {
  id: number;
  level: number;
  text: string;
  element: HTMLElement;
}

export interface ReadingFlow {
  outline: OutlineEntry[];
  /** Index into `outline` of the section at the top of the view, or -1 before the first. */
  current: number;
  /** 0 to 1. */
  progress: number;
  /** Whole minutes left, or null when there's under a minute or nothing to read. */
  minutesLeft: number | null;
  /** True for a few seconds after the reader reopened a source where you stopped. */
  resumed: boolean;
  jumpTo: (entry: OutlineEntry) => void;
  backToStart: () => void;
}

const WORDS_PER_MINUTE = 230;
const POSITIONS_KEY = "sourcefold:reader:positions";
const MAX_POSITIONS = 400;
/** How far below the top of the view a heading counts as "the section you're in". */
const SECTION_OFFSET = 96;

interface SavedPosition {
  /** `data-sf-src` start of the first block on screen. */
  start: number;
  progress: number;
  at: number;
}

type PositionMap = Record<string, SavedPosition>;

function readPositions(): PositionMap {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as PositionMap) : {};
  } catch {
    return {};
  }
}

export function loadPosition(itemId: string): SavedPosition | null {
  const saved = readPositions()[itemId];
  return saved && typeof saved.start === "number" ? saved : null;
}

/** Saves (or with null, forgets) where a source was left; keeps the most recent 400. */
export function savePosition(itemId: string, position: SavedPosition | null) {
  try {
    const all = readPositions();
    if (position) all[itemId] = position;
    else delete all[itemId];
    const kept = Object.entries(all)
      .sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0))
      .slice(0, MAX_POSITIONS);
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not saved: the source opens at the top next time.
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function spanStart(element: Element): number | null {
  const value = element.getAttribute(SOURCE_SPAN_ATTR);
  const start = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(start) ? start : null;
}

/** The block to land on: the one starting at `start`, else the last one before it. */
export function pickBlock<T extends { start: number }>(blocks: T[], start: number): T | null {
  let best: T | null = null;
  for (const block of blocks) {
    if (block.start === start) return block;
    if (block.start < start && (!best || block.start > best.start)) best = block;
  }
  return best;
}

function topIn(scroller: HTMLElement, element: Element): number {
  return (
    element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
  );
}

export function useReadingFlow(args: {
  open: boolean;
  itemId: string | null;
  bodyHtml: string;
  bodyText: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The reader was opened at a highlight or a search match for this source: don't move it. */
  landingItemId: string | null;
}): ReadingFlow {
  const { open, itemId, bodyHtml, bodyText, bodyRef, scrollRef, landingItemId } = args;
  const [outline, setOutline] = React.useState<OutlineEntry[]>([]);
  const [current, setCurrent] = React.useState(-1);
  const [progress, setProgress] = React.useState(0);
  const [resumed, setResumed] = React.useState(false);
  const words = React.useMemo(() => countWords(bodyText), [bodyText]);

  // Heading tops, measured when the text or its layout changes, not on every scroll.
  const headingTops = React.useRef<number[]>([]);
  const outlineRef = React.useRef<OutlineEntry[]>([]);
  outlineRef.current = outline;
  const restoredFor = React.useRef<string | null>(null);

  const measure = React.useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    headingTops.current = outlineRef.current.map((entry) => topIn(scroller, entry.element));
  }, [scrollRef]);

  const update = React.useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const next = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 1;
    setProgress((prev) => (Math.abs(prev - next) < 0.002 ? prev : next));
    const line = scroller.scrollTop + SECTION_OFFSET;
    let index = -1;
    headingTops.current.forEach((top, i) => {
      if (top <= line) index = i;
    });
    setCurrent(index);
  }, [scrollRef]);

  // The outline: headings of the rendered body (h1–h4).
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body || !bodyHtml) {
      setOutline([]);
      return;
    }
    const entries: OutlineEntry[] = [];
    body.querySelectorAll<HTMLElement>("h1, h2, h3, h4").forEach((element, id) => {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) entries.push({ id, level: Number(element.tagName.slice(1)), text, element });
    });
    setOutline(entries);
  }, [open, bodyHtml, bodyRef]);

  // Measure again whenever the text's size changes (settings, images, highlights, the window).
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    measure();
    update();
    const observer = new ResizeObserver(() => {
      measure();
      update();
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [open, bodyHtml, outline, bodyRef, measure, update]);

  // Scroll: progress and the current section every frame, the saved place after a pause.
  React.useEffect(() => {
    const scroller = scrollRef.current;
    if (!open || !scroller || !itemId) return;
    let frame = 0;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const body = bodyRef.current;
      if (!body || restoredFor.current !== itemId) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const fraction = max > 0 ? scroller.scrollTop / max : 0;
      if (fraction < 0.02) {
        savePosition(itemId, null);
        return;
      }
      const viewTop = scroller.getBoundingClientRect().top;
      for (const block of body.querySelectorAll(`[${SOURCE_SPAN_ATTR}]`)) {
        if (block.getBoundingClientRect().bottom > viewTop + 8) {
          const start = spanStart(block);
          if (start !== null) savePosition(itemId, { start, progress: fraction, at: Date.now() });
          return;
        }
      }
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 500);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(saveTimer);
      save();
    };
  }, [open, itemId, scrollRef, bodyRef, update]);

  // Open where you stopped, once per source, after its text is on screen.
  React.useEffect(() => {
    if (!open) {
      restoredFor.current = null;
      return;
    }
    const scroller = scrollRef.current;
    const body = bodyRef.current;
    if (!itemId || !scroller || !body || !bodyHtml || restoredFor.current === itemId) return;
    restoredFor.current = itemId;
    if (landingItemId === itemId) return;
    const saved = loadPosition(itemId);
    const blocks: Array<{ start: number; element: Element }> = [];
    if (saved) {
      body.querySelectorAll(`[${SOURCE_SPAN_ATTR}]`).forEach((element) => {
        const start = spanStart(element);
        if (start !== null) blocks.push({ start, element });
      });
    }
    const target = saved ? pickBlock(blocks, saved.start) : null;
    const frame = requestAnimationFrame(() => {
      if (target) {
        scroller.scrollTop = Math.max(0, topIn(scroller, target.element) - 24);
        setResumed(true);
      } else {
        scroller.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, itemId, bodyHtml, landingItemId, scrollRef, bodyRef]);

  React.useEffect(() => {
    if (!resumed) return;
    const timer = setTimeout(() => setResumed(false), 6000);
    return () => clearTimeout(timer);
  }, [resumed]);

  React.useEffect(() => {
    setResumed(false);
  }, [itemId]);

  const jumpTo = React.useCallback(
    (entry: OutlineEntry) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      scroller.scrollTo({ top: Math.max(0, topIn(scroller, entry.element) - 24) });
      setResumed(false);
    },
    [scrollRef],
  );

  const backToStart = React.useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setResumed(false);
  }, [scrollRef]);

  const left = Math.floor((words * (1 - progress)) / WORDS_PER_MINUTE);
  return {
    outline,
    current,
    progress,
    minutesLeft: words > 0 && left >= 1 ? left : null,
    resumed,
    jumpTo,
    backToStart,
  };
}
