import * as React from "react";
import { Check, Loader2 } from "lucide-react";
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
    <div className="flex flex-col gap-4 py-2">
      <div className="rounded-[8px] border border-border p-4 bg-muted/20 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">Paid Substack posts</span>
          {status?.configured && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <Check className="size-3" />
              Cookie saved {formatSavedAt(status.saved_at)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Free posts save without this. To save paid posts from publications you subscribe to, paste
          your Substack login cookie. It stays on this computer and is only sent to Substack.
        </p>
      </div>

      <ol className="list-decimal pl-5 text-[11px] text-muted-foreground leading-relaxed space-y-0.5">
        <li>In Chrome, sign in at substack.com.</li>
        <li>Open DevTools (F12), then Application, then Cookies, then https://substack.com.</li>
        <li>
          Copy the value of <span className="font-mono">substack.sid</span> and paste it below.
        </li>
      </ol>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-foreground">Cookie</label>
        <div className="flex gap-2">
          <select
            value={name}
            onChange={(e) => setName(e.target.value as SubstackCookieName)}
            disabled={busy}
            className="h-9 rounded-[6px] border border-input bg-background px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="font-mono text-xs"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Use connect.sid only if a publication on its own domain doesn't unlock with substack.sid.
          The cookie lasts until you sign out of Substack.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={busy || !value.trim()}
          className="text-xs h-8 cursor-pointer"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save cookie"}
        </Button>
        {status?.configured && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemove}
            disabled={busy}
            className="text-xs h-8 cursor-pointer"
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
