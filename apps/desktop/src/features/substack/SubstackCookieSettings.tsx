import * as React from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  clearSubstackCookie,
  getSubstackCookie,
  setSubstackCookie,
  type SubstackCookieName,
  type SubstackCookieStatus,
} from "./substack-client";

function formatSavedAt(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

export function SubstackCookieSettings({ open }: { open: boolean }) {
  const [status, setStatus] = React.useState<SubstackCookieStatus | null>(null);
  const [name, setName] = React.useState<SubstackCookieName>("substack.sid");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    getSubstackCookie()
      .then((s) => {
        setStatus(s);
        if (s.name === "connect.sid" || s.name === "substack.sid") setName(s.name);
      })
      .catch(() => setStatus(null));
  }, [open]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setSubstackCookie(name, value);
      setStatus(next);
      setValue("");
      toast.success("Substack cookie saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await clearSubstackCookie());
      toast.success("Substack cookie removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1: Paid Substack posts explanation & cookie status */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-[13.5px] font-medium text-foreground">Paid Substack posts</span>
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">
            Free posts save without this. To save paid posts from publications you subscribe to,
            paste your Substack login cookie. It stays on this computer and is only sent to
            Substack.
          </p>
        </div>
        {status?.configured && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-success bg-muted px-2 py-0.5 rounded-full">
            <Check className="size-3" />
            Cookie saved {formatSavedAt(status.saved_at)}
          </span>
        )}
      </div>

      {/* Guide steps */}
      <div className="rounded-[8px] bg-muted/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground mb-1">How to find your cookie:</p>
        <ol className="list-decimal pl-4 space-y-0.5">
          <li>In Chrome, sign in at substack.com.</li>
          <li>Open DevTools (F12), then Application → Cookies → https://substack.com.</li>
          <li>
            Copy the value of{" "}
            <code className="font-mono text-foreground font-semibold">substack.sid</code> and paste
            it below.
          </li>
        </ol>
      </div>

      {/* Row 2: Cookie Inputs */}
      <div className="flex flex-col gap-2">
        <span className="text-[13.5px] font-medium text-foreground">Cookie</span>
        <div className="flex gap-2">
          <select
            value={name}
            onChange={(e) => setName(e.target.value as SubstackCookieName)}
            disabled={busy}
            className="h-9 rounded-[9px] border border-input bg-background px-2.5 text-[13px] font-mono text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <option value="substack.sid">substack.sid</option>
            <option value="connect.sid">connect.sid</option>
          </select>
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={status?.configured ? "Paste a new value to replace it" : "s%3A…"}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs flex-1"
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          Use connect.sid only if a publication on its own domain doesn&apos;t unlock with
          substack.sid. The cookie lasts until you sign out of Substack.
        </p>
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert className="size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" size="sm" onClick={handleSave} disabled={busy || !value.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save cookie"}
          </Button>
          {status?.configured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemove}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
