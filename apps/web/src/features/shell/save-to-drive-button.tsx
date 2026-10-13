"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";

interface DriveStatus {
  unsaved: number;
  last_saved_at: string | null;
  root_folder_id: string | null;
  connected: boolean;
}

function formatLastSaved(isoString: string | null | undefined): string {
  if (!isoString) return "Not saved yet";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Not saved yet";
    const monthDay = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `Last saved ${monthDay}, ${hours}:${minutes}`;
  } catch {
    return "Not saved yet";
  }
}

async function reconnect() {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: "https://www.googleapis.com/auth/drive.file",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      toast.error(error.message);
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to open Google sign-in");
  }
}

export function SaveToDriveButton() {
  const router = useRouter();
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ total: number; remaining: number } | null>(null);

  const savingRef = useRef(false);
  const statusRef = useRef<DriveStatus | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/drive/status");
      if (res.ok) {
        const json = (await res.json()) as { data?: DriveStatus };
        if (json.data) {
          setStatus(json.data);
        }
      }
    } catch {
      // Ignore network errors during polling
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void fetch("/api/drive/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: DriveStatus } | null) => {
        if (mounted && json?.data) {
          setStatus(json.data);
        }
      })
      .catch(() => {});

    function onFocus() {
      void fetchStatus();
    }
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => {
      void fetchStatus();
    }, 30000);

    return () => {
      mounted = false;
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [fetchStatus]);

  const handleSave = useCallback(async () => {
    if (savingRef.current) return;

    if (statusRef.current && !statusRef.current.connected) {
      await reconnect();
      return;
    }

    savingRef.current = true;
    setSaving(true);

    const initialTotal = statusRef.current?.unsaved ?? 0;
    let remaining = initialTotal;
    let totalFailed = 0;
    setProgress({ total: initialTotal, remaining: initialTotal });

    try {
      while (true) {
        const res = await fetch("/api/drive/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const json = (await res.json()) as {
          data?: {
            processed: number;
            remaining: number;
            done: boolean;
            failed?: { id: string; title: string; message: string }[];
          };
          error?: {
            code?: string;
            message?: string;
          };
        };

        if (!res.ok) {
          if (json?.error?.code === "reconnect_drive") {
            toast.error("Reconnect Google Drive to keep saving.", {
              action: {
                label: "Reconnect Drive",
                onClick: reconnect,
              },
            });
          } else {
            toast.error(json?.error?.message || "Couldn't reach Google Drive. Try again.");
          }
          break;
        }

        const data = json.data;
        if (!data) {
          toast.error("Couldn't reach Google Drive. Try again.");
          break;
        }

        if (Array.isArray(data.failed) && data.failed.length > 0) {
          totalFailed += data.failed.length;
        }

        remaining = typeof data.remaining === "number" ? data.remaining : 0;
        setProgress({ total: initialTotal, remaining });

        if (data.done || remaining === 0) {
          if (totalFailed > 0) {
            toast.error(`Saved to Drive, but ${totalFailed} items failed.`);
          } else {
            toast.success("Saved to Drive");
          }
          router.refresh();
          break;
        }

        // Items that fail every time stay unsaved; stop once a batch makes no progress.
        if (data.processed === 0) {
          toast.error(
            `Saved to Drive, but ${remaining} ${remaining === 1 ? "item" : "items"} couldn't be saved. Try again later.`,
          );
          router.refresh();
          break;
        }
      }
    } catch {
      toast.error("Couldn't reach Google Drive. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      setProgress(null);
      await fetchStatus();
    }
  }, [fetchStatus, router]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSave]);

  let label = "Save to Drive";
  if (saving && progress) {
    if (progress.total > 0) {
      const current = Math.min(progress.total, Math.max(0, progress.total - progress.remaining));
      label = `Saving ${current} of ${progress.total}…`;
    } else {
      label = "Saving…";
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="default"
            disabled={saving}
            onClick={handleSave}
            className="disabled:pointer-events-auto"
          >
            <CloudUpload className="size-4" />
            <span>{label}</span>
            {!saving && status && status.unsaved > 0 && (
              <span className="rounded-[4px] bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
                {status.unsaved}
              </span>
            )}
          </Button>
        }
      />
      <TooltipContent>{formatLastSaved(status?.last_saved_at)}</TooltipContent>
    </Tooltip>
  );
}
