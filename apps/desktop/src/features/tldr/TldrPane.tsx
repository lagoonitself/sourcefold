import * as React from "react";
import { BookOpen, CircleAlert, Loader2, RotateCw, Sparkles, X } from "lucide-react";
import { TRIAGE_VALUES, TRIAGE_LABELS, type ItemTldr } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import type { Item } from "@/lib/types";
import { cn, openUrl } from "@/lib/utils";
import { dispatchGroupAction } from "../items/group-actions";
import { getSourceKind, getSourceMetaLine } from "../items/source-kinds";
import { TRIAGE_META } from "../research/source-info/triage";
import { opensInReader } from "../reader/open-decision";
import { canHaveTldr } from "./tldr-engine";
import { CHATGPT_USAGE_URL } from "./tldr-api";
import { openSettings } from "./tldr-settings-link";
import { tldrEngine, useAiStatus, useTldr, useTldrPause } from "./tldr-store";

/** Where a TL;DR came from, in a few muted words. */
export function tldrOrigin(tldr: ItemTldr): string {
  if (tldr.source === "article") return "From the article";
  return tldr.model ? `Written by ${tldr.model}` : "Written by AI";
}

/** The TL;DR itself: gist, key points, best part and where it came from. */
export function TldrBody({ tldr, compact = false }: { tldr: ItemTldr; compact?: boolean }) {
  const { gist, points, best_part } = tldr.tldr;
  return (
    <div className="flex flex-col gap-3">
      <p
        className={cn(
          "font-serif font-normal text-foreground",
          compact ? "text-[16px] leading-[24px]" : "text-[17px] leading-[25px]",
        )}
      >
        {gist}
      </p>
      {points.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {points.map((point, i) => (
            <li
              key={i}
              className="relative pl-3.5 font-sans text-[13.5px] leading-[20px] text-foreground before:absolute before:left-0 before:top-[8px] before:size-1 before:rounded-full before:bg-muted-foreground"
            >
              {point}
            </li>
          ))}
        </ul>
      )}
      {best_part && (
        <p className="font-sans text-[13px] leading-[19px] text-foreground">
          <span className="font-medium">Best part: </span>
          <span className="text-muted-foreground">{best_part}</span>
        </p>
      )}
      <p className="font-sans text-[12px] leading-[16px] text-muted-foreground">
        {tldrOrigin(tldr)}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-label="Writing the TL;DR">
      <div className="skeleton h-4 w-full rounded-[5px]" />
      <div className="skeleton h-4 w-[85%] rounded-[5px]" />
      <div className="skeleton mt-2 h-3 w-[92%] rounded-[5px]" />
      <div className="skeleton h-3 w-[70%] rounded-[5px]" />
      <div className="skeleton h-3 w-[78%] rounded-[5px]" />
    </div>
  );
}

/** The pause banner: a usage limit, a sign-in problem, or no model set up. */
export function TldrPauseNotice() {
  const pause = useTldrPause();
  const ai = useAiStatus();
  if (!pause) return null;
  const isChatgptLimit = pause.code === "limit" && ai?.provider === "chatgpt";
  const needsSettings = pause.code !== "limit";
  return (
    <div className="flex flex-col gap-2 rounded-[10px] bg-muted px-3 py-2.5">
      <div className="flex items-start gap-2 font-sans text-[12.5px] leading-[18px] text-foreground">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span>{pause.message}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-5">
        {isChatgptLimit && (
          <Button variant="outline" size="sm" onClick={() => void openUrl(CHATGPT_USAGE_URL)}>
            Check usage
          </Button>
        )}
        {needsSettings && (
          <Button variant="outline" size="sm" onClick={() => openSettings("tldr")}>
            Open settings
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => tldrEngine.resume()}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** What the pane or the reader box shows for one source. */
export function TldrContent({
  item,
  compact = false,
}: {
  item: Pick<Item, "id" | "kind" | "status" | "created_at" | "title" | "folder_id" | "meta">;
  compact?: boolean;
}) {
  const { tldr, state } = useTldr(item.id);
  const ai = useAiStatus();
  const write = () => tldrEngine.enqueue([item as Item], "manual", true);

  if (!canHaveTldr(item)) {
    return (
      <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">
        {item.kind === "note" || item.kind === "image"
          ? "Notes and images don't get a TL;DR."
          : "This source wasn't saved, so it has no text to summarize."}
      </p>
    );
  }
  if (!tldr && (state?.status === "writing" || state?.status === "queued")) {
    return state.status === "writing" ? (
      <Skeleton />
    ) : (
      <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">
        Waiting to write this TL;DR…
      </p>
    );
  }
  if (tldr) {
    return (
      <div className="flex flex-col gap-3">
        <TldrBody tldr={tldr} compact={compact} />
        {state?.status === "writing" && (
          <span className="inline-flex items-center gap-1.5 font-sans text-[12px] text-muted-foreground">
            <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
            Rewriting…
          </span>
        )}
      </div>
    );
  }
  if (state?.status === "no_text") {
    return (
      <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">
        No text to summarize.
      </p>
    );
  }
  if (state?.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="font-sans text-[13px] leading-[19px] text-destructive">{state.message}</p>
        <Button variant="outline" size="sm" onClick={write}>
          <RotateCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }
  if (state?.status === "waiting" || !ai?.ready) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">
          This source has no summary of its own. Connect ChatGPT, OpenRouter or OpenCode to get a
          TL;DR for sources like this.
        </p>
        <Button variant="outline" size="sm" onClick={() => openSettings("tldr")}>
          <Sparkles className="size-3.5" aria-hidden="true" />
          Set up TL;DRs
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">No TL;DR yet.</p>
      <Button variant="outline" size="sm" onClick={write} title="Write TL;DR (w)">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Write TL;DR
        <Kbd>w</Kbd>
      </Button>
    </div>
  );
}

export interface TldrPaneProps {
  item: Item | null;
  onOpen: (item: Item) => void;
  onClose: () => void;
  /** A floating panel over the list (narrow windows) instead of a column beside it. */
  floating?: boolean;
}

/** The TL;DR of the focused row, beside the list. */
export function TldrPane({ item, onOpen, onClose, floating = false }: TldrPaneProps) {
  const { tldr } = useTldr(item?.id);
  const kind = item ? getSourceKind(item.kind) : null;
  const meta = item
    ? [kind?.name, getSourceMetaLine(item.kind, item.meta as Record<string, unknown> | null)]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <aside
      aria-label="TL;DR"
      className={cn(
        "flex min-h-0 w-[340px] shrink-0 flex-col",
        floating
          ? "absolute inset-y-3 right-3 z-30 rounded-[16px] border border-border bg-popover shadow-float"
          : "border-l border-border",
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 pl-5 pr-2">
        <span className="font-sans text-[12px] font-medium text-muted-foreground">TL;DR</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Hide TL;DR"
          title="Hide TL;DR (b)"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <TldrPauseNotice />
        {!item ? (
          <p className="font-sans text-[13px] leading-[19px] text-muted-foreground">
            Pick a source to see its TL;DR.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="font-serif text-[18px] font-medium leading-[24px] tracking-[-0.005em] text-foreground">
                {item.title}
              </h2>
              {meta && (
                <p className="font-sans text-[12.5px] leading-[18px] text-muted-foreground">
                  {meta}
                </p>
              )}
            </div>

            <TldrContent item={item} />

            <div className="mt-auto flex flex-col gap-2 pt-2">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
                {TRIAGE_VALUES.map((value) => {
                  const { Icon, textClass, key } = TRIAGE_META[value];
                  const active = item.triage === value;
                  return (
                    <Button
                      key={value}
                      variant={active ? "secondary" : "outline"}
                      size="sm"
                      aria-pressed={active}
                      onClick={() =>
                        dispatchGroupAction(active ? "status-clear" : `status-${value}`)
                      }
                      title={`${TRIAGE_LABELS[value]} (${key})`}
                    >
                      <Icon className={cn("size-3.5", textClass)} aria-hidden="true" />
                      <span>{TRIAGE_LABELS[value]}</span>
                      <Kbd>{key}</Kbd>
                    </Button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => onOpen(item)}>
                  <BookOpen className="size-3.5" aria-hidden="true" />
                  <span>{opensInReader(item) ? "Read" : "Open"}</span>
                  <Kbd>↵</Kbd>
                </Button>
                {tldr && canHaveTldr(item) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => tldrEngine.enqueue([item], "manual", true)}
                    title={
                      tldr.source === "article"
                        ? "Write one with AI instead (w)"
                        : "Write it again (w)"
                    }
                  >
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    <span>{tldr.source === "article" ? "Use AI" : "Rewrite"}</span>
                    <Kbd>w</Kbd>
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
