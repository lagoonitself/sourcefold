import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { isTauri } from "@/lib/api";
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

type Confirming = "index" | "model" | null;

/** Settings → General: search inside sources, by keyword (always on) and by meaning (opt in). */
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
    <div className="flex flex-col gap-2 rounded-[6px] border border-border p-3 bg-muted/20">
      <div className="text-xs font-semibold text-foreground">Search</div>
      <div className="text-[11px] text-muted-foreground">
        {status ? keywordLine(status) : "Checking the search index..."}
        {status &&
          !needsFiles &&
          status.disk_bytes > 0 &&
          ` · ${formatBytes(status.disk_bytes)} on disk`}
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={meaning.enabled}
          onChange={(e) => setMeaningEnabled(e.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-foreground">
            Search by meaning (runs on this computer)
          </span>
          <span className="text-[11px] text-muted-foreground">
            Downloads a 175 MB model from Hugging Face once.
          </span>
        </span>
      </label>

      {meaning.enabled && (
        <div className="flex flex-col gap-1 pl-6">
          {meaning.state === "downloading" && (
            <>
              <div className="text-[11px] text-muted-foreground">
                Downloading the model: {percent}%
              </div>
              <div
                className="h-1 rounded-full bg-muted overflow-hidden"
                role="progressbar"
                aria-label="Model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
            </>
          )}
          {meaning.state === "loading" && (
            <div className="text-[11px] text-muted-foreground">Starting the model...</div>
          )}
          {meaning.state === "error" && (
            <div className="text-[11px] text-destructive">
              {meaning.message || "Couldn't run search by meaning."}
            </div>
          )}
          {meaning.state === "ready" && meaning.message && (
            <div className="text-[11px] text-destructive">{meaning.message}</div>
          )}
          {deviceLine && meaning.state === "ready" && (
            <div className="text-[11px] text-muted-foreground">{deviceLine}</div>
          )}
          {status && status.passages_total > 0 && (
            <div className="text-[11px] text-muted-foreground">
              {status.passages_embedded.toLocaleString()} of{" "}
              {status.passages_total.toLocaleString()} passages
              {meaning.passagesPerSecond !== null &&
                ` · ${Math.max(1, Math.round(meaning.passagesPerSecond))} passages per second`}
            </div>
          )}
        </div>
      )}

      {confirming ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="text-[11px] text-foreground">
            {confirming === "index"
              ? "Delete the search index? Keyword search is rebuilt from your sources."
              : "Delete the downloaded model? Search by meaning turns off until you turn it on again."}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runConfirmed()}
              className="text-xs h-8 cursor-pointer text-destructive hover:bg-destructive/10"
            >
              {confirming === "index" ? "Delete index" : "Delete model"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(null)}
              className="text-xs h-8 cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void togglePause()}
            disabled={busy || !status || needsFiles}
            className="text-xs h-8 cursor-pointer"
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming("index")}
            disabled={busy}
            className="text-xs h-8 cursor-pointer"
          >
            Delete index
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming("model")}
            disabled={busy}
            className="text-xs h-8 cursor-pointer"
          >
            Delete model
          </Button>
        </div>
      )}
    </div>
  );
}
