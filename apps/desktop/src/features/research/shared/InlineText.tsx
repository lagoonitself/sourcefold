import * as React from "react";
import { cn } from "@/lib/utils";

export interface InlineTextProps {
  initial: string;
  /** Accessible name of the field. */
  label: string;
  placeholder?: string;
  className?: string;
  /** Enter, or leaving the field. Not called when the text is unchanged. */
  onSave: (text: string) => void;
  /** Esc, or leaving the field when nothing changed. */
  onCancel: () => void;
  /** Leaving the field saves it (default true). */
  saveOnBlur?: boolean;
}

/**
 * A text field that grows with its text. Enter saves (Shift+Enter starts a new line), Esc cancels.
 * It is mounted only while editing and takes focus when it appears.
 */
export function InlineText({
  initial,
  label,
  placeholder,
  className,
  onSave,
  onCancel,
  saveOnBlur = true,
}: InlineTextProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = React.useState(initial);
  // One finish only: Enter then the blur it causes must not save twice.
  const doneRef = React.useRef(false);

  const resize = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    resize();
  }, [resize]);

  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (save && value !== initial) onSave(value);
    else onCancel();
  };

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => {
        setValue(e.target.value);
        resize();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(saveOnBlur)}
      className={cn(
        "block w-full resize-none rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-[13.5px] leading-[20px] text-foreground",
        "placeholder:text-muted-foreground/80 focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none dark:bg-white/[0.03]",
        className,
      )}
    />
  );
}
