import React from "react";
import {
  BookOpen,
  ChevronsUp,
  Cloud,
  FileText,
  Globe,
  MessageSquareText,
  MessagesSquare,
  MonitorPlay,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import type { PageKind } from "../../lib/page-kind";

const ICONS: Record<PageKind, LucideIcon> = {
  grokipedia: BookOpen,
  substack: Newspaper,
  x: MessageSquareText,
  youtube: MonitorPlay,
  web: Globe,
  reddit: MessagesSquare,
  pdf: FileText,
  hackernews: ChevronsUp,
  bluesky: Cloud,
};

/** The CSS color token for a source type (see "Source-type marks" in docs/dev/DESIGN.md). */
export function sourceColor(kind: PageKind | null): string {
  return kind ? `var(--source-${kind})` : "var(--border)";
}

export function SourceIcon({ kind, size = 14 }: { kind: PageKind | null; size?: number }) {
  const Icon = kind ? ICONS[kind] : Globe;
  return (
    <Icon size={size} strokeWidth={2} aria-hidden="true" style={{ color: sourceColor(kind) }} />
  );
}
