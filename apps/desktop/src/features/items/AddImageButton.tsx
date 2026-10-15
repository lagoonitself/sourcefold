import * as React from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { isAnyDialogOpen } from "@/components/ui/Dialog";
import { addImage } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { isTypingContext } from "../shortcuts/key-utils";
import { onGroupAction } from "./group-actions";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB, same as the web app
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface AddImageButtonProps {
  folderId: string;
  /** Lets the `i` shortcut work while the source list has keyboard focus. */
  isFocusedRegion: boolean;
  onAdded: () => Promise<void>;
}

/** Adds picked images to the group: on this computer offline, in the account when signed in. */
export function AddImageButton({ folderId, isFocusedRegion, onAdded }: AddImageButtonProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<{ current: number; total: number } | null>(null);
  const uploading = progress !== null;

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFocusedRegion || isTypingContext(e.target) || isAnyDialogOpen()) return;
      if (e.key === "i" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!uploading) openPicker();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocusedRegion, openPicker, uploading]);

  React.useEffect(
    () =>
      onGroupAction((action) => {
        if (action === "add-image" && !uploading) openPicker();
      }),
    [openPicker, uploading],
  );

  const uploadFiles = async (files: File[]) => {
    let added = 0;
    setProgress({ current: 0, total: files.length });
    try {
      for (const [index, file] of files.entries()) {
        try {
          if (file.size > MAX_FILE_SIZE) {
            toast.error("Images can be up to 10 MB.");
          } else if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            toast.error("Upload a PNG, JPEG, GIF or WebP image.");
          } else {
            await addImage(folderId, file);
            added++;
          }
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't add that image. Try again."));
        }
        setProgress({ current: index + 1, total: files.length });
      }
    } finally {
      setProgress(null);
    }
    if (added === 1) toast.success("Added image");
    else if (added > 1) toast.success(`Added ${added} images`);
    if (added > 0) await onAdded();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) void uploadFiles(files);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={openPicker}
        title="Add image (i)"
      >
        <ImagePlus className="size-3.5" aria-hidden="true" />
        <span>{progress ? `Adding ${progress.current} of ${progress.total}…` : "Add image"}</span>
        {!uploading && <Kbd>i</Kbd>}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </>
  );
}
