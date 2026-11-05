import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseBookmarksHtml, type ShelfLinkInput } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { shelfImportMessage } from "./shelf-format";
import type { ShelfController } from "./use-shelf";

export interface ImportBookmarksProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelf: ShelfController;
}

interface ParsedBookmarks {
  fileName: string;
  links: ShelfLinkInput[];
  folders: number;
}

/** Reads a browser's bookmarks.html export and adds its links; folder names become tags. */
export function ImportBookmarks({ open, onOpenChange, shelf }: ImportBookmarksProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        {/* Mounted on open only, so every opening starts with no file chosen. */}
        <ImportForm
          shelf={shelf}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ImportForm({
  shelf,
  onDone,
  onCancel,
}: {
  shelf: ShelfController;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [parsed, setParsed] = React.useState<ParsedBookmarks | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    setParsed(null);
    setMessage(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setMessage("Couldn't read that file. Choose it again.");
      return;
    }
    const entries = parseBookmarksHtml(text);
    if (entries.length === 0) {
      setMessage(
        "No links found in that file. Choose the bookmarks.html file your browser exported.",
      );
      return;
    }
    const folders = new Set(entries.flatMap((entry) => entry.tags.map((tag) => tag.toLowerCase())));
    setParsed({
      fileName: file.name,
      links: entries.map((entry) => ({ url: entry.url, title: entry.title, tags: entry.tags })),
      folders: folders.size,
    });
  };

  const runImport = async () => {
    if (!parsed || progress !== null) return;
    setProgress(0);
    const result = await shelf.add(parsed.links, (done) => setProgress(done));
    setProgress(null);
    if (!result) return;
    toast.success(shelfImportMessage(result.added.length, result.existing.length));
    onDone();
  };

  const total = parsed?.links.length ?? 0;
  const importing = progress !== null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import bookmarks</DialogTitle>
        <DialogDescription>
          Adds every link in a bookmarks file. Folder names become tags, and links already on your
          shelf are skipped.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              Choose bookmarks file
            </Button>
            {parsed && (
              <span className="min-w-0 truncate font-sans text-[12.5px] text-muted-foreground">
                {parsed.fileName}
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,text/html"
            aria-label="Bookmarks file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <p className="font-sans text-[12.5px] leading-[18px] text-muted-foreground">
            In Chrome: Bookmarks → Bookmark manager → ⋮ → Export bookmarks.
          </p>
        </div>

        {message && (
          <p role="alert" className="font-sans text-[13px] leading-5 text-destructive">
            {message}
          </p>
        )}

        {parsed && (
          <p
            className="font-serif text-[18px] leading-6 text-foreground tabular-nums"
            aria-live="polite"
          >
            {`Found ${total} ${total === 1 ? "link" : "links"} in ${parsed.folders} ${
              parsed.folders === 1 ? "folder" : "folders"
            }`}
          </p>
        )}
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void runImport()} disabled={!parsed || importing}>
          {importing ? (
            <>
              <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              <span className="tabular-nums">
                Importing {progress} of {total}
              </span>
            </>
          ) : (
            "Import"
          )}
        </Button>
      </DialogFooter>
    </>
  );
}
