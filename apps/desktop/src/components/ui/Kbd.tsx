import * as React from "react";
import { cn } from "@/lib/utils";

/** Small key hint shown on buttons, like the sidebar's "Add links" button. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "rounded border border-border bg-muted/60 px-1 font-mono text-[9px] leading-4 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
