import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { getProjectSharing, removeMember } from "@/lib/api";
import type { Sharing } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { displayName } from "./helpers";
import { InviteLinks } from "./InviteLinks";
import { PeopleList } from "./PeopleList";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; name: string } | null;
  /** Your account id, to mark you in the list and to leave. */
  yourUserId: string | null;
  /** You left the project; the caller reloads and moves to another one. */
  onLeft: (projectId: string) => void;
}

export function ShareDialog({ open, onOpenChange, project, yourUserId, onLeft }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        {open && project && (
          <ShareBody
            key={project.id}
            project={project}
            yourUserId={yourUserId}
            onClose={() => onOpenChange(false)}
            onLeft={onLeft}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type State =
  | { status: "loading" }
  | { status: "ready"; sharing: Sharing }
  | { status: "failed"; message: string };

const LOAD_FAILED = "Couldn't load who is in this project. Try again.";

function ShareBody({
  project,
  yourUserId,
  onClose,
  onLeft,
}: {
  project: { id: string; name: string };
  yourUserId: string | null;
  onClose: () => void;
  onLeft: (projectId: string) => void;
}) {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const [confirmingLeave, setConfirmingLeave] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  const fetchSharing = React.useCallback(
    () =>
      getProjectSharing(project.id)
        .then((sharing): State => ({ status: "ready", sharing }))
        .catch((err: unknown): State => ({
          status: "failed",
          message: errorMessage(err, LOAD_FAILED),
        })),
    [project.id],
  );

  React.useEffect(() => {
    let cancelled = false;
    void fetchSharing().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSharing]);

  const retry = () => {
    setState({ status: "loading" });
    void fetchSharing().then(setState);
  };

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
      await removeMember(project.id, yourUserId);
      toast.success("You left the project");
      onClose();
      onLeft(project.id);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't leave the project. Try again."));
      setLeaving(false);
    }
  };

  const sharing = state.status === "ready" ? state.sharing : null;
  const isOwner = sharing?.your_role === "owner";

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isOwner || !sharing ? `Share ${project.name}` : project.name}</DialogTitle>
        <DialogDescription>
          {sharing && !isOwner
            ? `Shared by ${displayName(sharing.owner)}`
            : "People in a project see the same groups and sources."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {state.status === "loading" && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton size-8 rounded-full" />
                <div className="skeleton h-4 w-40 rounded" />
              </div>
            ))}
          </div>
        )}

        {state.status === "failed" && (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-destructive" role="alert">
              {state.message}
            </p>
            <Button type="button" variant="outline" className="w-fit" onClick={retry}>
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
            {!isOwner &&
              (confirmingLeave ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-foreground">
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
                  className="w-fit"
                  onClick={() => setConfirmingLeave(true)}
                >
                  Leave project
                </Button>
              ))}
          </>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
