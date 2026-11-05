import * as React from "react";
import { toast } from "sonner";
import {
  normalizeShelfUrl,
  parseShelfTagsText,
  shelfTitleFallback,
  type ShelfLink,
} from "@sourcefold/core";
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
import { cn } from "@/lib/utils";
import { ShelfField, shelfTextareaClass } from "./ShelfField";
import type { ShelfController } from "./use-shelf";

export interface EditShelfLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link being edited. Kept after the dialog closes so its fade-out doesn't empty it. */
  link: ShelfLink | null;
  shelf: ShelfController;
}

export function EditShelfLinkDialog({ open, onOpenChange, link, shelf }: EditShelfLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        {link && (
          <EditForm
            key={link.id}
            link={link}
            shelf={shelf}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  link,
  shelf,
  onDone,
  onCancel,
}: {
  link: ShelfLink;
  shelf: ShelfController;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = React.useState(link.url);
  const [title, setTitle] = React.useState(link.title);
  const [note, setNote] = React.useState(link.note);
  const [tagsText, setTagsText] = React.useState(link.tags.join(", "));
  const [saving, setSaving] = React.useState(false);
  const [urlError, setUrlError] = React.useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextUrl = normalizeShelfUrl(url);
    if (!nextUrl) {
      setUrlError("That doesn't look like a web address. Start it with https://.");
      return;
    }
    setUrlError(null);
    setSaving(true);
    const saved = await shelf.update(link.id, {
      url: nextUrl,
      title: title.trim() || shelfTitleFallback(nextUrl),
      note: note.trim(),
      tags: parseShelfTagsText(tagsText),
    });
    setSaving(false);
    // A failure is already a toast; the dialog stays open with the changes.
    if (!saved) return;
    toast.success("Saved to shelf");
    onDone();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit link</DialogTitle>
        <DialogDescription>Changes show on your shelf as soon as you save.</DialogDescription>
      </DialogHeader>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <ShelfField id="shelf-edit-address" label="Address" error={urlError}>
          <Input
            id="shelf-edit-address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            spellCheck={false}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? "shelf-edit-address-error" : undefined}
          />
        </ShelfField>

        <ShelfField id="shelf-edit-title" label="Title">
          <Input
            id="shelf-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={shelfTitleFallback(url)}
          />
        </ShelfField>

        <ShelfField id="shelf-edit-note" label="Note">
          <textarea
            id="shelf-edit-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={cn(shelfTextareaClass, "py-2")}
          />
        </ShelfField>

        <ShelfField id="shelf-edit-tags" label="Tags">
          <Input
            id="shelf-edit-tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="Comma separated"
          />
        </ShelfField>

        <DialogFooter className="mt-1">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
