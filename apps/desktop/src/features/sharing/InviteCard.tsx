import * as React from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { acceptInvite, getInvitePreview } from "@/lib/api";
import type { InvitePreview } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { displayName, joinAsText, peopleCount } from "./helpers";

type State =
  | { status: "loading" }
  | { status: "ready"; preview: InvitePreview }
  | { status: "failed"; message: string };

/** "<Project>, shared by <owner>, 3 people. You'll join as an editor." */
export function InvitePreviewSummary({ preview }: { preview: InvitePreview }) {
  const alreadyIn = preview.your_role !== null;
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-border bg-muted/50 p-3">
      <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex flex-col gap-0.5">
        <p className="truncate font-serif text-[17px] font-medium leading-6 text-foreground">
          {preview.project_name}
        </p>
        <p className="text-[12.5px] leading-[18px] text-muted-foreground">
          Shared by {displayName(preview.owner)}, {peopleCount(preview.member_count)}.{" "}
          {alreadyIn ? "You're already in this project." : joinAsText(preview.role)}
        </p>
      </div>
    </div>
  );
}

export interface InviteCardProps {
  code: string;
  /** Joined, or already in the project: open it. */
  onOpenProject: (projectId: string) => void | Promise<void>;
  onCancel: () => void;
}

/** Previews a shared project from its code and joins it. */
export function InviteCard({ code, onOpenProject, onCancel }: InviteCardProps) {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const [joining, setJoining] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    getInvitePreview(code)
      .then((preview) => {
        if (!cancelled) setState({ status: "ready", preview });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "failed",
          message: errorMessage(err, "Couldn't look up that link. Try again."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    try {
      const result = await acceptInvite(code);
      toast.success("Joined the project");
      await onOpenProject(result.project_id);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't join the project. Try again."));
      setJoining(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Looking up the project">
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-4 w-full rounded" />
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <p className="text-[13px] text-destructive" role="alert">
        {state.message}
      </p>
    );
  }

  const { preview } = state;
  const alreadyIn = preview.your_role !== null;

  return (
    <div className="flex flex-col gap-4">
      <InvitePreviewSummary preview={preview} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={joining}>
          Cancel
        </Button>
        {alreadyIn ? (
          <Button type="button" onClick={() => void onOpenProject(preview.project_id)}>
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
