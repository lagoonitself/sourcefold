import * as React from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquareText,
  Newspaper,
  StickyNote,
} from "lucide-react";

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

// Same kinds, colors and icons as the web app's item rows (see docs/DESIGN.md, "Source-type marks").
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
  // No color of its own in docs/DESIGN.md yet, so it uses the neutral secondary-text color.
  wikipedia: {
    name: "Wikipedia",
    barClass: "bg-muted-foreground",
    colorVar: "var(--muted-foreground)",
    Icon: Globe,
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
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
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
    case "unavailable":
      return (
        <span
          className="flex size-4 shrink-0 items-center justify-center text-warning"
          role="img"
          aria-label="Paid post, not saved"
          title="Paid post, not saved"
        >
          <Lock className="size-4" aria-hidden="true" />
        </span>
      );
    default:
      return null;
  }
}
