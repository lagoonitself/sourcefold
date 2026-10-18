import * as React from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/api";
import { cn, errorMessage } from "@/lib/utils";
import { openClaudeExtension } from "./claude-api";
import { CLAUDE_APP_OPEN_NOTE, CLAUDE_INSTALL_STARTED, claudeStatusLine } from "./claude-status";

export interface ClaudeSettingsProps {
  signedIn: boolean;
  offline: boolean;
  email: string | null;
}

/** Settings → Claude: connect Claude Desktop to the library through the Sourcefold extension. */
export function ClaudeSettings({ signedIn, offline, email }: ClaudeSettingsProps) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const status = claudeStatusLine({ signedIn, offline, email });

  const handleAdd = async () => {
    setBusy(true);
    setResult(null);
    try {
      await openClaudeExtension();
      setResult({ ok: true, text: CLAUDE_INSTALL_STARTED });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err, "Couldn't open the Claude extension.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-foreground">Claude Desktop</span>
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">
            Claude Desktop can read, add and organize your sources. It uses this app&apos;s sign-in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={handleAdd} disabled={busy || !isTauri()}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Add to Claude Desktop
          </Button>
          {result && (
            <p
              role="status"
              className={cn(
                "flex items-start gap-1.5 text-[12.5px] leading-[18px]",
                result.ok ? "text-foreground" : "text-destructive",
              )}
            >
              {result.ok ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              )}
              <span>{result.text}</span>
            </p>
          )}
        </div>
      </div>

      <div className="rounded-[8px] bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground mb-1">How to use</p>
        <ol className="list-decimal pl-4 space-y-0.5">
          <li>Open Claude Desktop and start a new chat.</li>
          <li>Ask about your sources, for example &quot;List my Sourcefold projects&quot;.</li>
          <li>
            Ask it to add things, for example &quot;Add this YouTube playlist to my Cars › Turbo
            group&quot;.
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="flex items-start gap-1.5 text-[12.5px] leading-[18px] text-foreground">
          {status.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span>{status.text}</span>
        </p>
        <p className="text-[12.5px] leading-[18px] text-muted-foreground">{CLAUDE_APP_OPEN_NOTE}</p>
      </div>
    </div>
  );
}
