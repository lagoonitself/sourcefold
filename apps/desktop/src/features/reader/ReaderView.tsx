import * as React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Highlighter,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRight,
  StickyNote,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { getSourceKind } from "@/features/items/source-kinds";
import { openUrl, cn } from "@/lib/utils";
import { HighlightMenu } from "./HighlightMenu";
import { HighlightsPanel } from "./HighlightsPanel";
import { buildReaderHeader, calculateReadingTime } from "./reader-meta";
import { useReaderContent } from "./use-reader-content";
import type { ReaderTypography, ReaderViewProps } from "./types";
import "./reader.css";

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

function StatusMessage({
  icon,
  title,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground font-sans">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {detail && <p className="mt-1 max-w-sm text-[13px] leading-[18px]">{detail}</p>}
      {children && <div className="mt-4 flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function ReaderView({
  item,
  state,
  onRetry,
  onClose,
  className,
  scrollRef,
  initialTypography = "serif",
  content,
  highlights,
  bodyRef,
}: ReaderViewProps) {
  const articleRef = React.useRef<HTMLElement | null>(null);
  const [typography, setTypography] = React.useState<ReaderTypography>(() => {
    try {
      const saved = localStorage.getItem("sourcefold:reader:typography");
      if (saved === "sans" || saved === "serif") return saved;
    } catch {}
    return initialTypography;
  });

  const [copied, setCopied] = React.useState(false);
  const [isFullscreen, setIsFullscreen] = React.useState(false);

  const handleTypographyChange = (next: ReaderTypography) => {
    setTypography(next);
    try {
      localStorage.setItem("sourcefold:reader:typography", next);
    } catch {}
  };

  const kind = getSourceKind(item.kind);
  const KindIcon = kind.Icon;

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
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      toast.success("Markdown copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy markdown");
    }
  };

  const handleOpenSource = () => {
    if (targetUrl) {
      void openUrl(targetUrl);
    }
  };

  const openInBrowserButton = targetUrl ? (
    <Button variant="outline" size="sm" onClick={handleOpenSource}>
      <ExternalLink className="size-3.5" aria-hidden="true" />
      <span>Open in browser</span>
    </Button>
  ) : null;

  const metaParts = [
    header.author,
    header.publication,
    header.dateLabel,
    header.domain,
    readingTime,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className={cn("flex h-full w-full flex-col bg-background text-foreground", className)}>
      {/* Sticky Reader Toolbar */}
      <header
        data-reader-ui
        className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80 select-none"
      >
        <div className="flex items-center gap-2 overflow-hidden mr-4">
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-2 py-0.5 text-xs font-medium"
            style={{
              color: kind.colorVar,
              backgroundColor: `color-mix(in srgb, ${kind.colorVar} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${kind.colorVar} 30%, transparent)`,
            }}
          >
            <KindIcon className="size-3" aria-hidden="true" />
            <span>{kind.name}</span>
          </span>

          <span className="truncate text-xs font-medium text-muted-foreground" title={item.title}>
            {item.title}
          </span>

          {highlights?.position && highlights.position.total > 1 && (
            <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
              {highlights.position.index} of {highlights.position.total}
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {highlights?.position && highlights.position.total > 1 && (
            <div className="mr-1 flex items-center">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => highlights.navigate(-1)}
                disabled={highlights.position.index <= 1}
                title="Previous source ([)"
                aria-label="Previous source"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => highlights.navigate(1)}
                disabled={highlights.position.index >= highlights.position.total}
                title="Next source (])"
                aria-label="Next source"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}

          {highlights && (
            <>
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
                className={cn(highlights.autoHighlight && "bg-accent text-accent-foreground")}
              >
                <Highlighter className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={highlights.togglePanel}
                aria-pressed={highlights.panelOpen}
                aria-label={`Highlights panel, ${highlights.highlights.length} highlights`}
                title="Highlights panel (Shift+H)"
                className={cn(
                  "mr-1 h-8 gap-1.5 px-2 text-xs",
                  highlights.panelOpen && "bg-accent text-accent-foreground",
                )}
              >
                <PanelRight className="size-3.5" aria-hidden="true" />
                <span className="tabular-nums">{highlights.highlights.length}</span>
              </Button>
            </>
          )}

          {/* Typography toggle */}
          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 mr-2">
            <button
              type="button"
              onClick={() => handleTypographyChange("serif")}
              title="Serif font"
              className={cn(
                "rounded px-2 py-1 font-serif text-xs font-semibold transition-colors cursor-pointer",
                typography === "serif"
                  ? "bg-background text-foreground shadow-xs"
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
                "rounded px-2 py-1 font-sans text-xs font-semibold transition-colors cursor-pointer",
                typography === "sans"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Sans
            </button>
          </div>

          {/* Copy markdown (the body, without the front matter) */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyMarkdown}
            disabled={!body}
            className="h-8 gap-1.5 px-2 text-xs"
            title="Copy Markdown"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-primary" />
                <span className="hidden sm:inline text-primary">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span className="hidden sm:inline">Copy markdown</span>
              </>
            )}
          </Button>

          {/* Open original source in browser */}
          {targetUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenSource}
              className="h-8 gap-1.5 px-2 text-xs"
              title="Open in browser (o)"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Open in browser</span>
              <kbd className="hidden lg:inline text-[9px] opacity-60">o</kbd>
            </Button>
          )}

          {/* Fullscreen toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="h-8 px-2 text-xs"
            title={isFullscreen ? "Exit full width" : "Full width"}
            aria-label={isFullscreen ? "Exit full width" : "Full width"}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>

          {/* Close button */}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 px-2 text-xs ml-1"
              title="Close reader (Esc)"
              aria-label="Close reader"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Reader Body / Scroll Area, with the highlights panel beside it */}
      <div className="flex min-h-0 flex-1">
        <div
          ref={scrollRef}
          tabIndex={0}
          className="min-w-0 flex-1 overflow-y-auto px-6 py-10 outline-none focus:ring-0 focus-visible:outline-none"
        >
          <article
            ref={articleRef}
            className={cn(
              "relative mx-auto transition-all",
              isFullscreen ? "max-w-4xl" : "max-w-[700px]",
              typography === "serif" ? "font-serif" : "font-sans",
            )}
          >
            {/* Article Header Metadata */}
            <header className="mb-8 border-b border-border/60 pb-6">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl leading-tight">
                {item.title}
              </h1>

              {header.subtitle && (
                <p className="mt-3 text-lg italic leading-snug text-muted-foreground">
                  {header.subtitle}
                </p>
              )}

              {metaParts.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-y-1.5 gap-x-2 text-[13px] text-muted-foreground font-sans">
                  {metaParts.map((part, index) => (
                    <React.Fragment key={`${index}-${part}`}>
                      {index > 0 && <span aria-hidden="true">·</span>}
                      <span
                        className={index === 0 && part === header.author ? "text-foreground" : ""}
                      >
                        {part}
                      </span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {targetUrl && (
                <div className="mt-2 text-xs text-muted-foreground truncate font-sans">
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

            {state.status === "loading" && (
              <StatusMessage
                icon={
                  <Loader2
                    className="mb-3 size-8 stroke-[1.4] opacity-60 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                }
                title="Loading"
              />
            )}

            {state.status === "error" && (
              <StatusMessage
                icon={
                  <FileText className="mb-3 size-10 stroke-[1.2] opacity-40" aria-hidden="true" />
                }
                title="Couldn't load this source"
                detail={state.message}
              >
                {onRetry && (
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    Try again
                  </Button>
                )}
                {openInBrowserButton}
              </StatusMessage>
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
                    <StatusMessage
                      icon={
                        <FileText
                          className="mb-3 size-10 stroke-[1.2] opacity-40"
                          aria-hidden="true"
                        />
                      }
                      title="No saved text"
                      detail={targetUrl ? "Open the original page in your browser." : undefined}
                    >
                      {openInBrowserButton}
                    </StatusMessage>
                  )
                )}

                {noteHtml && (
                  <section
                    aria-label="My note"
                    className="mt-10 rounded-[6px] border border-border bg-muted/40 p-5 font-sans"
                  >
                    <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                      <StickyNote className="size-3.5" aria-hidden="true" />
                      <span>My note</span>
                    </div>
                    <div
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

        {highlights?.panelOpen && (
          <HighlightsPanel item={item} itemUrl={targetUrl} controller={highlights} />
        )}
      </div>
    </div>
  );
}
