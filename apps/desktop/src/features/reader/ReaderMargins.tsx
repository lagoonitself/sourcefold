import * as React from "react";
import { cn } from "@/lib/utils";
import type { ReadingFlow } from "./use-reading-flow";

/**
 * What sits beside the text on a wide sheet: the contents on the left and the footnotes on the
 * right, plus the small card a footnote reference shows on hover when its note isn't beside it.
 */

export function progressLabel(flow: ReadingFlow): string {
  const percent = `${Math.round(flow.progress * 100)}%`;
  return flow.minutesLeft ? `${percent}, ${flow.minutesLeft} min left` : percent;
}

/** The article's headings; the section you're in has the highlighter's soft fill. */
export function ContentsList({
  flow,
  onPick,
  className,
}: {
  flow: ReadingFlow;
  onPick?: () => void;
  className?: string;
}) {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const minLevel = flow.outline.reduce((min, entry) => Math.min(min, entry.level), 6);

  // Keep the current section in view inside the list (never scroll the article from here).
  React.useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>("[aria-current='location']");
    if (!list || !active) return;
    const top = active.offsetTop - list.offsetTop;
    if (top < list.scrollTop + 24 || top > list.scrollTop + list.clientHeight - 48) {
      list.scrollTop = top - list.clientHeight / 3;
    }
  }, [flow.current]);

  return (
    <div ref={listRef} className={cn("overflow-y-auto overscroll-contain", className)}>
      <nav aria-label="Contents" className="flex flex-col gap-px pb-2">
        {flow.outline.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            aria-current={index === flow.current ? "location" : undefined}
            onClick={() => {
              flow.jumpTo(entry);
              onPick?.();
            }}
            style={{ paddingLeft: `${8 + (entry.level - minLevel) * 12}px` }}
            className={cn(
              "w-full cursor-pointer rounded-[7px] py-1 pr-2 text-left text-[13px] leading-[18px] transition-colors duration-100",
              index === flow.current
                ? "bg-marker-soft font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="line-clamp-2">{entry.text}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** The contents beside the text: sticky, as tall as the view. */
export function ContentsRail({ flow }: { flow: ReadingFlow }) {
  return (
    <div className="sticky top-6 flex max-h-[calc(100dvh-120px)] flex-col pt-1 font-sans select-none">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-2">
        <span className="text-[12px] font-medium leading-4 text-muted-foreground">Contents</span>
        <span className="text-[12px] leading-4 tabular-nums text-muted-foreground">
          {progressLabel(flow)}
        </span>
      </div>
      <ContentsList flow={flow} className="min-h-0 flex-1" />
    </div>
  );
}

interface Note {
  href: string;
  label: string;
  html: string;
  ref: HTMLElement;
}

/** The first reference to each footnote, with the note's text. */
function collectNotes(body: HTMLElement): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  body.querySelectorAll<HTMLAnchorElement>(".fn-ref a[href^='#fn-']").forEach((ref) => {
    const href = ref.getAttribute("href") ?? "";
    if (seen.has(href)) return;
    seen.add(href);
    const item = body.ownerDocument.getElementById(href.slice(1));
    const text = item?.querySelector(".fn-text");
    if (!item || !text) return;
    notes.push({
      href,
      label: item.querySelector(".fn-label")?.textContent ?? ref.textContent ?? "",
      html: text.innerHTML,
      ref,
    });
  });
  return notes;
}

function firstRefs(body: HTMLElement): Set<Element> {
  const seen = new Set<string>();
  const firsts = new Set<Element>();
  body.querySelectorAll(".fn-ref a[href^='#fn-']").forEach((ref) => {
    const href = ref.getAttribute("href") ?? "";
    if (!seen.has(href)) firsts.add(ref);
    seen.add(href);
  });
  return firsts;
}

const NOTE_GAP = 10;

/**
 * Footnotes in the right margin, each at the height of its first reference; notes that would
 * overlap are pushed down. Positions are set on the elements directly, measured whenever the
 * text or the margin changes size.
 */
export function Sidenotes({
  bodyRef,
  bodyHtml,
  flashHref,
  onClick,
}: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  bodyHtml: string;
  flashHref: string | null;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [notes, setNotes] = React.useState<Note[]>([]);

  React.useEffect(() => {
    const body = bodyRef.current;
    setNotes(body && bodyHtml ? collectNotes(body) : []);
  }, [bodyRef, bodyHtml]);

  const place = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rootTop = root.getBoundingClientRect().top;
    const elements = Array.from(root.children) as HTMLElement[];
    const tops = notes.map((note) => note.ref.getBoundingClientRect().top - rootTop - 4);
    const heights = elements.map((el) => el.offsetHeight);
    let floor = 0;
    elements.forEach((el, i) => {
      const y = Math.max(tops[i] ?? 0, floor);
      el.style.transform = `translateY(${Math.round(y)}px)`;
      floor = y + (heights[i] ?? 0) + NOTE_GAP;
    });
    root.style.height = `${Math.max(0, floor - NOTE_GAP)}px`;
  }, [notes]);

  React.useLayoutEffect(() => {
    place();
    const body = bodyRef.current;
    const root = rootRef.current;
    if (!body || !root) return;
    const observer = new ResizeObserver(() => place());
    observer.observe(body);
    observer.observe(root.parentElement ?? root);
    return () => observer.disconnect();
  }, [place, bodyRef]);

  return (
    <div
      ref={rootRef}
      aria-label="Footnotes"
      role="list"
      className="relative font-sans"
      onClick={onClick}
      onAuxClick={onClick}
    >
      {notes.map((note) => (
        <div
          key={note.href}
          role="listitem"
          data-note-href={note.href}
          className={cn(
            "reader-sidenote absolute inset-x-0 top-0 rounded-[8px] px-2 py-1 text-[12.5px] leading-[18px] text-muted-foreground transition-colors duration-150",
            flashHref === note.href && "bg-marker-soft text-foreground",
          )}
        >
          <span className="mr-1 font-medium text-foreground tabular-nums">{note.label}</span>
          <span dangerouslySetInnerHTML={{ __html: note.html }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Hovering or focusing a `[12]` shows its note in a small card under it. With the notes in the
 * margin, only later references to a note get the card (the first one's note is beside it).
 */
export function FootnotePeek({
  bodyRef,
  wrapperRef,
  bodyHtml,
  sidenotesShown,
  onClick,
}: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  wrapperRef: React.RefObject<HTMLElement | null>;
  bodyHtml: string;
  sidenotesShown: boolean;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const [peek, setPeek] = React.useState<{
    label: string;
    html: string;
    top: number;
    left: number;
  } | null>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstsRef = React.useRef<Set<Element>>(new Set());

  React.useEffect(() => {
    const body = bodyRef.current;
    firstsRef.current = body && bodyHtml ? firstRefs(body) : new Set();
    setPeek(null);
  }, [bodyRef, bodyHtml]);

  React.useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const show = (event: Event) => {
      const ref = (event.target as HTMLElement | null)?.closest?.(".fn-ref a[href^='#fn-']");
      const wrapper = wrapperRef.current;
      if (!ref || !wrapper) return;
      if (sidenotesShown && firstsRef.current.has(ref)) return;
      const item = body.ownerDocument.getElementById((ref.getAttribute("href") ?? "").slice(1));
      const text = item?.querySelector(".fn-text");
      if (!item || !text) return;
      clearTimeout(hideTimer.current);
      const box = wrapper.getBoundingClientRect();
      const at = ref.getBoundingClientRect();
      const width = Math.min(340, box.width);
      setPeek({
        label: item.querySelector(".fn-label")?.textContent ?? "",
        html: text.innerHTML,
        top: at.bottom - box.top + 6,
        left: Math.min(Math.max(0, at.left - box.left - 24), box.width - width),
      });
    };
    const hide = (event: Event) => {
      const ref = (event.target as HTMLElement | null)?.closest?.(".fn-ref a");
      if (!ref) return;
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setPeek(null), 180);
    };
    body.addEventListener("mouseover", show);
    body.addEventListener("focusin", show);
    body.addEventListener("mouseout", hide);
    body.addEventListener("focusout", hide);
    return () => {
      body.removeEventListener("mouseover", show);
      body.removeEventListener("focusin", show);
      body.removeEventListener("mouseout", hide);
      body.removeEventListener("focusout", hide);
      clearTimeout(hideTimer.current);
    };
  }, [bodyRef, wrapperRef, bodyHtml, sidenotesShown]);

  if (!peek) return null;
  return (
    <div
      data-reader-ui
      role="note"
      onMouseEnter={() => clearTimeout(hideTimer.current)}
      onMouseLeave={() => setPeek(null)}
      onClick={onClick}
      style={{ top: peek.top, left: peek.left }}
      className="animate-pop-in absolute z-30 w-[340px] max-w-full rounded-[12px] bg-popover px-3.5 py-2.5 font-sans text-[13px] leading-[19px] text-popover-foreground shadow-float select-text"
    >
      <span className="mr-1 font-medium tabular-nums">{peek.label}</span>
      <span className="text-muted-foreground" dangerouslySetInnerHTML={{ __html: peek.html }} />
    </div>
  );
}
