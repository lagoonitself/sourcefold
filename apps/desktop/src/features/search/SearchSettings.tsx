import * as React from "react";
import { Check, CircleAlert, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  EMBEDDING_MODEL_KEY,
  deleteSearchIndex,
  getSearchStatus,
  setIndexPaused,
  type SearchStatus,
} from "./search-api";
import { deleteModel, setMeaningEnabled, useMeaningSearch } from "./embedding";

const POLL_MS = 2000;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function keywordLine(status: SearchStatus): string {
  switch (status.state) {
    case "needs_local_copy":
      return "Turn on Local copy in Settings to search inside sources.";
    case "needs_web_update":
      return "Update the web app to search inside sources.";
    case "error":
      return status.message || "Couldn't read the search index. It will try again shortly.";
    case "indexing":
      return `Indexing ${status.sources_indexed.toLocaleString()} of ${plural(status.sources_total, "source", "sources")}`;
    case "paused":
      return `Indexing is paused. ${plural(status.sources_indexed, "source", "sources")} indexed.`;
    default:
      return `${plural(status.sources_indexed, "source", "sources")} indexed`;
  }
}

function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center select-none",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        id={id}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-5 w-[34px] rounded-full bg-border-strong transition-colors duration-150 ease-out peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      />
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-xs transition-transform duration-150 ease-spring peer-checked:translate-x-3.5"
      />
    </label>
  );
}

type Confirming = "index" | "model" | null;

/** Settings → Search: search inside sources, by keyword (always on) and by meaning (opt in). */
export function SearchSettings({ open }: { open: boolean }) {
  const meaning = useMeaningSearch();
  const [status, setStatus] = React.useState<SearchStatus | null>(null);
  const [confirming, setConfirming] = React.useState<Confirming>(null);
  const [busy, setBusy] = React.useState(false);
  const available = isTauri();

  React.useEffect(() => {
    if (!open || !available) return;
    let cancelled = false;
    const poll = () => {
      getSearchStatus(null, EMBEDDING_MODEL_KEY)
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, available]);

  React.useEffect(() => {
    if (!open) setConfirming(null);
  }, [open]);

  if (!available) return null;

  const paused = status?.state === "paused";
  const needsFiles = status?.state === "needs_local_copy" || status?.state === "needs_web_update";

  const refresh = () =>
    getSearchStatus(null, EMBEDDING_MODEL_KEY)
      .then(setStatus)
      .catch(() => {});

  const togglePause = async () => {
    setBusy(true);
    try {
      await setIndexPaused(!paused);
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't change indexing.");
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    const action = confirming;
    setConfirming(null);
    setBusy(true);
    try {
      if (action === "index") {
        await deleteSearchIndex();
        toast.success("Deleted the search index");
      } else if (action === "model") {
        await deleteModel();
        toast.success("Deleted the model");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't delete it.");
    } finally {
      setBusy(false);
    }
  };

  const percent = Math.round((meaning.progress ?? 0) * 100);
  const deviceLine =
    meaning.device === "webgpu"
      ? "Using the GPU (WebGPU)"
      : meaning.device === "wasm"
        ? "Using the CPU (WebGPU isn't available)"
        : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Row 1: Keyword Index */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[13.5px] font-medium text-foreground">Keyword search</span>
            <div className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span>
                {status ? keywordLine(status) : "Checking the search index..."}
                {status &&
                  !needsFiles &&
                  status.disk_bytes > 0 &&
                  `, ${formatBytes(status.disk_bytes)} on disk`}
              </span>
            </div>
          </div>
        </div>

        {confirming ? (
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-[12.5px] text-foreground">
              {confirming === "index"
                ? "Delete the search index? Keyword search is rebuilt from your sources."
                : "Delete the downloaded model? Search by meaning turns off until you turn it on again."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runConfirmed()}
                className="text-destructive hover:bg-destructive/10"
              >
                {confirming === "index" ? "Delete index" : "Delete model"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void togglePause()}
              disabled={busy || !status || needsFiles}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming("index")}
              disabled={busy}
            >
              Delete index
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming("model")}
              disabled={busy}
            >
              Delete model
            </Button>
          </div>
        )}
      </div>

      {/* Row 2: Search by meaning */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[13.5px] font-medium text-foreground">
              Search by meaning (runs on this computer)
            </span>
            <p className="text-[12.5px] leading-[18px] text-muted-foreground">
              Downloads a 175 MB model from Hugging Face once. Uses your GPU or CPU to search by
              concept rather than exact keywords.
            </p>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              checked={meaning.enabled}
              onCheckedChange={(val) => setMeaningEnabled(val)}
              aria-label="Search by meaning"
            />
          </div>
        </div>

        {meaning.enabled && (
          <div className="flex flex-col gap-2 pl-0 pt-1">
            {meaning.state === "downloading" && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin shrink-0 text-muted-foreground" />
                  <span>Downloading the model: {percent}%</span>
                </div>
                <div
                  className="h-1 w-full rounded-full bg-muted overflow-hidden"
                  role="progressbar"
                  aria-label="Model download"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <div
                    className="h-full bg-primary transition-all duration-150"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            )}
            {meaning.state === "loading" && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin shrink-0 text-muted-foreground" />
                <span>Starting the model...</span>
              </div>
            )}
            {meaning.state === "error" && (
              <div className="flex items-center gap-1.5 text-[12px] text-destructive">
                <CircleAlert className="size-3.5 shrink-0" />
                <span>{meaning.message || "Couldn't run search by meaning."}</span>
              </div>
            )}
            {meaning.state === "ready" && meaning.message && (
              <div className="flex items-center gap-1.5 text-[12px] text-destructive">
                <CircleAlert className="size-3.5 shrink-0" />
                <span>{meaning.message}</span>
              </div>
            )}
            {deviceLine && meaning.state === "ready" && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                <span>{deviceLine}</span>
              </div>
            )}
            {status && status.passages_total > 0 && (
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {status.passages_embedded.toLocaleString()} of{" "}
                  {status.passages_total.toLocaleString()} passages embedded
                  {meaning.passagesPerSecond !== null &&
                    `, ${Math.max(1, Math.round(meaning.passagesPerSecond))} passages per second`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
