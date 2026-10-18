import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

interface DialogContextType {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextType>({
  open: false,
  onOpenChange: () => {},
});

// Global stack of active dialog close callbacks for topmost Esc handling
const activeDialogCloseStack: Array<() => void> = [];

// Other overlays (reader, open menus) that are not `Dialog`s but still own the keyboard.
const extraModalLayers = new Set<symbol>();

/** Marks an overlay as open until the returned function is called. */
export function registerModalLayer(): () => void {
  const layer = Symbol("modal-layer");
  extraModalLayers.add(layer);
  return () => {
    extraModalLayers.delete(layer);
  };
}

/** True while any dialog, palette, reader or menu is open; global shortcuts must stand down. */
export function isAnyDialogOpen(): boolean {
  return activeDialogCloseStack.length > 0 || extraModalLayers.size > 0;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && activeDialogCloseStack.length > 0) {
        // Only trigger the topmost dialog
        e.preventDefault();
        e.stopPropagation();
        const closeTopmost = activeDialogCloseStack[activeDialogCloseStack.length - 1];
        closeTopmost();
      }
    },
    true, // capture phase to intercept before component-level listeners
  );
}

export function Dialog({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <DialogContext.Provider value={{ open, onOpenChange }}>{children}</DialogContext.Provider>;
}

export function DialogContent({
  children,
  className,
  onKeyDown,
}: {
  children: React.ReactNode;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const { open, onOpenChange } = React.useContext(DialogContext);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const previousActiveElementRef = React.useRef<HTMLElement | null>(null);

  // Focus restoration & stack registration
  React.useEffect(() => {
    if (!open) return;

    // Capture currently focused element before opening
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      previousActiveElementRef.current = document.activeElement;
    }

    const handleClose = () => {
      onOpenChange(false);
    };

    activeDialogCloseStack.push(handleClose);

    // Auto-focus first input or focusable element if nothing is focused inside
    const timer = setTimeout(() => {
      if (contentRef.current) {
        const alreadyFocused = contentRef.current.contains(document.activeElement);
        if (!alreadyFocused) {
          const focusable = contentRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusable.length > 0) {
            focusable[0].focus();
          }
        }
      }
    }, 30);

    return () => {
      clearTimeout(timer);
      const idx = activeDialogCloseStack.indexOf(handleClose);
      if (idx !== -1) {
        activeDialogCloseStack.splice(idx, 1);
      }
      // Restore focus to opener
      if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === "function" &&
        document.body.contains(previousActiveElementRef.current)
      ) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [open, onOpenChange]);

  // Focus trap
  const handleKeyDownTrap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);

    if (e.key === "Tab" && contentRef.current) {
      const focusables = Array.from(
        contentRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstEl ||
          !contentRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (
          document.activeElement === lastEl ||
          !contentRef.current.contains(document.activeElement)
        ) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog-overlay"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => {
            if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
              onOpenChange(false);
            }
          }}
        >
          <motion.div
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            onKeyDown={handleKeyDownTrap}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.12 } }}
            transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
            className={cn(
              "relative max-h-[calc(100dvh-32px)] w-full max-w-lg overflow-y-auto rounded-[16px] bg-card p-6 text-card-foreground shadow-float",
              className,
            )}
          >
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-3.5 top-3.5 z-10 flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-5 flex flex-col gap-1.5 pr-8 text-left", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-6 flex flex-row flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "font-serif text-[22px] font-medium leading-[28px] tracking-[-0.012em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-[13px] leading-[19px] text-muted-foreground", className)} {...props} />
  );
}
