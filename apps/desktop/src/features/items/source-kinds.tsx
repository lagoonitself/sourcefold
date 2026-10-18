import * as React from "react";
import {
  BookOpen,
  Check,
  ChevronsUp,
  CircleAlert,
  Cloud,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquareText,
  MessagesSquare,
  MonitorPlay,
  Newspaper,
  StickyNote,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

export interface SourceKindConfig {
  /** Name shown on the right of a row ("Grokipedia"). */
  name: string;
  /** Background class for the 3px bar on the row's left edge. */
  barClass: string;
  /** The source color as a CSS value, for places that cannot use the class (the reader badge). */
  colorVar: string;
  Icon: IconComponent;
}

// Same kinds, colors and icons as the web app's item rows (see docs/dev/DESIGN.md, "Source-type marks").
// `barClass` is the web app's 3px bar; the desktop app shows the kind as a `SourceTile` instead.
const SOURCE_KINDS: Record<string, SourceKindConfig> = {
  grokipedia: {
    name: "Grokipedia",
    barClass: "bg-source-grokipedia",
    colorVar: "var(--source-grokipedia)",
    Icon: BookOpen,
  },
  substack: {
    name: "Substack",
    barClass: "bg-source-substack",
    colorVar: "var(--source-substack)",
    Icon: Newspaper,
  },
  x: {
    name: "X",
    barClass: "bg-source-x",
    colorVar: "var(--source-x)",
    Icon: MessageSquareText,
  },
  note: {
    name: "Note",
    barClass: "bg-source-note",
    colorVar: "var(--source-note)",
    Icon: StickyNote,
  },
  image: {
    name: "Image",
    barClass: "bg-source-image",
    colorVar: "var(--source-image)",
    Icon: ImageIcon,
  },
  wikipedia: {
    name: "Wikipedia",
    barClass: "bg-source-wikipedia",
    colorVar: "var(--source-wikipedia)",
    Icon: Globe,
  },
  youtube: {
    name: "YouTube",
    barClass: "bg-source-youtube",
    colorVar: "var(--source-youtube)",
    Icon: MonitorPlay,
  },
  web: {
    name: "Web page",
    barClass: "bg-source-web",
    colorVar: "var(--source-web)",
    Icon: Globe,
  },
  reddit: {
    name: "Reddit",
    barClass: "bg-source-reddit",
    colorVar: "var(--source-reddit)",
    Icon: MessagesSquare,
  },
  pdf: {
    name: "PDF",
    barClass: "bg-source-pdf",
    colorVar: "var(--source-pdf)",
    Icon: FileText,
  },
  hackernews: {
    name: "Hacker News",
    barClass: "bg-source-hackernews",
    colorVar: "var(--source-hackernews)",
    Icon: ChevronsUp,
  },
  bluesky: {
    name: "Bluesky",
    barClass: "bg-source-bluesky",
    colorVar: "var(--source-bluesky)",
    Icon: Cloud,
  },
};

const FALLBACK_KIND: SourceKindConfig = {
  name: "Source",
  barClass: "bg-muted-foreground",
  colorVar: "var(--muted-foreground)",
  Icon: BookOpen,
};

export function getSourceKind(kind: string): SourceKindConfig {
  return SOURCE_KINDS[kind] ?? FALLBACK_KIND;
}

/**
 * The source type as a tile: a rounded square tinted with the source color at 12%, with its icon in
 * the source color. 32px by default; pass a size class (`size-7`) to change it. Always show the
 * source name in text somewhere next to it.
 */
export function SourceTile({
  kind,
  className,
}: {
  kind: string | SourceKindConfig;
  className?: string;
}) {
  const config = typeof kind === "string" ? getSourceKind(kind) : kind;
  const Icon = config.Icon;
  return (
    <span
      aria-hidden="true"
      className={cn("flex size-8 shrink-0 items-center justify-center rounded-[8px]", className)}
      style={{
        color: config.colorVar,
        backgroundColor: `color-mix(in oklab, ${config.colorVar} 12%, transparent)`,
      }}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}

function metaText(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// What each extractor stores in `item.meta` (see the capture code in src-tauri/src/service.rs),
// in the order the second line of a row prefers it.
const META_LINE_FIELDS: Record<string, Array<(meta: Record<string, unknown>) => string | null>> = {
  youtube: [(m) => metaText(m, "channel"), (m) => metaText(m, "duration")],
  web: [(m) => metaText(m, "site"), (m) => metaText(m, "author")],
  reddit: [
    (m) => {
      const subreddit = metaText(m, "subreddit");
      return subreddit && (subreddit.startsWith("r/") ? subreddit : `r/${subreddit}`);
    },
    (m) => metaText(m, "author"),
  ],
  pdf: [
    (m) => metaText(m, "author"),
    (m) => {
      const pages = metaText(m, "pages");
      return pages && `${pages} ${pages === "1" ? "page" : "pages"}`;
    },
  ],
  hackernews: [
    (m) => metaText(m, "author"),
    (m) => {
      const points = metaText(m, "points");
      return points && `${points} ${points === "1" ? "point" : "points"}`;
    },
  ],
  bluesky: [(m) => metaText(m, "author")],
  substack: [(m) => metaText(m, "author"), (m) => metaText(m, "publication")],
  x: [(m) => metaText(m, "author")],
};

/** Author, channel, site or duration for the second line of a row; null when the source has none. */
export function getSourceMetaLine(
  kind: string,
  meta: Record<string, unknown> | null | undefined,
): string | null {
  const readers = META_LINE_FIELDS[kind];
  if (!readers || !meta || typeof meta !== "object") return null;
  const parts = readers
    .map((read) => read(meta))
    .filter((part): part is string => Boolean(part))
    .slice(0, 2);
  return parts.length > 0 ? parts.join(", ") : null;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** "Oct 15"; empty when the date is missing or invalid. */
export function formatSavedDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

export function StatusIcon({ status, error }: { status: string; error?: string | null }) {
  switch (status) {
    case "saved":
      return (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-success"
          role="img"
          aria-label="Saved"
          title="Saved"
        >
          <Check className="size-4" aria-hidden="true" />
        </span>
      );
    case "pending":
      return (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          role="img"
          aria-label="Saving"
          title="Saving"
        >
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        </span>
      );
    case "failed": {
      const label = error ? `Failed: ${error}` : "Failed";
      return (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-destructive"
          role="img"
          aria-label={label}
          title={label}
        >
          <CircleAlert className="size-4" aria-hidden="true" />
        </span>
      );
    }
    case "unavailable": {
      // The reason is saved with the item ("No captions on this video"); paid Substack posts have none.
      const label = error || "Paid post, not saved";
      return (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-warning"
          role="img"
          aria-label={label}
          title={label}
        >
          <Lock className="size-4" aria-hidden="true" />
        </span>
      );
    }
    default:
      return null;
  }
}
