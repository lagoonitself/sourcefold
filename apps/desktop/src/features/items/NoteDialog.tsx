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
import { Input } from "@/components/ui/Input";
import type { Item } from "@/lib/types";
import { getItem, updateItemNote, createStandaloneNote, updateStandaloneNote } from "@/lib/api";
import { isMacPlatform } from "../shortcuts/key-utils";
import { cn } from "@/lib/utils";

export interface NoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Item | null;
  folderId?: string;
  onSaved?: () => Promise<void>;
}

export function NoteDialog({ open, onOpenChange, item, folderId, onSaved }: NoteDialogProps) {
  const isStandalone = !item || item.kind === "note";
  const isEditStandalone = Boolean(item && item.kind === "note");

  const [title, setTitle] = React.useState("");
  const [content, setContent] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const isMac = React.useMemo(() => isMacPlatform(), []);

  React.useEffect(() => {
    if (!open) return;
    if (item) {
      if (item.kind === "note") {
        setTitle(item.title);
        setContent(item.markdown || item.note || "");
      } else {
        setTitle(item.title);
        setContent(item.note || "");
      }

      // In remote mode, note or markdown may not be present in item summaries
      if (item.id && (!item.markdown || !item.note)) {
        getItem(item.id)
          .then((full) => {
            if (full && full.id === item.id) {
              if (full.title) setTitle(full.title);
              if (full.kind === "note") {
                setContent(full.markdown || full.note || "");
              } else {
                setContent(full.note || "");
              }
            }
          })
          .catch(() => {});
      }
    } else {
      setTitle("");
      setContent("");
    }
  }, [open, item]);

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (item) {
        if (item.kind === "note") {
          // Standalone note: keep title + markdown/body in sync
          const nextTitle = title.trim() || item.title;
          await updateStandaloneNote(item.id, nextTitle, content);
        } else {
          // Attached note on existing item
          await updateItemNote(item.id, content.trim() ? content.trim() : null);
        }
        toast.success("Note saved");
      } else {
        // Standalone note creation
        if (!folderId) {
          throw new Error("Select an active group before creating a note");
        }
        const nextTitle = title.trim() || "Untitled note";
        await createStandaloneNote(folderId, nextTitle, content);
        toast.success("Note created");
      }
      onOpenChange(false);
      if (onSaved) await onSaved();
    } catch (err: any) {
      toast.error(err.message || "Failed to save note");
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s" || e.key === "Enter")) {
      e.preventDefault();
      void handleSave();
    }
  };

  const saveHint = isMac ? "⌘Enter or ⌘S to save" : "Ctrl+Enter or Ctrl+S to save";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            {!item ? "New note" : isEditStandalone ? "Edit note" : "Item note"}
          </DialogTitle>
          <DialogDescription>
            {item && !isEditStandalone
              ? `Personal note for "${item.title}" (${saveHint})`
              : `Write in Markdown. (${saveHint})`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {(!item || isEditStandalone) && (
            <div>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title"
                disabled={isSaving}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleSave();
                  }
                }}
              />
            </div>
          )}

          <div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write thoughts, quotes, or markdown highlights here..."
              rows={10}
              autoFocus={Boolean(item && !isEditStandalone)}
              disabled={isSaving}
              className={cn(
                "flex min-h-[140px] w-full resize-y rounded-[9px] border border-input bg-background p-3 text-[13.5px] text-foreground font-sans leading-relaxed",
                "transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80",
                "hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none",
                "disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.03]",
              )}
            />
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between mt-4">
          <span className="text-[12px] text-muted-foreground">{saveHint}</span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save note"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
