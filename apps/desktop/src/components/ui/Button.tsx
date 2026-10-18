import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * default: ink, the one main action in a view. outline: secondary actions. ghost: quiet actions
   * in toolbars and rows. secondary: a filled quiet button. marker: the highlighter, used sparingly.
   */
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "marker";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        data-variant={variant}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap font-sans font-medium",
          "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out",
          "motion-safe:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
          {
            "bg-primary text-primary-foreground shadow-raised hover:bg-primary/88":
              variant === "default",
            "bg-destructive text-destructive-foreground shadow-raised hover:bg-destructive/90":
              variant === "destructive",
            "bg-background text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-muted dark:bg-transparent":
              variant === "outline",
            "bg-secondary text-secondary-foreground hover:bg-accent": variant === "secondary",
            "text-foreground hover:bg-muted": variant === "ghost",
            "h-auto px-0 text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground":
              variant === "link",
            "bg-marker-strong text-marker-strong-foreground shadow-raised hover:brightness-[1.04]":
              variant === "marker",
            "h-9 rounded-[9px] px-3.5 text-[13.5px]": size === "default" && variant !== "link",
            "h-8 rounded-[8px] px-2.5 text-[13px]": size === "sm" && variant !== "link",
            "h-10 rounded-[10px] px-5 text-[14px]": size === "lg" && variant !== "link",
            "size-8 rounded-[8px] p-0": size === "icon",
            "size-7 rounded-[7px] p-0": size === "icon-sm",
          },
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
