import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
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

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
          onOpenChange(false);
        }
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        onKeyDown={handleKeyDownTrap}
        className={cn(
          "relative w-full max-w-lg rounded-[10px] border border-border bg-card p-6 shadow-float transition-all",
          "animate-in zoom-in-95 duration-150",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-[4px] p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 text-left mb-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-row items-center justify-end space-x-2 pt-4 mt-2 border-t border-border",
        className,
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        "font-serif text-lg font-semibold leading-none tracking-tight text-foreground",
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
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}
