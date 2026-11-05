"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rememberProject } from "@/features/projects/project";
import { ApiError, callApi, messageOf } from "./api";
import { joinAsText, peopleCount } from "./helpers";
import type { InvitePreview } from "./types";

type State =
  | { status: "loading" }
  | { status: "ready"; preview: InvitePreview }
  | { status: "failed"; message: string };

/** Previews a shared project from its code and joins it. Used by the dialog and the /join page. */
export function InviteCard({
  code,
  onDone,
  onCancel,
}: {
  code: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    callApi<InvitePreview>(`/api/invites/${code}`, {
      fallback: "Couldn't look up that link. Try again.",
    })
      .then((preview) => {
        if (!controller.signal.aborted) setState({ status: "ready", preview });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "failed",
          message:
            err instanceof ApiError && err.status === 404
              ? "That link or code doesn't work. Ask for a new one."
              : messageOf(err, "Couldn't look up that link. Try again."),
        });
      });
    return () => controller.abort();
  }, [code]);

  const open = (projectId: string) => {
    rememberProject(projectId);
    router.push(`/?folder=${projectId}`);
    router.refresh();
    onDone?.();
  };

  const join = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const result = await callApi<{ project_id: string }>(`/api/invites/${code}/accept`, {
        method: "POST",
        fallback: "Couldn't join the project. Try again.",
      });
      toast("Joined the project");
      open(result.project_id);
    } catch (err) {
      toast.error(messageOf(err, "Couldn't join the project. Try again."));
      setJoining(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Looking up the project">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {state.message}
      </p>
    );
  }

  const { preview } = state;
  const alreadyIn = preview.your_role !== null;
  const owner = preview.owner.name.trim() || preview.owner.email;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-serif text-[18px] leading-[24px] font-semibold text-foreground">
            {preview.project_name}
          </p>
          <p className="text-[13px] leading-5 text-muted-foreground">
            Shared by {owner}, {peopleCount(preview.member_count)}.{" "}
            {alreadyIn ? "You're already in this project." : joinAsText(preview.role)}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={joining}>
            Cancel
          </Button>
        )}
        {alreadyIn ? (
          <Button type="button" onClick={() => open(preview.project_id)}>
            Open
          </Button>
        ) : (
          <Button type="button" onClick={() => void join()} disabled={joining}>
            {joining ? "Joining…" : "Join"}
          </Button>
        )}
      </div>
    </div>
  );
}
