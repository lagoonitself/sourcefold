import * as React from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  Highlighter,
  Maximize2,
  Minimize2,
  PanelRight,
  Search,
  StickyNote,
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
import { buildReaderHeader, calculateReadingTime } from "./reader-meta";
import { useReaderContent } from "./use-reader-content";
import "./reader.css";
import type { ReaderFindController, ReaderTypography, ReaderViewProps } from "./types";

export { getReaderAuthor } from "./reader-meta";

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
  initialTypography = "serif",
  content,
  highlights,
  bodyRef,
  find,
}: ReaderViewProps) {
  const [typography, setTypography] = React.useState<ReaderTypography>(() => {
    try {
      const saved = localStorage.getItem("sourcefold:reader:typography");
      if (saved === "sans" || saved === "serif") return saved;
    } catch {}
    return initialTypography;
  });

  const handleTypographyChange = (next: ReaderTypography) => {
    setTypography(next);
    try {
      localStorage.setItem("sourcefold:reader:typography", next);
    } catch {}
  };

  const [copied, setCopied] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

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
        "@container/reader flex h-full w-full flex-col bg-background text-foreground select-none",
        className,
      )}
    >
      {/*
        Toolbar (52px, drag region on macOS: data-tauri-drag-region, and 78px left padding
        under .platform-mac since the traffic lights sit there): close (X, Esc), the source
        tile and source name, "3 of 24" with prev/next buttons ([/]), then right: find,
        highlighter toggle, typography, panel toggle, Open original.
      */}
      <header
        data-reader-ui
        data-tauri-drag-region
        className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 select-none [.platform-mac_&]:pl-[78px]"
      >
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

        {/* Right: find, highlighter toggle, typography, panel toggle, copy markdown, open original, full width */}
        <div className="flex items-center gap-1 shrink-0">
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

          {/* Typography toggle */}
          <div className="flex items-center rounded-[8px] border border-border bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => handleTypographyChange("serif")}
              title="Serif font"
              className={cn(
                "rounded-[6px] px-2 py-0.5 font-serif text-xs font-medium transition-colors cursor-pointer",
                typography === "serif"
                  ? "bg-background text-foreground shadow-raised"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Serif
            </button>
            <button
              type="button"
              onClick={() => handleTypographyChange("sans")}
              title="Sans-serif font"
              className={cn(
                "rounded-[6px] px-2 py-0.5 font-sans text-xs font-medium transition-colors cursor-pointer",
                typography === "sans"
                  ? "bg-background text-foreground shadow-raised"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sans
            </button>
          </div>

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

          {/* Full width toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsFullscreen((prev) => !prev)}
            title={isFullscreen ? "Exit full width" : "Full width"}
            aria-label={isFullscreen ? "Exit full width" : "Full width"}
            className="text-muted-foreground hover:text-foreground"
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Reader Body / Scroll Area, with the highlights panel beside it */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-w-0 flex-1">
          {find?.barOpen && <FindBar find={find} />}
          <div
            ref={scrollRef}
            tabIndex={0}
            className="h-full w-full overflow-y-auto px-6 py-10 outline-none focus:ring-0 focus-visible:outline-none select-text"
          >
            <article
              ref={articleRef}
              className={cn(
                "relative mx-auto transition-all",
                isFullscreen ? "max-w-4xl" : "max-w-[66ch]",
                typography === "serif" ? "font-serif" : "font-sans",
              )}
            >
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
                      className={cn(
                        "reader-prose",
                        typography === "serif" ? "reader-prose-serif" : "reader-prose-sans",
                      )}
                      ref={bodyRef}
                      onClick={(event) => {
                        if (highlights?.handleBodyClick(event)) return;
                        handleContentClick(event);
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
                        className="reader-prose reader-prose-sans reader-note"
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
            </article>
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
