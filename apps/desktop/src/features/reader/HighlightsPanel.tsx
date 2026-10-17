import * as React from "react";
import { AlertCircle, Copy, StickyNote, Trash2 } from "lucide-react";
import { formatHighlightTime, youtubeTimestampUrl, type Highlight } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { cn, openUrl } from "@/lib/utils";
import { domainOf } from "./extract";
import { NoteEditor } from "./NoteEditor";
import type { ReaderItem } from "./types";
import type { ReaderHighlightsController } from "./useReaderHighlights";
import { urlKey } from "./url-key";

const TAB =
  "cursor-pointer border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2";

/** The 320px side panel: the highlights in reading order, and the sources an article cites. */
export function HighlightsPanel({
  item,
  itemUrl,
  controller,
}: {
  item: ReaderItem;
  itemUrl: string | null;
  controller: ReaderHighlightsController;
}) {
  const { panelTab, setPanelTab, highlights, references, hasReferences } = controller;
  const tab = hasReferences ? panelTab : "highlights";

  return (
    <aside
      data-reader-ui
      aria-label="Highlights panel"
      className="flex w-80 shrink-0 flex-col border-l border-border bg-background font-sans"
    >
      <div role="tablist" aria-label="Panel" className="flex shrink-0 border-b border-border px-1">
        <button
          type="button"
          role="tab"
          id="reader-tab-highlights"
          aria-selected={tab === "highlights"}
          aria-controls="reader-tabpanel"
          onClick={() => setPanelTab("highlights")}
          className={cn(
            TAB,
            tab === "highlights"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Highlights{" "}
          {highlights.length > 0 && (
            <span className="text-muted-foreground">{highlights.length}</span>
          )}
        </button>
        {hasReferences && (
          <button
            type="button"
            role="tab"
            id="reader-tab-cited"
            aria-selected={tab === "cited"}
            aria-controls="reader-tabpanel"
            onClick={() => setPanelTab("cited")}
            className={cn(
              TAB,
              tab === "cited"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Cited sources <span className="text-muted-foreground">{references.length}</span>
          </button>
        )}
      </div>

      <div
        id="reader-tabpanel"
        role="tabpanel"
        aria-labelledby={tab === "cited" ? "reader-tab-cited" : "reader-tab-highlights"}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {tab === "highlights" ? (
          <HighlightList item={item} itemUrl={itemUrl} controller={controller} />
        ) : (
          <CitedList controller={controller} />
        )}
      </div>
    </aside>
  );
}

function HighlightList({
  item,
  itemUrl,
  controller,
}: {
  item: ReaderItem;
  itemUrl: string | null;
  controller: ReaderHighlightsController;
}) {
  const { highlights, anchored, starts, loadState } = controller;
  const ordered = React.useMemo(
    () =>
      [...highlights].sort(
        (a, b) =>
          (starts.get(a.id) ?? a.start_offset) - (starts.get(b.id) ?? b.start_offset) ||
          a.created_at.localeCompare(b.created_at),
      ),
    [highlights, starts],
  );

  if (loadState === "error") {
    return (
      <p className="p-4 text-[13px] leading-[18px] text-muted-foreground">
        Couldn't load your highlights. Close this source and open it again.
      </p>
    );
  }
  if (loadState === "ready" && ordered.length === 0) {
    return (
      <p className="p-4 text-[13px] leading-[18px] text-muted-foreground">
        No highlights yet. Select text in the article to highlight it, or press j to focus a
        paragraph and h to highlight it.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {ordered.map((h) => (
        <HighlightRow
          key={h.id}
          highlight={h}
          itemUrl={itemUrl}
          item={item}
          placed={anchored === null || anchored.has(h.id)}
          current={controller.currentId === h.id}
          controller={controller}
        />
      ))}
    </ul>
  );
}

function HighlightRow({
  highlight: h,
  itemUrl,
  placed,
  current,
  controller,
}: {
  highlight: Highlight;
  item: ReaderItem;
  itemUrl: string | null;
  placed: boolean;
  current: boolean;
  controller: ReaderHighlightsController;
}) {
  const editing = controller.panelNoteId === h.id;
  const timeUrl = h.seconds !== null ? youtubeTimestampUrl(itemUrl, h.seconds) : null;

  return (
    <li className={cn("px-3 py-2.5", current && "bg-accent")}>
      <button
        type="button"
        disabled={!placed}
        onClick={() => controller.jumpTo(h.id)}
        className="block w-full cursor-pointer text-left disabled:cursor-default"
        aria-label={placed ? `Go to highlight: ${h.quote.slice(0, 60)}` : undefined}
      >
        {h.kind === "image" && h.image_src ? (
          <img
            src={h.image_src}
            alt={h.quote}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-20 max-w-full rounded-[4px]"
          />
        ) : (
          <span className="line-clamp-4 text-[13px] leading-[18px] text-foreground">{h.quote}</span>
        )}
      </button>

      {!placed && (
        <p className="mt-1 flex items-start gap-1 text-[12px] leading-4 text-muted-foreground">
          <AlertCircle className="mt-px size-3 shrink-0" aria-hidden="true" />
          Couldn't find this passage in the current text
        </p>
      )}

      {(h.seconds !== null || h.cited.length > 0) && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-muted-foreground">
          {h.seconds !== null &&
            (timeUrl ? (
              <button
                type="button"
                onClick={() => void openUrl(timeUrl)}
                className="cursor-pointer text-primary hover:underline"
                title="Open the video at this time"
              >
                {formatHighlightTime(h.seconds)}
              </button>
            ) : (
              <span>{formatHighlightTime(h.seconds)}</span>
            ))}
          {h.cited.length > 0 && (
            <span>Cited: {h.cited.map((c) => domainOf(c.url)).join(", ")}</span>
          )}
        </p>
      )}

      {editing ? (
        <NoteEditor
          className="mt-2"
          initial={h.note}
          onSave={(note) => controller.saveNote(h.id, note)}
          onCancel={controller.cancelNote}
        />
      ) : (
        h.note && (
          <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-[18px] text-muted-foreground">
            {h.note}
          </p>
        )
      )}

      <div className="mt-1.5 flex items-center gap-0.5">
        <PanelIconButton
          label="Edit note"
          onClick={() => controller.startPanelNote(h.id)}
          icon={<StickyNote className="size-3.5" aria-hidden="true" />}
        />
        <PanelIconButton
          label="Copy with source"
          onClick={() => controller.copyHighlight(h.id)}
          icon={<Copy className="size-3.5" aria-hidden="true" />}
        />
        <PanelIconButton
          label="Delete highlight"
          onClick={() => controller.removeHighlight(h.id)}
          icon={<Trash2 className="size-3.5" aria-hidden="true" />}
        />
      </div>
    </li>
  );
}

function PanelIconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {icon}
    </button>
  );
}

function CitedList({ controller }: { controller: ReaderHighlightsController }) {
  const { references, savedKeys, canSaveLinks, saveLinks } = controller;
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  const isSaved = (url: string) => {
    const key = urlKey(url);
    return key !== null && savedKeys.has(key);
  };
  const unsaved = references.filter((r) => !isSaved(r.url));
  const chosen = unsaved.filter((r) => picked.has(r.url));

  if (references.length === 0) {
    return (
      <p className="p-4 text-[13px] leading-[18px] text-muted-foreground">
        This article has no references with links.
      </p>
    );
  }

  const toggle = (url: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });

  return (
    <div className="flex min-h-full flex-col">
      <ul className="flex-1 divide-y divide-border">
        {references.map((r) => {
          const saved = isSaved(r.url);
          const id = `reader-ref-${r.label}`;
          return (
            <li key={r.label} className="flex items-start gap-2 px-3 py-2">
              {canSaveLinks && (
                <input
                  id={id}
                  type="checkbox"
                  disabled={saved}
                  checked={picked.has(r.url) && !saved}
                  onChange={() => toggle(r.url)}
                  aria-label={`Select reference ${r.label}`}
                  className="mt-1 size-3.5 cursor-pointer accent-[var(--primary)] disabled:cursor-default"
                />
              )}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void openUrl(r.url)}
                  className="block w-full cursor-pointer text-left text-[13px] leading-[18px] text-foreground hover:underline"
                >
                  <span className="text-muted-foreground">[{r.label}]</span>{" "}
                  {r.title ?? domainOf(r.url)}
                </button>
                <p className="truncate text-[12px] leading-4 text-muted-foreground">
                  {domainOf(r.url)}
                  {saved && <span> · Saved in this group</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {canSaveLinks && (
        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background px-3 py-2">
          <button
            type="button"
            onClick={() =>
              setPicked(
                chosen.length === unsaved.length ? new Set() : new Set(unsaved.map((r) => r.url)),
              )
            }
            disabled={unsaved.length === 0}
            className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            {chosen.length === unsaved.length && unsaved.length > 0 ? "Clear" : "Select all"}
          </button>
          <Button
            size="sm"
            disabled={chosen.length === 0}
            onClick={() => {
              saveLinks(chosen.map((r) => r.url));
              setPicked(new Set());
            }}
          >
            Save to group{chosen.length > 0 ? ` (${chosen.length})` : ""}
          </Button>
        </div>
      )}
    </div>
  );
}
