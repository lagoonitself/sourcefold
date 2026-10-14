"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  placeholder: string;
  submitLabel: string;
  initialValue?: string;
  /** Resolves true when the name was saved and the dialog can close. */
  onSubmit: (name: string) => Promise<boolean>;
}

export function NameDialog({ open, onOpenChange, ...props }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        {open && <NameForm {...props} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  description,
  placeholder,
  submitLabel,
  initialValue = "",
  onSubmit,
  onClose,
}: Omit<NameDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const [name, setName] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    const saved = await onSubmit(trimmed);
    setIsSaving(false);
    if (saved) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
          {title}
        </DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          maxLength={200}
          autoFocus
          disabled={isSaving}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving || !name.trim()}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
