import * as React from "react";
import { toast } from "sonner";

/** Copies text to the clipboard; `copied` is true for two seconds afterwards (the button says "Copied"). */
export function useCopied(): { copied: boolean; copy: (text: string) => Promise<boolean> } {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = React.useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error("Couldn't copy to the clipboard. Try again.");
      return false;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
    return true;
  }, []);

  return { copied, copy };
}
