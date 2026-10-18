import * as React from "react";
import { cn } from "@/lib/utils";

/** Small key hint shown on buttons and menu rows, like the "Add links" button's "A". */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 font-mono text-[10.5px] font-medium leading-none text-muted-foreground",
        "bg-background shadow-[inset_0_0_0_1px_var(--border),0_1px_0_var(--border)] dark:bg-white/[0.04]",
        "in-data-[variant=default]:bg-primary-foreground/10 in-data-[variant=default]:text-primary-foreground/75 in-data-[variant=default]:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--primary-foreground)_25%,transparent)]",
        className,
      )}
      {...props}
    />
  );
}
