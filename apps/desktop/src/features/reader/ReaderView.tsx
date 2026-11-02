import * as React from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Eraser,
  ExternalLink,
  FileText,
  ALargeSmall,
  ArrowUpToLine,
  Highlighter,
  Maximize2,
  Minimize2,
  PanelRight,
  Search,
  StickyNote,
  TableOfContents,
  X,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SourceTile, getSourceKind, formatSavedDate } from "@/features/items/source-kinds";
import { cn, openUrl } from "@/lib/utils";
import { HighlightMenu } from "./HighlightMenu";
import { HighlightsPanel } from "./HighlightsPanel";
import { ReaderCleanupLayer } from "./ReaderCleanupLayer";
import { ReaderTextEditor } from "./ReaderTextEditor";
import {
  ContentsList,
  ContentsRail,
  FootnotePeek,
  Sidenotes,
  progressLabel,
} from "./ReaderMargins";
import { ReaderSettingsPopover } from "./ReaderSettings";
import { buildReaderHeader, calculateReadingTime } from "./reader-meta";
import { prefsStyle, setReaderPrefs, useReaderPrefs } from "./reader-prefs";
import { useReaderContent } from "./use-reader-content";
import { SourceInfoPanel } from "../research/source-info";
import { TldrBox } from "../tldr/TldrBox";
import "./reader.css";
import type { ReaderFindController, ReaderViewProps } from "./types";

export { getReaderAuthor } from "./reader-meta";

/** The sheet must be this wide for the contents beside the text when the text fills it. */
const FILL_CONTENTS_MIN = 1100;
const CONTENTS_TRACK_MIN = 180;
const NOTES_TRACK_MIN = 200;

/** Width of an element, kept up to date. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The language for hyphenation: the file's or the source's, else English. */
function readerLang(meta: Record<string, unknown> | undefined, fm: Record<string, unknown>) {
  for (const value of [fm.lang, fm.language, meta?.lang, meta?.language]) {
    if (typeof value === "string" && /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(value.trim())) {
      return value.trim();
    }
  }
  return "en";
}

/** Opens links from the rendered text in the system browser; `#` links scroll to a footnote. */
function handleContentClick(event: React.MouseEvent<HTMLElement>) {
  const anchor = (event.target as HTMLElement).closest("a");
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    document.getElementById(href.slice(1))?.scrollIntoView({ block: "center" });
  } else if (/^(https?:|mailto:)/i.test(href)) {
    void openUrl(href);
  }
}

const noBodyRef: React.RefObject<HTMLDivElement | null> = { current: null };

export function ReaderView({
  item,
  state,
  onRetry,
  onClose,
  scrollRef,
  className,
  content,
  highlights,
  bodyRef,
  find,
  cleanup,
  projectId,
  onUpdateResearch,
  researchSignals,
  flow,
  focusMode = false,
  onToggleFocus,
  uiRef,
}: ReaderViewProps) {
  const prefs = useReaderPrefs();
  const fill = prefs.width === "fill";
  const [copied, setCopied] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [contentsOpen, setContentsOpen] = React.useState(false);
  const [flashHref, setFlashHref] = React.useState<string | null>(null);
  const [toolbarRevealed, setToolbarRevealed] = React.useState(false);
  const settingsButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const contentsButtonRef = React.useRef<HTMLDivElement | null>(null);
  const leftMarginRef = React.useRef<HTMLElement | null>(null);
  const rightMarginRef = React.useRef<HTMLElement | null>(null);
  const ownScrollRef = React.useRef<HTMLDivElement | null>(null);
  const scrollerRef = scrollRef ?? ownScrollRef;
  const leftWidth = useWidth(leftMarginRef);
  const rightWidth = useWidth(rightMarginRef);
  const sheetWidth = useWidth(scrollerRef);

  const kind = getSourceKind(item.kind);

  const text = state.status === "ready" ? state.text : null;
  const own = useReaderContent(content ? null : text);
  const { parsed, bodyHtml, noteHtml } = content ?? own;
  const header = buildReaderHeader(item, parsed);
  const targetUrl = header.url;

  const body = parsed?.body ?? "";
  const menuHighlight = highlights?.menu
    ? highlights.highlights.find((h) => h.id === highlights.menu?.id)
    : undefined;
  const readingTime = body ? calculateReadingTime(body) : null;
  const lang = readerLang(item.meta, (parsed?.frontMatter ?? {}) as Record<string, unknown>);

  // The margins: contents on the left, footnotes on the right, when the sheet has room.
  const hasOutline = Boolean(flow && flow.outline.length >= 2);
  const hasNotes = bodyHtml.includes('class="fn-ref"');
  const contentsFit = fill ? sheetWidth >= FILL_CONTENTS_MIN : leftWidth >= CONTENTS_TRACK_MIN;
  const railShown = Boolean(flow) && !focusMode && hasOutline && prefs.contents && contentsFit;
  const sidenotesShown = !focusMode && hasNotes && rightWidth >= NOTES_TRACK_MIN;

  const toggleContents = React.useCallback(() => {
    if (!hasOutline) return;
    if (contentsFit && !focusMode) {
      setReaderPrefs((prev) => ({ ...prev, contents: !prev.contents }));
      setContentsOpen(false);
    } else {
      setContentsOpen((open) => !open);
    }
  }, [hasOutline, contentsFit, focusMode]);

  // Clicks outside close the contents popover.
  React.useEffect(() => {
    if (!contentsOpen) return;
    const handlePointer = (event: MouseEvent) => {
      if (!contentsButtonRef.current?.contains(event.target as Node)) setContentsOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [contentsOpen]);

  React.useEffect(() => {
    if (!flashHref) return;
    const timer = setTimeout(() => setFlashHref(null), 1600);
    return () => clearTimeout(timer);
  }, [flashHref]);

  // Focus: the toolbar hides; moving the mouse to the top edge brings it back.
  React.useEffect(() => {
    if (!focusMode) {
      setToolbarRevealed(false);
      return;
    }
    const handleMove = (event: MouseEvent) => {
      if (event.clientY <= 12) setToolbarRevealed(true);
      else if (event.clientY > 80 && !settingsOpen && !contentsOpen) setToolbarRevealed(false);
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [focusMode, settingsOpen, contentsOpen]);

  if (uiRef) {
    uiRef.current = {
      toggleSettings: () => setSettingsOpen((open) => !open),
      toggleContents,
      closePopovers: () => {
        if (settingsOpen || contentsOpen) {
          setSettingsOpen(false);
          setContentsOpen(false);
          return true;
        }
        return false;
      },
    };
  }

  /** With the notes beside the text, a `[12]` lights its note instead of jumping to the end. */
  const handleArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (sidenotesShown) {
      const ref = (event.target as HTMLElement).closest(".fn-ref a");
      const href = ref?.getAttribute("href");
      if (href?.startsWith("#fn-")) {
        event.preventDefault();
        setFlashHref(href);
        return;
      }
    }
    handleContentClick(event);
  };

  const handleCopyMarkdown = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.success("Markdown copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy Markdown");
    }
  };

  const handleOpenSource = () => {
    if (!targetUrl) return;
    void openUrl(targetUrl);
  };

  const articleRef = React.useRef<HTMLElement | null>(null);

  const savedDate = header.dateLabel || formatSavedDate(item.created_at);

  const openInBrowserButton = targetUrl ? (
    <Button variant="outline" size="sm" onClick={handleOpenSource}>
      <ExternalLink className="size-3.5 mr-1.5" aria-hidden="true" />
      Open original
    </Button>
  ) : null;

  return (
    <div
      className={cn(
        "@container/reader relative flex h-full w-full flex-col bg-background text-foreground select-none",
        className,
      )}
    >
      {/*
        Toolbar (52px, drag region on macOS: data-tauri-drag-region, and 78px left padding
        under .platform-mac since the traffic lights sit there): close (X, Esc), the source
        tile and source name, "3 of 24" with prev/next buttons ([/]), then right: time left,
        find, contents, highlighter, Remove text, Aa, panel, copy, Open original, Focus. A thin
        line along its bottom edge fills as you read. In Focus it hides until the mouse reaches
        the top edge.
      */}
      <header
        data-reader-ui
        data-tauri-drag-region
        onMouseLeave={() => {
          if (focusMode && !settingsOpen && !contentsOpen) setToolbarRevealed(false);
        }}
        className={cn(
          "top-0 z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 select-none [.platform-mac_&]:pl-[78px]",
          focusMode ? "absolute inset-x-0 shadow-float" : "sticky",
          focusMode && !toolbarRevealed && "hidden",
        )}
      >
        {flow && state.status === "ready" && bodyHtml && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px]"
          >
            <div
              className="h-full origin-left bg-foreground/60"
              style={{ transform: `scaleX(${flow.progress})` }}
            />
          </div>
        )}
        {/* Left: Close button, Source Tile, Source name, "3 of 24" with prev/next */}
        <div className="flex items-center gap-2 overflow-hidden mr-3">
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close reader (Esc)"
              aria-label="Close reader"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}

          <SourceTile kind={item.kind} className="size-7 rounded-[7px] shrink-0" />

          <span
            className="truncate text-[13px] font-medium text-foreground max-w-[280px]"
            title={item.title}
          >
            {item.title}
          </span>

          {highlights?.position && highlights.position.total > 1 && (
            <div className="flex items-center gap-1 pl-1">
              <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
                {highlights.position.index} of {highlights.position.total}
              </span>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => highlights.navigate(-1)}
                  disabled={highlights.position.index <= 1}
                  title="Previous source ([)"
                  aria-label="Previous source"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => highlights.navigate(1)}
                  disabled={highlights.position.index >= highlights.position.total}
                  title="Next source (])"
                  aria-label="Next source"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {flow?.minutesLeft && state.status === "ready" && (
            <span className="mr-1.5 hidden whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground @[760px]/reader:inline">
              {flow.minutesLeft} min left
            </span>
          )}

          {find && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (find.barOpen ? find.closeBar() : find.openBar())}
              aria-pressed={find.barOpen}
              title="Find in this source (Mod+F)"
              aria-label="Find in this source"
              className={cn(
                "text-muted-foreground hover:text-foreground",
                find.barOpen && "bg-accent text-accent-foreground",
              )}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
          )}

          {flow && hasOutline && (
            <div ref={contentsButtonRef} className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleContents}
                aria-pressed={railShown || contentsOpen}
                aria-label="Contents"
                title="Contents (\)"
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  (railShown || contentsOpen) && "bg-accent text-accent-foreground",
                )}
              >
                <TableOfContents className="size-4" aria-hidden="true" />
              </Button>
              {contentsOpen && (
                <div
                  role="dialog"
                  aria-label="Contents"
                  className="animate-pop-in absolute right-0 top-[42px] z-40 flex max-h-[min(560px,calc(100dvh-120px))] w-[300px] origin-top-right flex-col rounded-[12px] bg-popover p-2 font-sans text-popover-foreground shadow-float"
                >
                  <div className="mb-1 flex items-baseline justify-between px-2 pt-1 text-[12px] leading-4 text-muted-foreground">
                    <span className="font-medium">Contents</span>
                    <span className="tabular-nums">{progressLabel(flow)}</span>
                  </div>
                  <ContentsList
                    flow={flow}
                    onPick={() => setContentsOpen(false)}
                    className="min-h-0 flex-1"
                  />
                </div>
              )}
            </div>
          )}

          {highlights && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => highlights.setAutoHighlight(!highlights.autoHighlight)}
              aria-pressed={highlights.autoHighlight}
              aria-label="Highlight when I select text"
              title={
                highlights.autoHighlight
                  ? "Selecting text highlights it. Hold Alt to select only. Click to turn off."
                  : "Selecting text does not highlight. Press h to highlight. Click to turn on."
              }
              className={cn(
                "text-muted-foreground hover:text-foreground",
                highlights.autoHighlight && "bg-accent text-accent-foreground",
              )}
            >
              <Highlighter className="size-4" aria-hidden="true" />
            </Button>
          )}

          {cleanup?.enabled && (
            <Button
              variant="ghost"
              size="icon"
              onClick={cleanup.toggle}
              aria-pressed={cleanup.active}
              aria-label="Remove text you don't want"
              title="Remove text you don't want (e)"
              className={cn(
                "text-muted-foreground hover:text-foreground",
                cleanup.active && "bg-accent text-accent-foreground",
              )}
            >
              <Eraser className="size-4" aria-hidden="true" />
            </Button>
          )}

          <Button
            ref={settingsButtonRef}
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-pressed={settingsOpen}
            aria-expanded={settingsOpen}
            aria-label="Reading settings"
            title="Reading settings: font, size, width, page colour (a)"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              settingsOpen && "bg-accent text-accent-foreground",
            )}
          >
            <ALargeSmall className="size-4" aria-hidden="true" />
          </Button>

          {highlights && (
            <Button
              variant="ghost"
              size="icon"
              onClick={highlights.togglePanel}
              aria-pressed={highlights.panelOpen}
              aria-label={`Highlights panel, ${highlights.highlights.length} highlights`}
              title="Highlights panel (Shift+H)"
              className={cn(
                "relative text-muted-foreground hover:text-foreground",
                highlights.panelOpen && "bg-accent text-accent-foreground",
              )}
            >
              <PanelRight className="size-4" aria-hidden="true" />
              {highlights.highlights.length > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold tabular-nums text-foreground border border-border shadow-raised">
                  {highlights.highlights.length}
                </span>
              )}
            </Button>
          )}

          {/* Copy Markdown */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopyMarkdown}
            disabled={!body}
            title="Copy Markdown"
            aria-label="Copy Markdown"
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="size-4 text-primary" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </Button>

          {/* Open original source in browser */}
          {targetUrl && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenSource}
              title="Open in browser (o)"
              aria-label="Open in browser"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
            </Button>
          )}

          {onToggleFocus && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleFocus}
              aria-pressed={focusMode}
              title={
                focusMode
                  ? "Leave focus (Shift+F or Esc)"
                  : "Focus: full screen, only the text (Shift+F)"
              }
              aria-label={focusMode ? "Leave focus" : "Focus"}
              className="text-muted-foreground hover:text-foreground"
            >
              {focusMode ? (
                <Minimize2 className="size-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </header>

      <ReaderSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsButtonRef}
      />

      {cleanup?.active && (
        <div
          data-reader-ui
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-2 font-sans select-none"
        >
          <p className="min-w-0 text-[13px] leading-5 text-muted-foreground">
            Select text to remove it, or use the trash button beside a paragraph. Highlights in
            removed text go with it.
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={cleanup.openEditor}>
              Edit as text
            </Button>
            <Button size="sm" onClick={() => cleanup.setActive(false)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* Reader Body / Scroll Area, with the highlights panel beside it */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {find?.barOpen && <FindBar find={find} />}
          {cleanup?.editing && (
            <ReaderTextEditor
              initial={cleanup.body}
              busy={cleanup.busy}
              onSave={(text) => void cleanup.saveEditor(text)}
              onCancel={cleanup.closeEditor}
            />
          )}
          {flow?.resumed && (
            <div
              data-reader-ui
              className="animate-pop-in absolute left-1/2 top-3 z-30 -translate-x-1/2 font-sans select-none"
            >
              <Button
                variant="outline"
                size="sm"
                onClick={flow.backToStart}
                className="bg-card shadow-float"
              >
                <ArrowUpToLine className="size-3.5" aria-hidden="true" />
                Back to the start
              </Button>
            </div>
          )}
          <div
            ref={scrollerRef}
            tabIndex={0}
            className="reader-scroll h-full w-full overflow-y-auto outline-none focus:ring-0 focus-visible:outline-none select-text"
          >
            <div
              className={cn(
                "reader-layout",
                fill && "is-fill",
                !focusMode && hasOutline && prefs.contents && "has-contents",
                !focusMode && hasNotes && "has-notes",
                prefs.paragraphs === "indented" && "reader-indented",
                prefs.align === "justify" && "reader-justify",
              )}
              style={prefsStyle(prefs)}
            >
              <aside ref={leftMarginRef} aria-label="Contents" className="reader-margin">
                {railShown && flow && <ContentsRail flow={flow} />}
              </aside>
              <article ref={articleRef} lang={lang} className="relative min-w-0">
                {/* Title block: source tile + source name + date in muted, then the title in Newsreader 40/46 weight 500 */}
                <header className="mb-8 border-b border-border pb-6 select-none">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground font-sans">
                    <SourceTile kind={item.kind} className="size-6 rounded-[6px] shrink-0" />
                    <span className="font-medium text-foreground">{kind.name}</span>
                    {savedDate && (
                      <>
                        <span>,</span>
                        <span>{savedDate}</span>
                      </>
                    )}
                    {header.author && (
                      <>
                        <span>,</span>
                        <span>{header.author}</span>
                      </>
                    )}
                    {readingTime && (
                      <>
                        <span>,</span>
                        <span>{readingTime}</span>
                      </>
                    )}
                  </div>

                  <h1 className="font-serif text-[40px] font-medium leading-[46px] tracking-[-0.02em] text-foreground">
                    {item.title}
                  </h1>

                  {header.subtitle && (
                    <p className="mt-3 font-serif text-lg italic leading-snug text-muted-foreground">
                      {header.subtitle}
                    </p>
                  )}

                  {targetUrl && (
                    <div className="mt-3 truncate text-xs text-muted-foreground font-sans">
                      <a
                        href={targetUrl}
                        onClick={(event) => {
                          event.preventDefault();
                          handleOpenSource();
                        }}
                        className="hover:underline hover:text-foreground"
                      >
                        {targetUrl}
                      </a>
                    </div>
                  )}

                  <TldrBox item={item} className="mt-6" />

                  {onUpdateResearch && (
                    <SourceInfoPanel
                      item={item}
                      projectId={projectId ?? null}
                      onUpdate={onUpdateResearch}
                      signals={researchSignals}
                      className="mt-6 border-t border-border pt-4"
                    />
                  )}
                </header>

                {/* Loading state: .skeleton lines shaped like a title and paragraphs */}
                {state.status === "loading" && (
                  <div
                    className="py-6 space-y-8 select-none"
                    aria-busy="true"
                    aria-label="Loading source"
                  >
                    <div className="space-y-3">
                      <div className="skeleton h-5 w-48" />
                      <div className="skeleton h-10 w-4/5" />
                      <div className="skeleton h-4 w-1/3" />
                    </div>
                    <div className="space-y-3">
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-5/6" />
                      <div className="skeleton h-4 w-3/4" />
                    </div>
                    <div className="space-y-3">
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-11/12" />
                      <div className="skeleton h-4 w-4/5" />
                    </div>
                    <div className="space-y-3">
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-full" />
                      <div className="skeleton h-4 w-2/3" />
                    </div>
                  </div>
                )}

                {/* Error state: EmptyState compact with the error and a Retry button */}
                {state.status === "error" && (
                  <div className="py-12 select-none">
                    <EmptyState
                      compact
                      icon={AlertCircle}
                      title="Couldn't load this source"
                      description={state.message}
                      actions={
                        <div className="flex items-center gap-2">
                          {onRetry && (
                            <Button variant="outline" size="sm" onClick={onRetry}>
                              Try again
                            </Button>
                          )}
                          {openInBrowserButton}
                        </div>
                      }
                    />
                  </div>
                )}

                {state.status === "ready" && (
                  <>
                    {bodyHtml ? (
                      <div
                        className="reader-prose"
                        ref={bodyRef}
                        onClick={(event) => {
                          if (highlights?.handleBodyClick(event)) return;
                          handleArticleClick(event);
                        }}
                        onAuxClick={handleContentClick}
                        dangerouslySetInnerHTML={{ __html: bodyHtml }}
                      />
                    ) : (
                      !noteHtml && (
                        <div className="py-12 select-none">
                          <EmptyState
                            compact
                            icon={FileText}
                            title="No saved text"
                            description={
                              targetUrl ? "Open the original page in your browser." : undefined
                            }
                            actions={openInBrowserButton}
                          />
                        </div>
                      )
                    )}

                    {noteHtml && (
                      <section
                        aria-label="My note"
                        className="mt-10 rounded-[10px] border border-border bg-muted/40 p-5 font-sans"
                      >
                        <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                          <StickyNote className="size-3.5" aria-hidden="true" />
                          <span>My note</span>
                        </div>
                        <div
                          ref={find?.noteRef}
                          className="reader-prose reader-note"
                          onClick={handleContentClick}
                          onAuxClick={handleContentClick}
                          dangerouslySetInnerHTML={{ __html: noteHtml }}
                        />
                      </section>
                    )}
                  </>
                )}

                {highlights?.menu && menuHighlight && (
                  <HighlightMenu
                    highlight={menuHighlight}
                    editing={highlights.menu.editing}
                    controller={highlights}
                    bodyRef={bodyRef ?? noBodyRef}
                    wrapperRef={articleRef}
                  />
                )}

                {cleanup && <ReaderCleanupLayer cleanup={cleanup} articleRef={articleRef} />}

                {state.status === "ready" && hasNotes && (
                  <FootnotePeek
                    bodyRef={bodyRef ?? noBodyRef}
                    wrapperRef={articleRef}
                    bodyHtml={bodyHtml}
                    sidenotesShown={sidenotesShown}
                    onClick={handleContentClick}
                  />
                )}
              </article>
              <aside ref={rightMarginRef} aria-label="Footnotes" className="reader-margin">
                {sidenotesShown && state.status === "ready" && (
                  <Sidenotes
                    bodyRef={bodyRef ?? noBodyRef}
                    bodyHtml={bodyHtml}
                    flashHref={flashHref}
                    onClick={handleContentClick}
                  />
                )}
              </aside>
            </div>
          </div>
        </div>

        {/* Highlights panel: slides in from right; overlays body on <900px */}
        <AnimatePresence>
          {highlights?.panelOpen && (
            <HighlightsPanel item={item} itemUrl={targetUrl} controller={highlights} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Floating find pill under the toolbar, right-aligned: input, "3 of 17", up/down, close.
 */
function FindBar({ find }: { find: ReaderFindController }) {
  const hasQuery = find.query.trim() !== "";
  const label = !hasQuery
    ? ""
    : find.count === 0
      ? "No matches"
      : `${find.position} of ${find.count}`;

  return (
    <div
      data-reader-ui
      role="search"
      className="animate-pop-in absolute right-6 top-3 z-30 flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3.5 pr-1.5 shadow-float font-sans select-none"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={find.inputRef}
        value={find.query}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) find.previous();
            else find.next();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            find.closeBar();
          }
        }}
        placeholder="Find in this source"
        aria-label="Find in this source"
        spellCheck={false}
        className="h-7 w-48 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {label && (
        <span
          aria-live="polite"
          className="min-w-[4rem] text-right text-[12.5px] tabular-nums text-muted-foreground"
        >
          {label}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={find.previous}
        disabled={find.count === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronUp className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={find.next}
        disabled={find.count === 0}
        title="Next match (Enter)"
        aria-label="Next match"
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={find.closeBar}
        title="Close find (Esc)"
        aria-label="Close find"
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
