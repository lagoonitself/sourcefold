import * as React from "react";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Maximize2,
  Minimize2,
  StickyNote,
  X,
} from "lucide-react";
import { marked } from "marked";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { openUrl, cn } from "@/lib/utils";
import type { ReaderItem, ReaderTypography, ReaderViewProps } from "./types";

interface KindConfig {
  name: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const KIND_CONFIGS: Record<string, KindConfig> = {
  article: {
    name: "Article",
    badgeBg: "rgba(37, 99, 235, 0.12)",
    badgeText: "#2563EB",
    badgeBorder: "rgba(37, 99, 235, 0.28)",
    Icon: BookOpen,
  },
  grokipedia: {
    name: "Grokipedia",
    badgeBg: "rgba(22, 163, 74, 0.12)",
    badgeText: "#16A34A",
    badgeBorder: "rgba(22, 163, 74, 0.28)",
    Icon: Globe,
  },
  x_thread: {
    name: "X Thread",
    badgeBg: "rgba(0, 0, 0, 0.08)",
    badgeText: "#0F1419",
    badgeBorder: "rgba(0, 0, 0, 0.22)",
    Icon: FileText,
  },
  x_post: {
    name: "X Post",
    badgeBg: "rgba(0, 0, 0, 0.08)",
    badgeText: "#0F1419",
    badgeBorder: "rgba(0, 0, 0, 0.22)",
    Icon: FileText,
  },
  note: {
    name: "Note",
    badgeBg: "rgba(245, 158, 11, 0.12)",
    badgeText: "#F59E0B",
    badgeBorder: "rgba(245, 158, 11, 0.28)",
    Icon: StickyNote,
  },
};

const DEFAULT_KIND_CONFIG: KindConfig = {
  name: "Source",
  badgeBg: "rgba(91, 102, 118, 0.12)",
  badgeText: "var(--muted-foreground)",
  badgeBorder: "rgba(91, 102, 118, 0.28)",
  Icon: BookOpen,
};

export function getReaderAuthor(item: ReaderItem): string | null {
  if (item.author) return item.author;
  if (item.meta && typeof item.meta === "object") {
    if (typeof item.meta.author === "string" && item.meta.author.trim()) {
      return item.meta.author.trim();
    }
    if (typeof item.meta.byline === "string" && item.meta.byline.trim()) {
      return item.meta.byline.trim();
    }
    if (typeof item.meta.author_name === "string" && item.meta.author_name.trim()) {
      return item.meta.author_name.trim();
    }
    if (typeof item.meta.handle === "string" && item.meta.handle.trim()) {
      const handle = item.meta.handle.trim();
      return handle.startsWith("@") ? handle : `@${handle}`;
    }
  }
  return null;
}

function getDomain(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function formatDate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return null;
  }
}

function calculateReadingTime(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

export function ReaderView({
  item,
  onClose,
  className,
  scrollRef,
  initialTypography = "serif",
}: ReaderViewProps) {
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

  const kindConfig = KIND_CONFIGS[item.kind] || DEFAULT_KIND_CONFIG;
  const KindIcon = kindConfig.Icon;
  const author = getReaderAuthor(item);
  const targetUrl = item.source_url || item.canonical_url;
  const domain = getDomain(targetUrl);
  const formattedDate = formatDate(item.created_at);

  const rawMarkdown = item.markdown || item.note || "";
  const readingTime = rawMarkdown ? calculateReadingTime(rawMarkdown) : null;

  // Render markdown to HTML safely using marked
  const renderedHtml = React.useMemo(() => {
    if (!rawMarkdown.trim()) return "";
    try {
      return marked.parse(rawMarkdown, {
        gfm: true,
        breaks: true,
        async: false,
      }) as string;
    } catch {
      return `<p>${rawMarkdown}</p>`;
    }
  }, [rawMarkdown]);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(rawMarkdown);
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

  return (
    <div className={cn("flex h-full w-full flex-col bg-background text-foreground", className)}>
      {/* Sticky Reader Toolbar */}
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80 select-none">
        <div className="flex items-center gap-2 overflow-hidden mr-4">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              backgroundColor: kindConfig.badgeBg,
              color: kindConfig.badgeText,
              border: `1px solid ${kindConfig.badgeBorder}`,
            }}
          >
            <KindIcon className="size-3" />
            <span>{kindConfig.name}</span>
          </span>

          <span className="truncate text-xs font-medium text-muted-foreground" title={item.title}>
            {item.title}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Typography toggle */}
          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 mr-2">
            <button
              type="button"
              onClick={() => handleTypographyChange("serif")}
              title="Serif font (Elena / Georgia)"
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
              title="Sans-serif font (Inter / System)"
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

          {/* Copy markdown */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyMarkdown}
            className="h-8 gap-1.5 px-2 text-xs"
            title="Copy Markdown"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-600" />
                <span className="hidden sm:inline text-emerald-600">Copied</span>
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
              title="Open source in browser (o)"
            >
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">Open source</span>
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
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Reader Body / Scroll Area */}
      <div
        ref={scrollRef}
        tabIndex={0}
        className="flex-1 overflow-y-auto px-6 py-10 outline-none focus:ring-0 focus-visible:outline-none"
      >
        <article
          className={cn(
            "mx-auto transition-all",
            isFullscreen ? "max-w-4xl" : "max-w-[700px]",
            typography === "serif" ? "font-serif" : "font-sans",
          )}
        >
          {/* Article Header Metadata */}
          <header className="mb-8 border-b border-border/60 pb-6">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl leading-tight">
              {item.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-y-1.5 gap-x-3 text-xs text-muted-foreground font-sans">
              {author && <span className="font-medium text-foreground">{author}</span>}

              {domain && (
                <>
                  {author && <span>·</span>}
                  <span>{domain}</span>
                </>
              )}

              {formattedDate && (
                <>
                  <span>·</span>
                  <span>{formattedDate}</span>
                </>
              )}

              {readingTime && (
                <>
                  <span>·</span>
                  <span>{readingTime}</span>
                </>
              )}
            </div>

            {targetUrl && (
              <div className="mt-2 font-mono text-[11px] text-muted-foreground truncate">
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline hover:text-foreground"
                >
                  {targetUrl}
                </a>
              </div>
            )}
          </header>

          {/* Note section (if attached personal note exists on a captured article) */}
          {item.note && item.kind !== "note" && (
            <aside className="mb-8 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 font-sans text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                <StickyNote className="size-3.5" />
                <span>Personal note</span>
              </div>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">{item.note}</p>
            </aside>
          )}

          {/* Rendered Content */}
          {renderedHtml ? (
            <div
              className={cn(
                "prose prose-neutral dark:prose-invert max-w-none",
                "prose-headings:tracking-tight prose-headings:font-bold prose-headings:text-foreground",
                "prose-p:leading-relaxed prose-p:text-foreground/90",
                "prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80",
                "prose-blockquote:border-l-primary/60 prose-blockquote:font-normal prose-blockquote:italic",
                "prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none",
                "prose-pre:rounded-lg prose-pre:bg-muted/80 prose-pre:border prose-pre:border-border",
                "prose-img:rounded-lg prose-img:shadow-sm",
                typography === "serif"
                  ? "text-[17px] leading-[1.75]"
                  : "text-[15px] leading-[1.65]",
              )}
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground font-sans">
              <FileText className="size-12 stroke-[1.2] mb-3 opacity-40" />
              <p className="text-sm font-medium">No markdown content available</p>
              {targetUrl && (
                <p className="mt-1 text-xs">View the original source directly in your browser.</p>
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
