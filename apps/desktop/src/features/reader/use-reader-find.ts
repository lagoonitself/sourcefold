import * as React from "react";
import {
  FIND_CURRENT_CLASS,
  applyFindMarks,
  blocksInRange,
  clearFindMarks,
  domRangeFor,
} from "./find-dom";
import { findAllMatches, findPassage, parseFindQuery, type TextRange } from "./find-text";

/** What the search box hands the reader: the words searched and where the hit starts. */
export interface InitialSearch {
  query: string;
  passageStart: string;
}

export interface ReaderFindArgs {
  open: boolean;
  /** The source whose text is on the page now; null until that text has rendered. */
  readyItemId: string | null;
  itemId: string | null;
  bodyHtml: string;
  noteHtml: string;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  initialSearch: InitialSearch | null | undefined;
}

export interface ReaderFindController {
  barOpen: boolean;
  query: string;
  setQuery: (query: string) => void;
  /** Matches on the page; 0 when there is no query. */
  count: number;
  /** 1-based position of the current match; 0 when there are none. */
  position: number;
  next: () => void;
  previous: () => void;
  /** Opens the bar (or focuses it when open) so you can type. */
  openBar: () => void;
  closeBar: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The "My note" block, which is searched like the body. */
  noteRef: React.RefObject<HTMLDivElement | null>;
}

interface Match {
  root: HTMLElement;
  range: TextRange;
  marks: HTMLElement[];
}

export const FLASH_CLASS = "reader-find-flash";
const FLASH_MS = 1700;

export function useReaderFind(args: ReaderFindArgs): ReaderFindController {
  const { open, itemId, readyItemId, bodyHtml, noteHtml, bodyRef, scrollRef, initialSearch } = args;

  const [barOpen, setBarOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [count, setCount] = React.useState(0);
  const [position, setPosition] = React.useState(0);
  const [tick, setTick] = React.useState(0);
  const [focusTick, setFocusTick] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const noteRef = React.useRef<HTMLDivElement | null>(null);
  const matchesRef = React.useRef<Match[]>([]);
  const currentRef = React.useRef(-1);
  const landingRef = React.useRef<InitialSearch | null>(null);
  const handledRef = React.useRef<string | null>(null);
  const flashedRef = React.useRef<{ blocks: HTMLElement[]; timer: number } | null>(null);

  const roots = React.useCallback(
    () => [bodyRef.current, noteRef.current].filter((el): el is HTMLDivElement => el !== null),
    [bodyRef],
  );

  const clearFlash = React.useCallback(() => {
    const flashed = flashedRef.current;
    if (!flashed) return;
    window.clearTimeout(flashed.timer);
    for (const block of flashed.blocks) block.classList.remove(FLASH_CLASS);
    flashedRef.current = null;
  }, []);

  // A different source, or closing the reader, starts from a closed bar.
  React.useLayoutEffect(() => {
    handledRef.current = null;
    landingRef.current = null;
    setBarOpen(false);
    setQuery("");
    setCount(0);
    setPosition(0);
    return clearFlash;
  }, [open, itemId, clearFlash]);

  /** Marks match `index` as the current one and scrolls to it unless it is already in view. */
  const showMatch = React.useCallback(
    (index: number, mode: "if-hidden" | "upper-third" | "stay") => {
      const previous = matchesRef.current[currentRef.current];
      for (const el of previous?.marks ?? []) el.classList.remove(FIND_CURRENT_CLASS);
      currentRef.current = index;
      setPosition(matchesRef.current.length > 0 ? index + 1 : 0);
      const match = matchesRef.current[index];
      if (!match) return;
      for (const el of match.marks) el.classList.add(FIND_CURRENT_CLASS);
      const scroller = scrollRef.current;
      const target = match.marks[0];
      if (!scroller || !target) return;
      const box = scroller.getBoundingClientRect();
      const top = target.getBoundingClientRect().top - box.top;
      if (mode === "stay") return;
      if (mode === "upper-third" || top < box.height * 0.12 || top > box.height * 0.85) {
        scroller.scrollTop += top - box.height / 3;
      }
    },
    [scrollRef],
  );

  // Paint the marks for the current query.
  React.useLayoutEffect(() => {
    for (const root of roots()) clearFindMarks(root);
    matchesRef.current = [];
    currentRef.current = -1;
    const landing = landingRef.current;
    landingRef.current = null;
    // A landing with a query that has no words (only exclusions) still goes to the passage.
    if (!open || !barOpen || (parseFindQuery(query).length === 0 && !landing)) {
      setCount(0);
      setPosition(0);
      return;
    }

    const found: Match[] = [];
    for (const root of roots()) {
      const ranges = findAllMatches(root.textContent ?? "", query);
      const marks = applyFindMarks(root, ranges);
      ranges.forEach((range, i) => found.push({ root, range, marks: marks[i] }));
    }
    matchesRef.current = found;
    setCount(found.length);

    if (!landing) {
      if (found.length > 0) showMatch(0, "if-hidden");
      else setPosition(0);
      return;
    }

    // Landing from the search box: the passage first, then the match inside it.
    let place: { root: HTMLElement; range: TextRange; how: "passage" | "word" } | null = null;
    for (const root of roots()) {
      const loc = findPassage(root.textContent ?? "", landing.passageStart, landing.query);
      if (loc && (!place || (loc.how === "passage" && place.how === "word"))) {
        place = { root, range: loc, how: loc.how };
      }
      if (place?.how === "passage") break;
    }
    if (!place) {
      if (found.length > 0) showMatch(0, "upper-third");
      return;
    }
    const { root, range } = place;
    let index = found.findIndex((m) => m.root === root && m.range.end > range.start);
    if (index === -1) index = found.length > 0 ? 0 : -1;
    if (index !== -1) showMatch(index, "stay");

    // The passage's start goes to the upper third; if its first marked word would then sit below
    // the fold (a long passage), that word goes there instead.
    const scroller = scrollRef.current;
    const dom = domRangeFor(root, range);
    if (scroller && dom) {
      const box = scroller.getBoundingClientRect();
      scroller.scrollTop += dom.getBoundingClientRect().top - box.top - box.height / 3;
      const mark = index === -1 ? undefined : found[index].marks[0];
      if (mark) {
        const top = mark.getBoundingClientRect().top - box.top;
        if (top > box.height * 0.9) scroller.scrollTop += top - box.height / 3;
      }
    }
    clearFlash();
    const blocks = blocksInRange(root, range);
    for (const block of blocks) block.classList.add(FLASH_CLASS);
    flashedRef.current = {
      blocks,
      timer: window.setTimeout(() => {
        for (const block of blocks) block.classList.remove(FLASH_CLASS);
        flashedRef.current = null;
      }, FLASH_MS),
    };
  }, [open, barOpen, query, bodyHtml, noteHtml, tick, roots, scrollRef, showMatch, clearFlash]);

  // Landing: once the source's text has rendered, show the search's words and jump to the hit.
  const ready =
    readyItemId !== null && readyItemId === itemId && (bodyHtml !== "" || noteHtml !== "");
  React.useLayoutEffect(() => {
    if (!open || !itemId || !initialSearch || !ready) return;
    const key = `${itemId}\u0000${initialSearch.query}\u0000${initialSearch.passageStart}`;
    if (handledRef.current === key) return;
    handledRef.current = key;
    landingRef.current = initialSearch;
    setQuery(initialSearch.query);
    setBarOpen(true);
    setTick((n) => n + 1);
  }, [open, itemId, initialSearch, ready]);

  // Focus the input after the bar has rendered.
  React.useEffect(() => {
    if (focusTick === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  const step = React.useCallback(
    (delta: 1 | -1) => {
      const total = matchesRef.current.length;
      if (total === 0) return;
      const from = currentRef.current < 0 ? (delta === 1 ? -1 : 0) : currentRef.current;
      showMatch((from + delta + total) % total, "if-hidden");
    },
    [showMatch],
  );

  const next = React.useCallback(() => step(1), [step]);
  const previous = React.useCallback(() => step(-1), [step]);

  const openBar = React.useCallback(() => {
    setBarOpen(true);
    setFocusTick((n) => n + 1);
  }, []);

  const closeBar = React.useCallback(() => {
    setBarOpen(false);
    setQuery("");
    scrollRef.current?.focus();
  }, [scrollRef]);

  return {
    barOpen,
    query,
    setQuery,
    count,
    position,
    next,
    previous,
    openBar,
    closeBar,
    inputRef,
    noteRef,
  };
}
