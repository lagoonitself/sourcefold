import * as React from "react";
import { Check, Copy, Film, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  buildBrollList,
  orderBrollClips,
  sortSections,
  type Card,
  type CardInput,
} from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Folder, Item } from "@/lib/types";
import { buildSourceDirectory } from "../project-data/project-data-model";
import type { ProjectData } from "../project-data/use-project-data";
import { MoveCardDialog } from "../outline/MoveCardDialog";
import { ViewHeader, ViewSkeleton } from "../shared/ViewHeader";
import { useCopied } from "../shared/use-copied";
import { AddClipDialog } from "./AddClipDialog";
import { BrollRow } from "./BrollRow";

export interface BrollViewProps {
  project: Folder | undefined;
  data: ProjectData;
  isFocusedRegion?: boolean;
  onOpenReader?: (item: Item) => void;
}

export function BrollView({ project, data }: BrollViewProps) {
  const { cards, sections: rawSections, items, loading } = data;
  const sections = React.useMemo(() => sortSections(rawSections), [rawSections]);
  const sourceDirectory = React.useMemo(() => buildSourceDirectory(items), [items]);
  const itemsById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [addClipOpen, setAddClipOpen] = React.useState(false);
  const [movingCard, setMovingCard] = React.useState<Card | null>(null);

  const clips = React.useMemo(() => {
    return orderBrollClips(cards, sections);
  }, [cards, sections]);

  const { copied, copy } = useCopied();

  const handleCopyList = () => {
    const markdown = buildBrollList(project?.name ?? "Untitled", clips, sourceDirectory);
    void copy(markdown);
  };

  const handleCreateClip = async (input: CardInput): Promise<boolean> => {
    const created = await data.createCard(input);
    if (created) {
      toast.success("B-roll clip added");
      return true;
    }
    return false;
  };

  const handleDeleteClip = async (card: Card) => {
    const ok = await data.removeCard(card.id);
    if (!ok) return;
    toast("Clip deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          void data.createCard({
            ...card,
          });
        },
      },
    });
  };

  const summary = `${clips.length} ${clips.length === 1 ? "clip" : "clips"}`;

  return (
    <div className="@container/view flex min-h-0 flex-1 flex-col px-5 pt-7 @[720px]/view:px-9 @[720px]/view:pt-9">
      <ViewHeader
        title="B-roll"
        summary={summary}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyList}
              disabled={clips.length === 0}
            >
              {copied ? (
                <Check className="size-3.5 text-green-600" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              <span>{copied ? "Copied list" : "Copy list"}</span>
            </Button>
            <Button size="sm" onClick={() => setAddClipOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Add clip</span>
            </Button>
          </div>
        }
      />

      {loading && clips.length === 0 ? (
        <ViewSkeleton label="Loading B-roll clips..." />
      ) : clips.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No B-roll clips yet"
          description="Add clips from YouTube videos or links to plan what to show during your script."
          actions={
            <Button onClick={() => setAddClipOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Add clip
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
          <div className="space-y-1">
            {clips.map((clip) => (
              <BrollRow
                key={clip.id}
                card={clip}
                itemsById={itemsById}
                sections={sections}
                onPatchCard={data.patchCard}
                onPlaceInOutline={(card) => setMovingCard(card)}
                onDelete={handleDeleteClip}
              />
            ))}
          </div>
        </div>
      )}

      <AddClipDialog
        open={addClipOpen}
        onOpenChange={setAddClipOpen}
        projectId={project?.id ?? ""}
        items={items}
        onCreateClip={handleCreateClip}
      />

      <MoveCardDialog
        card={movingCard}
        sections={sections}
        onPick={(sectionId) => {
          if (movingCard) {
            void data.patchCard(movingCard.id, { section_id: sectionId });
          }
        }}
        onClose={() => setMovingCard(null)}
      />
    </div>
  );
}
