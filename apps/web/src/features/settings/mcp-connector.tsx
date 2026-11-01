"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return `${window.location.origin}/api/mcp`;
}

function getServerSnapshot() {
  return "";
}

export function McpConnector() {
  const url = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  async function copyUrl() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied");
    } catch {
      toast.error("Couldn't copy the connector URL. Select it and copy it instead.");
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="font-sans text-[15px] leading-[20px] font-semibold text-foreground">
        Use Sourcefold in Claude or ChatGPT on the web
      </h2>
      <p className="text-sm text-foreground">Add this connector URL in the app you use:</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="select-all break-all rounded border border-border bg-muted px-2.5 py-1 font-mono text-sm text-foreground">
          {url || "…"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copyUrl()}
          disabled={!url}
        >
          Copy
        </Button>
      </div>
      <div className="space-y-2 text-sm leading-5 text-muted-foreground">
        <p>claude.ai: Settings, Connectors, Add custom connector, then paste the URL.</p>
        <p>ChatGPT: Settings, Apps and Connectors, create a custom app, then paste the URL.</p>
        <p>
          For clients that ask for a Bearer token, create one in Settings and paste it in the
          client&apos;s authentication field.
        </p>
      </div>
    </section>
  );
}
