"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
  const [isLoadError, setIsLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const itemId = item?.id;
  const prevOpenRef = useRef(false);
  const prevItemIdRef = useRef<string | undefined>(undefined);
  const itemRef = useRef(item);

  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    const prevItemId = prevItemIdRef.current;
    prevOpenRef.current = open;
    prevItemIdRef.current = itemId;

    if (!open) return;

    const justOpened = !wasOpen;
    const itemChanged = itemId !== prevItemId;

    if (!justOpened && !itemChanged) {
      return;
    }

    const currentItem = itemRef.current;
    const isStandaloneMode = !currentItem || currentItem.kind === "note";
    const isEditMode = Boolean(currentItem && currentItem.kind === "note");

    const controller = new AbortController();

    if (!isStandaloneMode && currentItem) {
      setItemNote(currentItem.note ?? "");
      setIsLoadError(false);
      setIsLoadingContent(false);
    } else if (isEditMode && currentItem) {
      setTitle(currentItem.title);
      setMarkdown("");
      setIsLoadingContent(true);
      setIsLoadError(false);

      fetch(`/api/items/${currentItem.id}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load note content");
          return res.json();
        })
        .then((json) => {
          if (controller.signal.aborted) return;
          if (json.data) {
            setTitle(json.data.title ?? currentItem.title);
            setMarkdown(json.data.markdown ?? "");
            setIsLoadError(false);
          }
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === "AbortError") return;
          setIsLoadError(true);
          toast.error("Couldn't load note content. Try again.");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingContent(false);
          }
        });
    } else {
      // Create mode
      setTitle("");
      setMarkdown("");
      setItemNote("");
      setIsLoadingContent(false);
      setIsLoadError(false);
    }

    return () => {
      controller.abort();
    };
  }, [open, itemId]);

  const handleSave = async () => {
    if (isSaving || isLoadingContent || isLoadError) return;

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
          body: JSON.stringify({
            title: trimmedTitle,
            markdown,
          }),
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
      // (c) Standalone note create: POSTs to /api/notes
      const trimmedTitle = title.trim();
      if (!trimmedTitle) return;

      setIsSaving(true);
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: trimmedTitle,
            markdown: markdown.trim() === "" ? null : markdown,
            folder_id: folderId,
          }),
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
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation?.();
      void handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {!isStandalone ? "Edit note" : isEdit ? "Edit note" : "New note"}
          </DialogTitle>
          <DialogDescription>
            {!isStandalone
              ? `Personal note on \u201c${item?.title ?? ""}\u201d`
              : isEdit
                ? "Edit your standalone note."
                : "Create a standalone note."}
          </DialogDescription>
        </DialogHeader>

        {!isStandalone ? (
          <div>
            <textarea
              value={itemNote}
              onChange={(e) => setItemNote(e.target.value)}
              placeholder="Add your thoughts or highlights..."
              rows={8}
              autoFocus
              disabled={isSaving}
              className="w-full resize-y rounded-[6px] border border-input bg-transparent p-3 font-sans text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ) : (
          <div className="space-y-3">
            {isLoadingContent ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Loading content...
              </div>
            ) : isLoadError ? (
              <div className="py-8 text-center text-sm text-destructive">
                Failed to load note content. Please close and try again.
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
              isLoadError ||
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
