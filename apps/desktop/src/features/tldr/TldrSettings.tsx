import * as React from "react";
import { Check, CircleAlert, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn, openUrl } from "@/lib/utils";
import { Switch } from "../local-copy/LocalCopySettings";
import {
  AiCallError,
  CHATGPT_USAGE_URL,
  chatgptCancelSignIn,
  chatgptSignIn,
  chatgptSignOut,
  clearAiApiKey,
  getAiStatus,
  listAiModels,
  setAiApiKey,
  setAiModel,
  setAiProvider,
  type AiProviderId,
  type AiStatus,
  type ModelInfo,
} from "./tldr-api";
import { updateTldrPrefs, useTldrPrefs } from "./tldr-prefs";
import { notifyAiChanged } from "./tldr-store";

const PROVIDERS: Array<{ id: AiProviderId; name: string; blurb: string }> = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    blurb: "Uses your ChatGPT Plus or Pro plan. No API key.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "Hundreds of models, some free, with your OpenRouter API key.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    blurb: "OpenCode Zen models, some free, with your OpenCode API key.",
  },
];

const KEY_LINKS: Partial<Record<AiProviderId, { url: string; label: string }>> = {
  openrouter: { url: "https://openrouter.ai/settings/keys", label: "Get an OpenRouter key" },
  opencode: { url: "https://opencode.ai/auth", label: "Get an OpenCode key" },
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function price(model: ModelInfo): string | null {
  if (model.free) return "Free";
  if (model.price_in == null || model.price_out == null) return null;
  const fmt = (n: number) => (n < 0.01 ? n.toFixed(3) : n < 1 ? n.toFixed(2) : n.toFixed(1));
  return `$${fmt(model.price_in)} in, $${fmt(model.price_out)} out per 1M tokens`;
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] font-medium text-foreground">{title}</span>
        {description && (
          <p className="text-[12.5px] leading-[18px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function ModelPicker({
  provider,
  status,
  onChanged,
}: {
  provider: AiProviderId;
  status: AiStatus;
  onChanged: (next: AiStatus) => void;
}) {
  const entry = status.providers.find((p) => p.id === provider);
  const [models, setModels] = React.useState<ModelInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [freeOnly, setFreeOnly] = React.useState(false);
  const canList = provider !== "chatgpt" || Boolean(entry?.connected);

  React.useEffect(() => {
    if (!canList) return;
    let cancelled = false;
    setModels(null);
    setError(null);
    listAiModels(provider)
      .then((list) => !cancelled && setModels(list))
      .catch((err) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [provider, canList]);

  if (!canList) return null;

  const pick = async (model: ModelInfo) => {
    try {
      onChanged(await setAiModel(provider, { id: model.id, name: model.name }));
      notifyAiChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const q = query.trim().toLowerCase();
  const shown = (models ?? []).filter(
    (m) =>
      (!freeOnly || m.free) &&
      (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)),
  );
  const hasFree = (models ?? []).some((m) => m.free);

  return (
    <div className="flex flex-col gap-2">
      <Row
        title="Model"
        description={
          entry?.model
            ? `TL;DRs are written with ${entry.model.name}.`
            : "None picked yet: GPT-6 Luna when the list has it, otherwise a free model or the first one."
        }
      />
      {error ? (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : !models ? (
        <div className="flex flex-col gap-1.5">
          <div className="skeleton h-8 w-full rounded-[8px]" />
          <div className="skeleton h-8 w-full rounded-[8px]" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${models.length} models`}
                aria-label="Search models"
                className="pl-8"
              />
            </div>
            {hasFree && (
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
                <Switch checked={freeOnly} onCheckedChange={setFreeOnly} aria-label="Free only" />
                Free only
              </label>
            )}
          </div>
          <div
            role="listbox"
            aria-label="Models"
            className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-border p-1"
          >
            {shown.length === 0 ? (
              <p className="px-2.5 py-2 text-[12.5px] text-muted-foreground">No models match.</p>
            ) : (
              shown.slice(0, 300).map((model) => {
                const selected = entry?.model?.id === model.id;
                const note = price(model);
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => void pick(model)}
                    className={cn(
                      "flex min-h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left transition-colors",
                      selected ? "bg-accent" : "hover:bg-muted",
                    )}
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {selected && (
                        <Check className="size-3.5 text-foreground" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-foreground">
                        {model.name}
                      </span>
                      {model.name !== model.id && (
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {model.id}
                        </span>
                      )}
                    </span>
                    {note && (
                      <span
                        className={cn(
                          "shrink-0 text-[11.5px] tabular-nums",
                          model.free ? "font-medium text-success" : "text-muted-foreground",
                        )}
                      >
                        {note}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ChatgptAccount({
  status,
  onChanged,
}: {
  status: AiStatus;
  onChanged: (next: AiStatus) => void;
}) {
  const entry = status.providers.find((p) => p.id === "chatgpt");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await chatgptSignIn());
      notifyAiChanged();
      toast.success("Signed in to ChatGPT");
    } catch (err) {
      if (!(
        err instanceof AiCallError &&
        err.code === "cancelled" &&
        err.message === "Sign-in cancelled"
      )) {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      onChanged(await chatgptSignOut());
      notifyAiChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!entry?.connected) {
    return (
      <div className="flex flex-col gap-2">
        <Row
          title="ChatGPT account"
          description="Opens ChatGPT in your browser. Allow “Use your ChatGPT plan” on the page that asks; TL;DRs then count against your plan, like using ChatGPT."
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void signIn()} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : null}
            <span>{busy ? "Waiting for the browser…" : "Sign in with ChatGPT"}</span>
          </Button>
          {busy && (
            <Button variant="ghost" size="sm" onClick={() => void chatgptCancelSignIn()}>
              Cancel
            </Button>
          )}
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <CircleAlert className="size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Row
        title="ChatGPT account"
        description={
          entry.plan_usage === false
            ? "Using your plan wasn't allowed. Sign out, sign in again and allow “Use your ChatGPT plan”."
            : `Signed in as ${entry.account ?? "your ChatGPT account"}.`
        }
      >
        {entry.plan_usage !== false && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-success">
            <Check className="size-3" />
            Connected
          </span>
        )}
      </Row>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void openUrl(CHATGPT_USAGE_URL)}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Check usage
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void signOut()} disabled={busy}>
          Sign out
        </Button>
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function ApiKeyRow({
  provider,
  status,
  onChanged,
}: {
  provider: AiProviderId;
  status: AiStatus;
  onChanged: (next: AiStatus) => void;
}) {
  const entry = status.providers.find((p) => p.id === provider);
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const link = KEY_LINKS[provider];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await setAiApiKey(provider, value));
      setValue("");
      notifyAiChanged();
      toast.success("Key saved");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      onChanged(await clearAiApiKey(provider));
      notifyAiChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Row title="API key" description="Kept on this computer and only sent to the provider.">
        {entry?.connected && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-success">
            <Check className="size-3" />
            {entry.account}
          </span>
        )}
      </Row>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) void save();
          }}
          placeholder={entry?.connected ? "Paste a new key to replace it" : "Paste your API key"}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          aria-label="API key"
          className="flex-1 font-mono text-xs"
        />
        <Button
          size="sm"
          className="h-9"
          onClick={() => void save()}
          disabled={busy || !value.trim()}
        >
          {busy ? <Loader2 className="size-3.5 motion-safe:animate-spin" /> : "Save key"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {link && (
          <Button variant="link" size="sm" onClick={() => void openUrl(link.url)}>
            {link.label}
          </Button>
        )}
        {entry?.connected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void remove()}
            disabled={busy}
            className="text-destructive hover:bg-destructive/10"
          >
            Remove key
          </Button>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlert className="size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/** Settings → TL;DR: who writes TL;DRs, with which model, and when. */
export function TldrSettings({ open }: { open: boolean }) {
  const prefs = useTldrPrefs();
  const [status, setStatus] = React.useState<AiStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<AiProviderId>("chatgpt");

  React.useEffect(() => {
    if (!open) return;
    getAiStatus()
      .then((s) => {
        setStatus(s);
        if (s.provider) setSelected(s.provider);
      })
      .catch((err) => setLoadError(errorText(err)));
  }, [open]);

  const choose = async (provider: AiProviderId) => {
    setSelected(provider);
    try {
      setStatus(await setAiProvider(provider));
      notifyAiChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  if (loadError) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-destructive">
        <CircleAlert className="size-3.5 shrink-0" />
        <span>{loadError}</span>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="flex flex-col gap-2">
        <div className="skeleton h-16 w-full rounded-[10px]" />
        <div className="skeleton h-16 w-full rounded-[10px]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] leading-[18px] text-muted-foreground">
        Every source gets a short TL;DR, shown under its title and beside the list, so you can
        decide what to read. Sources with a summary of their own (a Wikipedia lead, an arXiv
        abstract, a “TL;DR:” line) use it for free. For the rest, a model writes one from the
        source&apos;s text, cut to about 24,000 characters. TL;DRs never go into your files.
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-[13.5px] font-medium text-foreground">Write TL;DRs with</span>
        <div role="radiogroup" aria-label="Write TL;DRs with" className="flex flex-col gap-1.5">
          {PROVIDERS.map((p) => {
            const entry = status.providers.find((s) => s.id === p.id);
            const active = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void choose(p.id)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors",
                  active
                    ? "bg-background shadow-[inset_0_0_0_1px_var(--border-strong)]"
                    : "hover:bg-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-foreground" : "border-border-strong",
                  )}
                >
                  {active && <span className="size-2 rounded-full bg-foreground" />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium text-foreground">{p.name}</span>
                  <span className="text-[12.5px] leading-[18px] text-muted-foreground">
                    {p.blurb}
                  </span>
                </span>
                {entry?.connected && (
                  <span className="mt-0.5 shrink-0 text-[11.5px] font-medium text-success">
                    Connected
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected === "chatgpt" ? (
        <ChatgptAccount status={status} onChanged={setStatus} />
      ) : (
        <ApiKeyRow key={selected} provider={selected} status={status} onChanged={setStatus} />
      )}

      <ModelPicker
        key={`models-${selected}`}
        provider={selected}
        status={status}
        onChanged={setStatus}
      />

      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <Row
          title="Write TL;DRs for new sources"
          description="Each source you save from now on gets one by itself. Older sources only get them when you pick their group (the group's menu → Write TL;DRs)."
        >
          <Switch
            checked={prefs.auto}
            onCheckedChange={(auto) => updateTldrPrefs({ auto })}
            aria-label="Write TL;DRs for new sources"
          />
        </Row>
        <Row
          title="Show TL;DRs in the list"
          description="The one-line gist under each source's title. Off shows the author or channel there instead."
        >
          <Switch
            checked={prefs.showInList}
            onCheckedChange={(showInList) => updateTldrPrefs({ showInList })}
            aria-label="Show TL;DRs in the list"
          />
        </Row>
      </div>
    </div>
  );
}
