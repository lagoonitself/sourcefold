import * as React from "react";
import { RESEARCH_LIMITS } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import { isMacPlatform } from "../../shortcuts/key-utils";

const textareaClass =
  "block w-full resize-none rounded-[9px] border border-input bg-background p-2.5 font-sans text-[13.5px] leading-[20px] text-foreground transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none dark:bg-white/[0.03]";

/** The summary text field: Ctrl+Enter (Cmd+Enter on a Mac) saves, Esc cancels. */
export function SummaryField({
  initial,
  onSave,
  onCancel,
  minRows = 3,
  buttons = false,
  className,
}: {
  initial: string | null | undefined;
  onSave: (text: string) => void;
  onCancel: () => void;
  minRows?: number;
  /** Show Save and Cancel buttons (dialogs); the reader panel relies on the keys. */
  buttons?: boolean;
  className?: string;
}) {
  const [text, setText] = React.useState(initial ?? "");
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const isMac = React.useMemo(() => isMacPlatform(), []);

  // Grow with the text, up to a limit; then scroll.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 280)}px`;
  }, [text]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <textarea
        ref={ref}
        value={text}
        rows={minRows}
        maxLength={RESEARCH_LIMITS.summary}
        aria-label="Summary"
        placeholder="What this source says, in a sentence or two"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            event.stopPropagation();
            onSave(text);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className={textareaClass}
      />
      <p className="flex items-center gap-1.5 font-sans text-[12px] leading-4 text-muted-foreground">
        <Kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</Kbd>
        <span>to save</span>
        <Kbd>Esc</Kbd>
        <span>to cancel</span>
        {buttons && (
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => onSave(text)}>
              Save summary
            </Button>
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * The summary as a quiet box: the text (or an invitation), and a click or the `u` key opens the
 * field. `editSignal` opens it from outside: raise the number to open it. `className` styles the box.
 */
export function SummaryEditor({
  value,
  onSave,
  editSignal = 0,
  className,
}: {
  value: string | null | undefined;
  onSave: (text: string | null) => void;
  editSignal?: number;
  className?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const boxRef = React.useRef<HTMLButtonElement>(null);
  const handled = React.useRef(editSignal);

  React.useEffect(() => {
    if (editSignal !== handled.current) {
      handled.current = editSignal;
      setEditing(true);
    }
  }, [editSignal]);

  const close = () => {
    setEditing(false);
    // Put the keyboard back on the box so the reader's keys work again.
    window.setTimeout(() => boxRef.current?.focus({ preventScroll: true }), 0);
  };

  if (editing) {
    return (
      <SummaryField
        initial={value}
        onSave={(text) => {
          onSave(text.trim() ? text.trim() : null);
          close();
        }}
        onCancel={close}
      />
    );
  }

  const text = (value ?? "").trim();
  return (
    <button
      ref={boxRef}
      type="button"
      onClick={() => setEditing(true)}
      title="Edit summary (u)"
      aria-label={text ? "Edit summary" : "Add a summary"}
      className={cn(
        "block w-full cursor-pointer rounded-[9px] px-2.5 py-1.5 text-left font-sans text-[13.5px] leading-[20px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        text ? "whitespace-pre-wrap text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {text || "Add a summary"}
    </button>
  );
}
