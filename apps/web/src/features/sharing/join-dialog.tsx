"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extractInviteCode } from "./helpers";
import { InviteCard } from "./invite-card";

export function JoinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        {open && <JoinForm onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function JoinForm({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  const code = extractInviteCode(value);
  const typed = value.trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
          Join a shared project
        </DialogTitle>
        <DialogDescription>Paste the link or type the code you were sent.</DialogDescription>
      </DialogHeader>
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
        <InviteCard key={code} code={code} onDone={onClose} onCancel={onClose} />
      ) : (
        typed && (
          <p className="text-[13px] text-muted-foreground">
            A code has 8 letters and numbers, like K7QM-2XPD.
          </p>
        )
      )}
    </>
  );
}
