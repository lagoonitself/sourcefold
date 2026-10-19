import * as React from "react";
import { Button } from "@/components/ui/Button";

/**
 * The source's text as Markdown in a plain box, for cuts that selecting can't make. It covers the
 * reading area; the title, the "Saved from" line, your highlights and your note are kept apart.
 */
export function ReaderTextEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState(initial);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const changed = text.trim() !== initial.trim();

  React.useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      role="dialog"
      aria-label="Edit text"
      data-reader-ui
      className="absolute inset-0 z-40 flex flex-col bg-background font-sans"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">Edit text</div>
          <p className="truncate text-xs text-muted-foreground">
            Delete what you don&apos;t want. This is the saved Markdown; your note and highlights
            stay as they are.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(text)} disabled={busy || !changed}>
            {busy ? "Saving" : "Save"}
          </Button>
        </div>
      </div>
      <textarea
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !changed) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (changed && !busy) onSave(text);
          }
        }}
        spellCheck={false}
        aria-label="Source text"
        className="min-h-0 flex-1 resize-none bg-background px-6 py-4 font-mono text-[13px] leading-6 text-foreground outline-none select-text"
      />
      <div className="shrink-0 border-t border-border px-4 py-1.5 text-xs tabular-nums text-muted-foreground">
        {text.length.toLocaleString()} characters
      </div>
    </div>
  );
}
