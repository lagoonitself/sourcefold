import * as React from "react";
import type { ShelfLink } from "@sourcefold/core";
import { AddToShelfDialog } from "./AddToShelfDialog";
import { EditShelfLinkDialog } from "./EditShelfLinkDialog";
import { ImportBookmarks } from "./ImportBookmarks";
import type { ShelfController } from "./use-shelf";

/** Which shelf dialog is open, and for which link. Null when none is. */
export type ShelfDialogState =
  { kind: "add" } | { kind: "edit"; link: ShelfLink } | { kind: "import" } | null;

export interface ShelfDialogsProps {
  shelf: ShelfController;
  state: ShelfDialogState;
  onStateChange: (state: ShelfDialogState) => void;
}

/** The three shelf dialogs, mounted once by the app and driven by one piece of state. */
export function ShelfDialogs({ shelf, state, onStateChange }: ShelfDialogsProps) {
  const [editLink, setEditLink] = React.useState<ShelfLink | null>(null);
  if (state?.kind === "edit" && state.link !== editLink) setEditLink(state.link);

  const close = (open: boolean) => {
    if (!open) onStateChange(null);
  };

  return (
    <>
      <AddToShelfDialog
        open={state?.kind === "add"}
        onOpenChange={(open) => onStateChange(open ? { kind: "add" } : null)}
        shelf={shelf}
      />
      <EditShelfLinkDialog
        open={state?.kind === "edit"}
        onOpenChange={close}
        link={editLink}
        shelf={shelf}
      />
      <ImportBookmarks
        open={state?.kind === "import"}
        onOpenChange={(open) => onStateChange(open ? { kind: "import" } : null)}
        shelf={shelf}
      />
    </>
  );
}
