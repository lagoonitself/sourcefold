"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NoteDialog } from "./note-dialog";

export interface NewNoteButtonProps {
  folderId: string;
}

export function NewNoteButton({ folderId }: NewNoteButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        New note
      </Button>
      <NoteDialog open={open} onOpenChange={setOpen} folderId={folderId} />
    </>
  );
}
