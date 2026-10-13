"use client";

import React, { useState } from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  MessageSquareText,
  Newspaper,
  StickyNote,
} from "lucide-react";
import type { ItemListRow } from "./item-columns";
import { ItemMenu } from "./item-menu";
import { cn } from "@/lib/utils";

export interface ItemRowProps {
  item: ItemListRow;
  subtitle?: string;
}

interface KindConfig {
  name: string;
  barClass: string;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

const KIND_CONFIG: Record<string, KindConfig> = {
  grokipedia: {
    name: "Grokipedia",
    barClass: "bg-source-grokipedia",
    Icon: BookOpen,
  },
  substack: {
    name: "Substack",
    barClass: "bg-source-substack",
    Icon: Newspaper,
  },
  x: {
    name: "X",
    barClass: "bg-source-x",
    Icon: MessageSquareText,
  },
  note: {
    name: "Note",
    barClass: "bg-source-note",
    Icon: StickyNote,
  },
  image: {
    name: "Image",
    barClass: "bg-source-image",
    Icon: ImageIcon,
  },
};

const DEFAULT_KIND_CONFIG: KindConfig = {
  name: "Source",
  barClass: "bg-muted-foreground",
  Icon: BookOpen,
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    return dateFormatter.format(new Date(dateStr));
  } catch {
    return "";
  }
}

function renderStatusIcon(status: string, error: string | null) {
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

export function ItemRow({ item, subtitle }: ItemRowProps) {
  const [noteOpen, setNoteOpen] = useState(false);

  const kindConfig = KIND_CONFIG[item.kind] ?? DEFAULT_KIND_CONFIG;
  const KindIcon = kindConfig.Icon;

  let author: string | null = null;
  if (
    (item.kind === "substack" || item.kind === "x") &&
    item.meta &&
    typeof item.meta === "object" &&
    !Array.isArray(item.meta)
  ) {
    const metaObj = item.meta as Record<string, unknown>;
    if (typeof metaObj.author === "string" && metaObj.author.trim().length > 0) {
      author = metaObj.author;
    }
  }

  const formattedDate = formatDate(item.created_at);
  const statusIcon = renderStatusIcon(item.status, item.error);
  const hasNote = Boolean(item.kind !== "note" && item.note && item.note.trim().length > 0);

  const content = (
    <>
      <span
        className={cn("w-[3px] shrink-0 self-stretch", kindConfig.barClass)}
        aria-hidden="true"
      />
      <div className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 pl-3 pr-2 py-2">
        <KindIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-serif text-[15px] font-medium leading-[22px] text-foreground">
              {item.title}
            </span>
            {hasNote && (
              <span
                role="img"
                aria-label="Has a note"
                title="Has a note"
                className="inline-flex shrink-0 self-center text-muted-foreground"
              >
                <MessageSquare className="size-3.5" aria-hidden="true" />
              </span>
            )}
            {author && (
              <span className="shrink-0 font-sans text-[13px] font-normal leading-[18px] text-muted-foreground">
                {author}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="truncate font-sans text-[13px] leading-[18px] text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        <div className="w-24 shrink-0 text-right font-sans text-[13px] leading-[18px] text-muted-foreground">
          {kindConfig.name}
        </div>
        <div className="w-16 shrink-0 text-right font-sans text-[13px] leading-[18px] text-muted-foreground tabular-nums">
          {formattedDate}
        </div>
        <div className="flex w-5 shrink-0 items-center justify-end">{statusIcon}</div>
      </div>
    </>
  );

  const interactiveClasses =
    "flex min-w-0 flex-1 items-stretch focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div
      role="listitem"
      className="group flex min-h-[48px] w-full items-stretch transition-colors hover:bg-muted"
    >
      {item.source_url ? (
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className={interactiveClasses}
        >
          {content}
        </a>
      ) : item.kind === "note" ? (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className={cn(interactiveClasses, "text-left cursor-pointer")}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-stretch">{content}</div>
      )}

      <div className="flex items-center pr-2">
        <ItemMenu item={item} noteOpen={noteOpen} onNoteOpenChange={setNoteOpen} />
      </div>
    </div>
  );
}
