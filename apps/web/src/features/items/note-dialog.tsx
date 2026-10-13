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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ItemListRow } from "./item-columns";

export interface NoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: ItemListRow;
  folderId?: string;
}

export function NoteDialog({ open, onOpenChange, item, folderId }: NoteDialogProps) {
  const router = useRouter();

  const isStandalone = !item || item.kind === "note";
  const isEdit = Boolean(item && item.kind === "note");

  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [itemNote, setItemNote] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let isMounted = true;

    if (!isStandalone && item) {
      queueMicrotask(() => {
        if (isMounted) {
          setItemNote(item.note ?? "");
        }
      });
    } else if (isEdit && item) {
      queueMicrotask(() => {
        if (isMounted) {
          setTitle(item.title);
          setMarkdown("");
          setIsLoadingContent(true);
        }
      });

      fetch(`/api/items/${item.id}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load note content");
          return res.json();
        })
        .then((json) => {
          if (isMounted && json.data) {
            setTitle(json.data.title ?? item.title);
            setMarkdown(json.data.markdown ?? "");
          }
        })
        .catch(() => {
          if (isMounted) {
            toast.error("Couldn't load note content. Try again.");
          }
        })
        .finally(() => {
          if (isMounted) {
            setIsLoadingContent(false);
          }
        });
    } else {
      // Create mode
      queueMicrotask(() => {
        if (isMounted) {
          setTitle("");
          setMarkdown("");
          setIsLoadingContent(false);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [open, isStandalone, isEdit, item]);

  const handleSave = async () => {
    if (isSaving || isLoadingContent) return;

    if (!isStandalone && item) {
      // (a) Item note: Save PATCHes { note }
      setIsSaving(true);
      try {
        const trimmed = itemNote.trim();
        const res = await fetch(`/api/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: trimmed === "" ? null : trimmed }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't save note. Try again.");
          return;
        }
        toast("Note saved");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Couldn't save note. Try again.");
      } finally {
        setIsSaving(false);
      }
    } else if (isEdit && item) {
      // (b) Standalone note edit: PATCHes { title, markdown }
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;

      setIsSaving(true);
      try {
        const res = await fetch(`/api/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmedTitle, markdown }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't save note. Try again.");
          return;
        }
        toast("Note saved");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Couldn't save note. Try again.");
      } finally {
        setIsSaving(false);
      }
    } else {
      // (b) Standalone note create: POSTs /api/notes
      const trimmedTitle = title.trim();
      if (!trimmedTitle || !folderId) return;

      setIsSaving(true);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder_id: folderId, title: trimmedTitle, markdown }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error?.message ?? "Couldn't create note. Try again.");
          return;
        }
        toast("Note created");
        onOpenChange(false);
        router.refresh();
      } catch {
        toast.error("Couldn't create note. Try again.");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSave();
    }
  };

  const dialogTitle = !isStandalone ? "Note" : isEdit ? "Edit note" : "New note";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(isStandalone ? "sm:max-w-[720px]" : "sm:max-w-[560px]")}
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
            {dialogTitle}
          </DialogTitle>
        </DialogHeader>

        {!isStandalone ? (
          <div className="flex flex-col gap-4">
            <textarea
              value={itemNote}
              onChange={(e) => setItemNote(e.target.value)}
              placeholder="Add your note here..."
              rows={8}
              disabled={isSaving}
              autoFocus
              className="min-h-[200px] w-full resize-y rounded-[6px] border border-input bg-transparent p-3 font-sans text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isLoadingContent ? (
              <div className="flex flex-col gap-3 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : (
              <>
                <div>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Note title"
                    maxLength={500}
                    autoFocus
                    disabled={isSaving}
                  />
                </div>
                <div>
                  <textarea
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    placeholder="Write Markdown here..."
                    rows={12}
                    disabled={isSaving}
                    className="min-h-[320px] w-full resize-y rounded-[6px] border border-input bg-transparent p-3 font-sans text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={
              isSaving ||
              isLoadingContent ||
              (isStandalone && !title.trim()) ||
              (!isStandalone && !item)
            }
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
