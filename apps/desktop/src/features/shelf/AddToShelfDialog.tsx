import * as React from "react";
import { toast } from "sonner";
import { parseShelfTagsText, shelfTitleFallback, type ShelfLinkInput } from "@sourcefold/core";
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
import { planShelfAdd, shelfAddMessage } from "./shelf-format";
import { ShelfField, shelfTextareaClass } from "./ShelfField";
import type { ShelfController } from "./use-shelf";

export interface AddToShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelf: ShelfController;
}

/** Add one link with a title, note and tags, or several pasted links (one per line) at once. */
export function AddToShelfDialog({ open, onOpenChange, shelf }: AddToShelfDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        {/* Mounted on open only, so every opening starts with an empty form. */}
        <AddForm
          shelf={shelf}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function AddForm({
  shelf,
  onDone,
  onCancel,
}: {
  shelf: ShelfController;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [addressText, setAddressText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [tagsText, setTagsText] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const plan = React.useMemo(() => planShelfAdd(addressText), [addressText]);
  const several = plan.urls.length > 1;
  const single = plan.urls.length === 1 ? plan.urls[0] : null;
  const canSubmit = plan.urls.length > 0 && !plan.error && !saving;
  const error = addressText.trim() ? plan.error : null;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const tags = parseShelfTagsText(tagsText);
    const inputs: ShelfLinkInput[] = several
      ? plan.urls.map((url) => ({ url, tags }))
      : [
          {
            url: single ?? "",
            title: title.trim() || shelfTitleFallback(single ?? ""),
            note: note.trim(),
            tags,
          },
        ];
    const result = await shelf.add(inputs);
    setSaving(false);
    // A failure is already a toast; the dialog stays open with what was typed.
    if (!result) return;
    toast.success(shelfAddMessage(result));
    onDone();
  };

  const onAddressKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const button = several ? `Add ${plan.urls.length} links` : "Add to shelf";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add to shelf</DialogTitle>
        <DialogDescription>
          Keep a site you visit often, with a note on it. Nothing is downloaded.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <ShelfField
          id="shelf-add-address"
          label="Address"
          error={error}
          hint={error ? undefined : "Paste several links, one per line, to add them all."}
        >
          <textarea
            id="shelf-add-address"
            rows={2}
            autoFocus
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            onKeyDown={onAddressKeyDown}
            placeholder="https://"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "shelf-add-address-error" : undefined}
            spellCheck={false}
            className={cn(shelfTextareaClass, "min-h-9 py-2")}
          />
        </ShelfField>

        {!several && (
          <ShelfField id="shelf-add-title" label="Title">
            <Input
              id="shelf-add-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={single ? shelfTitleFallback(single) : "Site name"}
            />
          </ShelfField>
        )}

        {!several && (
          <ShelfField id="shelf-add-note" label="Note">
            <textarea
              id="shelf-add-note"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why you keep it, what to look for there"
              className={cn(shelfTextareaClass, "py-2")}
            />
          </ShelfField>
        )}

        <ShelfField id="shelf-add-tags" label="Tags">
          <Input
            id="shelf-add-tags"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="Comma separated"
          />
        </ShelfField>

        <DialogFooter className="mt-1">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {saving ? "Adding…" : button}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
