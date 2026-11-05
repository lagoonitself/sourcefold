import * as React from "react";
import { cn } from "@/lib/utils";

/** The Input's classes, for the textareas in the shelf dialogs. */
export const shelfTextareaClass = cn(
  "flex w-full rounded-[9px] border border-input bg-background px-3 py-2 text-[13.5px] leading-5 text-foreground",
  "transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80",
  "hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none",
  "resize-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.03]",
);

export interface ShelfFieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}

/** A labelled field in a shelf dialog: small muted label, the control, then a hint or an error. */
export function ShelfField({ id, label, hint, error, children }: ShelfFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="font-sans text-[12px] font-medium leading-4 text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="font-sans text-[12.5px] leading-[18px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="font-sans text-[12.5px] leading-[18px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
