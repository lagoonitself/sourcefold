import * as React from "react";
import { cn } from "@/lib/utils";

export interface ViewHeaderProps {
  title: string;
  /** A line of counts under the title. */
  summary?: React.ReactNode;
  /** Buttons on the right of the summary line. */
  actions?: React.ReactNode;
  /** Tabs under the header (a `ViewTabs`). */
  children?: React.ReactNode;
}

/** The project view's title in Newsreader with the highlighter stroke, like a group's heading. */
export function ViewHeader({ title, summary, actions, children }: ViewHeaderProps) {
  return (
    <header className="shrink-0">
      <div className="pb-1">
        <h1 className="min-w-0 font-serif text-[30px] font-medium leading-[36px] tracking-[-0.02em] text-foreground @[560px]/view:text-[40px] @[560px]/view:leading-[44px]">
          <span className="marker marker-sweep" key={title}>
            {title}
          </span>
        </h1>
      </div>
      <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1.5", children ? "pb-4" : "pb-3")}>
        <span className="font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums">
          {summary}
        </span>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Rows that stand in for a list while it loads. */
export function ViewSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-1 py-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="-mx-2.5 flex items-start gap-3 rounded-[10px] px-2.5 py-3"
          aria-hidden="true"
        >
          <div className="skeleton h-[54px] w-24 shrink-0 rounded-[6px]" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="skeleton h-4.5 rounded" style={{ width: `${[78, 92, 64, 84][i % 4]}%` }} />
            <div className="skeleton h-3.5 rounded" style={{ width: `${[36, 44, 28, 40][i % 4]}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
