import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-[9px] border border-input bg-background px-3 py-1 text-[13.5px] text-foreground",
          "transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80",
          "hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.03]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
