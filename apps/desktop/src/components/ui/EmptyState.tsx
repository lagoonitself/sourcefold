import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description?: React.ReactNode;
  /** Buttons that start the next step, for example "New group". */
  actions?: React.ReactNode;
  className?: string;
  /** Smaller type and spacing for panels and lists inside a view. */
  compact?: boolean;
}

/** An empty view that says what to do next: a sheet-stack icon, a serif title and the next action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center motion-safe:animate-rise-in",
        compact ? "gap-2 px-6 py-10" : "gap-3 px-8 py-16",
        className,
      )}
    >
      {Icon && (
        <div className={cn("relative mb-1", compact ? "size-11" : "size-14")} aria-hidden="true">
          {/* Two sheets behind the tile, like a stack of index cards. */}
          <span className="absolute inset-0 translate-x-1.5 -translate-y-1 rotate-[8deg] rounded-[12px] bg-muted shadow-raised" />
          <span className="absolute inset-0 -translate-x-1 rotate-[-5deg] rounded-[12px] bg-marker-soft shadow-raised" />
          <span className="absolute inset-0 flex items-center justify-center rounded-[12px] bg-card text-foreground shadow-raised">
            <Icon className={compact ? "size-[18px]" : "size-6"} aria-hidden="true" />
          </span>
        </div>
      )}
      <h2
        className={cn(
          "font-serif font-medium tracking-[-0.012em] text-foreground",
          compact ? "text-[18px] leading-6" : "text-[24px] leading-[30px]",
        )}
      >
        {title}
      </h2>
      {description && (
        <p
          className={cn(
            "max-w-[44ch] text-muted-foreground",
            compact ? "text-[13px] leading-[19px]" : "text-[14px] leading-[21px]",
          )}
        >
          {description}
        </p>
      )}
      {actions && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
