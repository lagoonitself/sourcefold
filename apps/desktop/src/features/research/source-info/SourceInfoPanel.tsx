import * as React from "react";
import { toast } from "sonner";
import type { ItemResearchPatch } from "@sourcefold/core";
import { cn } from "@/lib/utils";
import { AuthorEditor } from "./AuthorEditor";
import { SummaryEditor } from "./SummaryEditor";
import { TagEditor } from "./TagEditor";
import { TriageButtons } from "./triage";
import { addTag, removeTag, type ResearchItem } from "./research-logic";
import { useProjectTagData } from "./use-project-info";

/** Lets the reader's keys (`t`, `u`) reach into the panel: raise a number to ask. */
export interface SourceInfoSignals {
  tags: number;
  summary: number;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div className="pt-1.5 font-sans text-[12px] font-medium leading-5 text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </>
  );
}

/**
 * The compact source panel under the reader's title: status, tags, author with its type, and the
 * summary. Every change goes out through `onUpdate`, which shows it at once and saves it.
 */
export function SourceInfoPanel({
  item,
  projectId,
  onUpdate,
  signals,
  className,
}: {
  item: ResearchItem;
  projectId: string | null;
  onUpdate: (patch: ItemResearchPatch) => void;
  signals?: SourceInfoSignals;
  className?: string;
}) {
  const [tagsTouched, setTagsTouched] = React.useState(false);
  const tagData = useProjectTagData(projectId, tagsTouched);
  const tagInputRef = React.useRef<HTMLInputElement>(null);
  const tags = item.tags ?? [];
  const tagsSignal = signals?.tags ?? 0;
  const handledTags = React.useRef(tagsSignal);

  React.useEffect(() => {
    if (tagsSignal === handledTags.current) return;
    handledTags.current = tagsSignal;
    setTagsTouched(true);
    tagInputRef.current?.focus();
  }, [tagsSignal]);

  const add = (tag: string) => {
    const result = addTag(tags, tag);
    if (result.ok) onUpdate({ tags: result.tags });
    else toast.error(result.reason);
  };

  return (
    <section
      aria-label="Source details"
      data-reader-ui
      className={cn(
        "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 select-text font-sans",
        className,
      )}
    >
      <Row label="Status">
        <TriageButtons value={item.triage} onChange={(triage) => onUpdate({ triage })} />
      </Row>

      <Row label="Tags">
        <div onFocusCapture={() => setTagsTouched(true)}>
          <TagEditor
            tags={tags}
            data={tagData}
            inputRef={tagInputRef}
            onAdd={add}
            onRemove={(tag) => onUpdate({ tags: removeTag(tags, tag) })}
            onEscape={() => tagInputRef.current?.blur()}
            placeholder="Add a tag, such as an outline section"
          />
        </div>
      </Row>

      <Row label="Author">
        <AuthorEditor
          item={item}
          onAuthor={(author) => onUpdate({ author })}
          onAuthorType={(author_type) => onUpdate({ author_type })}
        />
      </Row>

      <Row label="Summary">
        <SummaryEditor
          value={item.summary}
          editSignal={signals?.summary ?? 0}
          onSave={(summary) => onUpdate({ summary })}
          className="-mx-2.5"
        />
      </Row>
    </section>
  );
}
