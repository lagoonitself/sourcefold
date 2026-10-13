"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return window.location.origin;
}

function getServerSnapshot() {
  return "";
}

export function SettingsAppAddress() {
  const origin = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const handleCopy = async () => {
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(origin);
      toast("Copied");
    } catch {
      toast.error("Couldn't copy address. Try again.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm text-foreground bg-muted px-2.5 py-1 rounded border border-border select-all">
        {origin || "…"}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={handleCopy} disabled={!origin}>
        Copy
      </Button>
    </div>
  );
}
