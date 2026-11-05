"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { callApi, messageOf } from "./api";
import { InviteLinks } from "./invite-links";
import { PeopleList } from "./people-list";
import type { Sharing } from "./types";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; name: string } | null;
}

export function ShareDialog({ open, onOpenChange, project }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-[480px]">
        {open && project && (
          <ShareBody key={project.id} project={project} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type State =
  | { status: "loading" }
  | { status: "ready"; sharing: Sharing }
  | { status: "failed"; message: string };

function ShareBody({
  project,
  onClose,
}: {
  project: { id: string; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [yourUserId, setYourUserId] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const fetchSharing = useCallback(
    () =>
      callApi<Sharing>(`/api/projects/${project.id}/sharing`, {
        fallback: "Couldn't load who is in this project. Try again.",
      })
        .then((sharing): State => ({ status: "ready", sharing }))
        .catch((err: unknown): State => ({
          status: "failed",
          message: messageOf(err, "Couldn't load who is in this project. Try again."),
        })),
    [project.id],
  );

  const retry = () => {
    setState({ status: "loading" });
    void fetchSharing().then(setState);
  };

  useEffect(() => {
    let cancelled = false;
    void fetchSharing().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSharing]);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setYourUserId(data.user?.id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<Sharing>) =>
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", sharing: { ...current.sharing, ...patch } }
        : current,
    );

  const leave = async () => {
    if (!yourUserId || leaving) return;
    setLeaving(true);
    try {
      await callApi(`/api/projects/${project.id}/members/${yourUserId}`, {
        method: "DELETE",
        fallback: "Couldn't leave the project. Try again.",
      });
      toast("You left the project");
      onClose();
      router.push("/");
      router.refresh();
    } catch (err) {
      toast.error(messageOf(err, "Couldn't leave the project. Try again."));
      setLeaving(false);
    }
  };

  const sharing = state.status === "ready" ? state.sharing : null;
  const isOwner = sharing?.your_role === "owner";
  const ownerName = sharing ? sharing.owner.name.trim() || sharing.owner.email : "";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
          {isOwner || !sharing ? `Share ${project.name}` : project.name}
        </DialogTitle>
        <DialogDescription>
          {sharing && !isOwner
            ? `Shared by ${ownerName}`
            : "People in a project see the same groups and sources."}
        </DialogDescription>
      </DialogHeader>

      {state.status === "loading" && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="size-8 animate-pulse rounded-full bg-muted" />
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {state.status === "failed" && (
        <div className="space-y-3">
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
          <Button type="button" variant="outline" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {sharing && (
        <>
          <PeopleList
            projectId={project.id}
            owner={sharing.owner}
            members={sharing.members}
            yourUserId={yourUserId}
            canManage={isOwner}
            onMembersChange={(members) => update({ members })}
          />
          {isOwner && (
            <InviteLinks
              projectId={project.id}
              invites={sharing.invites}
              onChange={(invites) => update({ invites })}
            />
          )}
          {!isOwner && (
            <div className="space-y-2">
              {confirmingLeave ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-foreground">
                    Leave {project.name}? You will lose access to it.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={leaving || !yourUserId}
                    onClick={() => void leave()}
                  >
                    {leaving ? "Leaving…" : "Leave"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={leaving}
                    onClick={() => setConfirmingLeave(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setConfirmingLeave(true)}
                >
                  Leave project
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
