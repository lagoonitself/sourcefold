import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { extractInviteCode } from "./helpers";
import { InviteCard } from "./InviteCard";

export interface JoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Joined (or already in): the caller reloads the projects and switches to this one. */
  onOpenProject: (projectId: string) => void | Promise<void>;
}

export function JoinDialog({ open, onOpenChange, onOpenProject }: JoinDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]">
        {open && (
          <JoinForm
            onClose={() => onOpenChange(false)}
            onOpenProject={async (projectId) => {
              await onOpenProject(projectId);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function JoinForm({
  onClose,
  onOpenProject,
}: {
  onClose: () => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  const code = extractInviteCode(value);
  const typed = value.trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Join a shared project</DialogTitle>
        <DialogDescription>Paste the link or type the code you were sent.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Link or code, for example K7QM-2XPD"
          aria-label="Invite link or code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        {code ? (
          <InviteCard key={code} code={code} onOpenProject={onOpenProject} onCancel={onClose} />
        ) : (
          typed && (
            <p className="text-[12.5px] text-muted-foreground">
              A code has 8 letters and numbers, like K7QM-2XPD.
            </p>
          )
        )}
      </div>
    </>
  );
}
