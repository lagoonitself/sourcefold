"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ItemListRow } from "./item-columns";

export interface RenameItemDialogProps {
  item: ItemListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameItemDialog({ item, open, onOpenChange }: RenameItemDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState(item.title);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setTitle(item.title);
      });
    }
  }, [open, item.title]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isSaving) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't rename this item. Try again.");
        return;
      }
      toast("Renamed");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Couldn't rename this item. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
            Rename
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={500}
              autoFocus
              disabled={isSaving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !title.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
