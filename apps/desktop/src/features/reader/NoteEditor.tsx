import * as React from "react";
import { HIGHLIGHT_LIMITS } from "@sourcefold/core";
import { cn } from "@/lib/utils";

/**
 * Inline note field for a highlight. Enter saves, Shift+Enter adds a line, Escape cancels.
 * Keys stop here so the reader's own shortcuts (h, j, z ...) never fire while typing.
 */
export function NoteEditor({
  initial,
  onSave,
  onCancel,
  className,
}: {
  initial: string | null;
  onSave: (note: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = React.useState(initial ?? "");
  const ref = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <textarea
        ref={ref}
        value={value}
        rows={3}
        maxLength={HIGHLIGHT_LIMITS.note}
        aria-label="Note on this highlight"
        placeholder="Add a note"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSave(value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className="w-full resize-none rounded-[6px] border border-input bg-background px-2 py-1.5 font-sans text-[13px] leading-[18px] text-foreground placeholder:text-muted-foreground"
      />
      <span className="font-sans text-[12px] leading-4 text-muted-foreground">
        Enter saves, Shift+Enter adds a line, Esc cancels
      </span>
    </div>
  );
}
