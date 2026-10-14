"use client";

import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ItemListRow } from "./item-columns";
import { RenameItemDialog } from "./rename-item-dialog";
import { MoveItemDialog } from "./move-item-dialog";
import { NoteDialog } from "./note-dialog";
import { DeleteItemDialog } from "./delete-item-dialog";

export interface ItemMenuProps {
  item: ItemListRow;
  noteOpen?: boolean;
  onNoteOpenChange?: (open: boolean) => void;
}

export function ItemMenu({ item, noteOpen, onNoteOpenChange }: ItemMenuProps) {
  const [internalNoteOpen, setInternalNoteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isNoteOpen = noteOpen !== undefined ? noteOpen : internalNoteOpen;
  const handleOpenNote = (open: boolean) => {
    if (onNoteOpenChange) {
      onNoteOpenChange(open);
    } else {
      setInternalNoteOpen(open);
    }
  };

  const isNoteKind = item.kind === "note";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          aria-label={`Actions for ${item.title}`}
          onClick={(e) => e.stopPropagation()}
          className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              handleOpenNote(true);
            }}
          >
            {isNoteKind ? "Edit" : "Edit note"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setRenameOpen(true);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setMoveOpen(true);
            }}
          >
            Move to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {renameOpen && (
        <RenameItemDialog item={item} open={renameOpen} onOpenChange={setRenameOpen} />
      )}
      {moveOpen && <MoveItemDialog item={item} open={moveOpen} onOpenChange={setMoveOpen} />}
      {isNoteOpen && <NoteDialog item={item} open={isNoteOpen} onOpenChange={handleOpenNote} />}
      {deleteOpen && (
        <DeleteItemDialog item={item} open={deleteOpen} onOpenChange={setDeleteOpen} />
      )}
    </>
  );
}
