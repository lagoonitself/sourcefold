import * as React from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PREFS,
  FONT_OPTIONS,
  LEADING_OPTIONS,
  PAGE_OPTIONS,
  PRESETS,
  SIZE_MAX,
  SIZE_MIN,
  WIDTH_MAX,
  WIDTH_MIN,
  WIDTH_STEP,
  matchingPreset,
  pageClass,
  setReaderPrefs,
  useReaderPrefs,
  type ReaderPage,
} from "./reader-prefs";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[12px] font-medium leading-4 text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ id: T; name: string; title?: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-[9px] bg-muted p-0.5 font-sans shadow-[inset_0_0_0_1px_var(--border)]"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          title={option.title}
          onClick={() => onChange(option.id)}
          className={cn(
            "h-7 flex-1 cursor-pointer rounded-[7px] px-2 text-[12.5px] font-medium transition-colors duration-100",
            value === option.id
              ? "bg-background text-foreground shadow-raised"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.name}
        </button>
      ))}
    </div>
  );
}

function PageSwatch({
  page,
  name,
  active,
  onClick,
}: {
  page: ReaderPage;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={name}
      title={name}
      onClick={onClick}
      className="group flex cursor-pointer flex-col items-center gap-1 font-sans"
    >
      <span
        className={cn(
          pageClass(page),
          "flex size-9 items-center justify-center rounded-full bg-background font-serif text-[15px] text-foreground shadow-raised transition-shadow",
          page === "app" &&
            "bg-[linear-gradient(135deg,var(--background)_50%,var(--foreground)_50%)]",
          active && "ring-2 ring-ring ring-offset-2 ring-offset-popover",
        )}
      >
        {page === "app" ? "" : "Aa"}
      </span>
      <span
        className={cn(
          "text-[11.5px] leading-4",
          active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        {page === "app" ? "App" : name}
      </span>
    </button>
  );
}

/** Every reading setting. Used in the reader's Aa popover and in Settings → Reading. */
export function ReaderSettingsPanel({ className }: { className?: string }) {
  const prefs = useReaderPrefs();
  const preset = matchingPreset(prefs);
  const fill = prefs.width === "fill";

  return (
    <div className={cn("space-y-4 font-sans", className)}>
      <Section label="Presets">
        <Segmented
          label="Presets"
          value={preset?.id ?? null}
          options={PRESETS.map((p) => ({ id: p.id, name: p.name, title: p.hint }))}
          onChange={(id) => {
            const next = PRESETS.find((p) => p.id === id);
            if (next) setReaderPrefs(next.prefs);
          }}
        />
      </Section>

      <Section label="Font">
        <div role="radiogroup" aria-label="Font" className="grid grid-cols-2 gap-1.5">
          {FONT_OPTIONS.map((font) => {
            const active = prefs.font === font.id;
            return (
              <button
                key={font.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setReaderPrefs({ font: font.id })}
                className={cn(
                  "flex cursor-pointer flex-col items-start rounded-[9px] px-2.5 py-2 text-left transition-colors duration-100",
                  active
                    ? "bg-accent shadow-[inset_0_0_0_1.5px_var(--foreground)]"
                    : "shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted",
                )}
              >
                <span
                  className="truncate text-[15px] leading-5 text-foreground"
                  style={{ fontFamily: font.family }}
                >
                  {font.name}
                </span>
                <span className="text-[11.5px] leading-4 text-muted-foreground">{font.hint}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Text size">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Smaller text"
            title="Smaller text (Mod+-)"
            disabled={prefs.size <= SIZE_MIN}
            onClick={() => setReaderPrefs({ size: prefs.size - 1 })}
          >
            <Minus className="size-3.5" aria-hidden="true" />
          </Button>
          <input
            type="range"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={1}
            value={prefs.size}
            aria-label="Text size"
            onChange={(e) => setReaderPrefs({ size: Number(e.target.value) })}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--foreground)]"
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Larger text"
            title="Larger text (Mod+=)"
            disabled={prefs.size >= SIZE_MAX}
            onClick={() => setReaderPrefs({ size: prefs.size + 1 })}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Button>
          <span className="w-10 text-right text-[12.5px] tabular-nums text-muted-foreground">
            {prefs.size}px
          </span>
        </div>
      </Section>

      <Section label="Line spacing">
        <Segmented
          label="Line spacing"
          value={prefs.leading}
          options={LEADING_OPTIONS}
          onChange={(leading) => setReaderPrefs({ leading })}
        />
      </Section>

      <Section label="Width">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={WIDTH_MIN}
            max={WIDTH_MAX}
            step={WIDTH_STEP}
            value={fill ? WIDTH_MAX : (prefs.width as number)}
            disabled={fill}
            aria-label="Characters per line"
            title="Narrower or wider (Shift+, and Shift+.)"
            onChange={(e) => setReaderPrefs({ width: Number(e.target.value) })}
            className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--foreground)] disabled:cursor-default disabled:opacity-40"
          />
          <button
            type="button"
            aria-pressed={fill}
            onClick={() => setReaderPrefs({ width: fill ? DEFAULT_PREFS.width : "fill" })}
            className={cn(
              "h-7 cursor-pointer rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors",
              fill
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:text-foreground",
            )}
          >
            Fill
          </button>
        </div>
        <div className="text-[12px] leading-4 tabular-nums text-muted-foreground">
          {fill ? "Fills the sheet" : `About ${prefs.width} characters a line`}
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section label="Paragraphs">
          <Segmented
            label="Paragraphs"
            value={prefs.paragraphs}
            options={[
              { id: "spaced", name: "Spaced" },
              { id: "indented", name: "Indented" },
            ]}
            onChange={(paragraphs) => setReaderPrefs({ paragraphs })}
          />
        </Section>
        <Section label="Alignment">
          <Segmented
            label="Alignment"
            value={prefs.align}
            options={[
              { id: "left", name: "Left" },
              { id: "justify", name: "Justified" },
            ]}
            onChange={(align) => setReaderPrefs({ align })}
          />
        </Section>
      </div>

      <Section label="Page colour">
        <div role="radiogroup" aria-label="Page colour" className="flex justify-between px-1">
          {PAGE_OPTIONS.map((page) => (
            <PageSwatch
              key={page.id}
              page={page.id}
              name={page.name}
              active={prefs.page === page.id}
              onClick={() => setReaderPrefs({ page: page.id })}
            />
          ))}
        </div>
      </Section>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReaderPrefs({ ...DEFAULT_PREFS, contents: prefs.contents })}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>
    </div>
  );
}

/** The Aa popover under the reader's toolbar button. Esc and clicks outside close it. */
export function ReaderSettingsPopover({
  open,
  onClose,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open, onClose, anchorRef]);

  if (!open) return null;
  return (
    <div
      ref={panelRef}
      data-reader-ui
      role="dialog"
      aria-label="Reading settings"
      className="animate-pop-in absolute right-3 top-[56px] z-40 max-h-[calc(100%-68px)] w-[330px] origin-top-right overflow-y-auto rounded-[12px] bg-popover p-4 text-popover-foreground shadow-float select-none"
    >
      <ReaderSettingsPanel />
    </div>
  );
}
