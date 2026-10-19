import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { registerModalLayer } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

export interface PopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button (or chip) that opens it; the popover hangs below it. */
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
  /** Class of the wrapper around the trigger. */
  wrapperClassName?: string;
}

/** A small floating panel next to its trigger. Esc and a click outside close it. */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = "start",
  className,
  wrapperClassName,
}: PopoverProps) {
  const containerRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!open) return;
    return registerModalLayer();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <span ref={containerRef} className={cn("relative inline-block", wrapperClassName)}>
      {trigger}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
            className={cn(
              "absolute z-50 mt-1.5 w-[320px] max-w-[calc(100vw-48px)] rounded-[12px] bg-popover p-3 text-left text-popover-foreground shadow-float",
              align === "end" ? "right-0" : "left-0",
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
