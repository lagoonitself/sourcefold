import * as React from "react";
import { BookmarkCheck, CircleHelp, Scissors } from "lucide-react";
import { TRIAGE_LABELS, TRIAGE_VALUES, type Triage } from "@sourcefold/core";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** Keep is green, Maybe amber, Cut grey (and its row dimmed); each also has an icon and a word. */
export const TRIAGE_META: Record<
  Triage,
  { Icon: IconComponent; textClass: string; key: string; hint: string }
> = {
  keep: { Icon: BookmarkCheck, textClass: "text-success", key: "1", hint: "Use it in the video" },
  maybe: { Icon: CircleHelp, textClass: "text-warning", key: "2", hint: "Decide later" },
  cut: { Icon: Scissors, textClass: "text-muted-foreground", key: "3", hint: "Leave it out" },
};

/** A status as a small icon with a tooltip; nothing when the source has none. */
export function TriageMark({
  triage,
  className,
}: {
  triage: Triage | null | undefined;
  className?: string;
}) {
  if (!triage) return null;
  const { Icon, textClass } = TRIAGE_META[triage];
  const label = TRIAGE_LABELS[triage];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex shrink-0 items-center", textClass, className)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

/** Keep, Maybe and Cut as three buttons; pressing the current one clears the status. */
export function TriageButtons({
  value,
  onChange,
  className,
}: {
  value: Triage | null | undefined;
  onChange: (next: Triage | null) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label="Status" className={cn("flex items-center gap-1", className)}>
      {TRIAGE_VALUES.map((triage) => {
        const { Icon, textClass, key, hint } = TRIAGE_META[triage];
        const active = value === triage;
        return (
          <button
            key={triage}
            type="button"
            aria-pressed={active}
            title={
              active ? `${TRIAGE_LABELS[triage]}: press ${key} or 0 to clear` : `${hint} (${key})`
            }
            onClick={() => onChange(active ? null : triage)}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[8px] px-2 font-sans text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "bg-accent text-foreground shadow-raised"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("size-3.5", active && textClass)} aria-hidden="true" />
            <span>{TRIAGE_LABELS[triage]}</span>
            <Kbd>{key}</Kbd>
          </button>
        );
      })}
    </div>
  );
}
