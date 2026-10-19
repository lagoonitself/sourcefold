import { Check, Inbox, ListTree } from "lucide-react";
import type { Card, OutlineSection } from "@sourcefold/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

export interface MoveCardDialogProps {
  /** The card to move; the dialog is open while there is one. */
  card: Card | null;
  sections: readonly OutlineSection[];
  /** A section id, or null for the card pile. */
  onPick: (sectionId: string | null) => void;
  onClose: () => void;
}

/** "Move to section": the sections in order, and the card pile at the top. */
export function MoveCardDialog({ card, sections, onPick, onClose }: MoveCardDialogProps) {
  const options: { id: string | null; title: string; icon: typeof Inbox }[] = [
    { id: null, title: "Card pile", icon: Inbox },
    ...sections.map((s) => ({ id: s.id, title: s.title, icon: ListTree })),
  ];
  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Move to section</DialogTitle>
          <DialogDescription>The card goes to the end of the section you pick.</DialogDescription>
        </DialogHeader>
        <div role="menu" className="-mx-2 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto px-2">
          {options.map((option) => {
            const current = (card?.section_id ?? null) === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id ?? "pile"}
                type="button"
                role="menuitem"
                onClick={() => onPick(option.id)}
                className={cn(
                  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13.5px] text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  current && "bg-accent",
                )}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{option.title}</span>
                {current && (
                  <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
