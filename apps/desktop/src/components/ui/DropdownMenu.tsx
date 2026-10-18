import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { registerModalLayer } from "./Dialog";

interface DropdownContextType {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const DropdownContext = React.createContext<DropdownContextType>({
  open: false,
  setOpen: () => {},
});

export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? Boolean(controlledOpen) : internalOpen;
  const setOpen = React.useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved =
        typeof next === "function" ? (next as (prev: boolean) => boolean)(open) : next;
      if (!isControlled) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [isControlled, onOpenChange, open],
  );
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    return registerModalLayer();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div ref={containerRef} className="relative inline-block text-left">
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  asChild,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const { open, setOpen } = React.useContext(DropdownContext);

  // asChild: the single child (for example a Button) becomes the trigger, so buttons don't nest.
  if (asChild && React.isValidElement<React.ButtonHTMLAttributes<HTMLButtonElement>>(children)) {
    const child = children;
    return React.cloneElement(child, {
      "aria-expanded": open,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        child.props.onClick?.(e);
        onClick?.(e);
        setOpen(!open);
      },
    });
  }

  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        onClick?.(e);
        setOpen(!open);
      }}
      aria-expanded={open}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  className,
  align = "end",
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  const { open } = React.useContext(DropdownContext);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -2, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          style={{ transformOrigin: align === "end" ? "top right" : "top left" }}
          className={cn(
            "absolute z-50 mt-1.5 min-w-[10rem] overflow-hidden rounded-[12px] bg-popover p-1 text-popover-foreground shadow-float",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
          onClick={onClick}
          {...(props as React.ComponentProps<typeof motion.div>)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DropdownMenuItem({
  children,
  className,
  variant = "default",
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "destructive";
}) {
  const { setOpen } = React.useContext(DropdownContext);

  return (
    <div
      role="menuitem"
      className={cn(
        "relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-[13px] outline-none transition-colors duration-100 [&_kbd]:ml-auto [&_svg]:text-muted-foreground",
        variant === "destructive"
          ? "text-destructive hover:bg-destructive/10 focus:bg-destructive/10 [&_svg]:!text-destructive"
          : "text-foreground hover:bg-muted focus:bg-muted",
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
