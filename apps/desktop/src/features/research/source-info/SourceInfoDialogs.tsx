import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { SummaryField } from "./SummaryEditor";
import { TagEditor } from "./TagEditor";
import { commonTags, type ResearchItem } from "./research-logic";
import { useProjectTagData } from "./use-project-info";

/**
 * The tags editor the list opens with `t`. With several sources, tags added go on all of them,
 * and the chips are the tags every one of them has (removing one takes it off all of them).
 */
export function TagsDialog({
  open,
  onOpenChange,
  targets,
  projectId,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sources as shown now, so chips follow each change. */
  targets: ResearchItem[];
  projectId: string | null;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const data = useProjectTagData(projectId, open);
  const many = targets.length > 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{many ? `Tags for ${targets.length} sources` : "Tags"}</DialogTitle>
          <DialogDescription>
            {many
              ? "A tag you add goes on every selected source. The tags shown are on all of them."
              : (targets[0]?.title ?? "")}
          </DialogDescription>
        </DialogHeader>
        <TagEditor
          tags={commonTags(targets)}
          data={data}
          autoFocus
          onAdd={onAdd}
          onRemove={onRemove}
          onEscape={() => onOpenChange(false)}
          placeholder="Add a tag, such as an outline section"
        />
      </DialogContent>
    </Dialog>
  );
}

/** The summary editor the list opens with `u`. */
export function SummaryDialog({
  open,
  onOpenChange,
  item,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ResearchItem | null;
  onSave: (summary: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Summary</DialogTitle>
          <DialogDescription>{item?.title ?? ""}</DialogDescription>
        </DialogHeader>
        {open && item && (
          <SummaryField
            key={item.id}
            initial={item.summary}
            buttons
            minRows={5}
            onSave={(text) => {
              onSave(text.trim() ? text.trim() : null);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
