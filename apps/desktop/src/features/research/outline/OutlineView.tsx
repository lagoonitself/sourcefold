import * as React from "react";
import { motion } from "motion/react";
import type { Card } from "@sourcefold/core";
import type { Folder, Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProjectData } from "../project-data/use-project-data";
import { ViewHeader, ViewSkeleton } from "../shared/ViewHeader";
import { CardsMode } from "./CardsMode";
import { ScriptMode } from "./ScriptMode";

export type OutlineMode = "cards" | "script";

interface OutlineTab {
  id: OutlineMode;
  label: string;
  count?: number;
}

export interface OutlineViewProps {
  project: Folder | undefined;
  data: ProjectData;
  isFocusedRegion: boolean;
  onOpenCard: (card: Card) => void;
  onOpenSource: (item: Item) => void;
}

export function OutlineView({
  project,
  data,
  isFocusedRegion,
  onOpenCard,
  onOpenSource,
}: OutlineViewProps) {
  const [mode, setMode] = React.useState<OutlineMode>("cards");
  const { cards, sections, loading } = data;

  const summary = `${cards.length} ${cards.length === 1 ? "card" : "cards"} across ${sections.length} ${sections.length === 1 ? "section" : "sections"}`;

  const tabs: readonly OutlineTab[] = [
    { id: "cards", label: "Cards", count: cards.length },
    { id: "script", label: "Script" },
  ];

  return (
    <div className="@container/view flex min-h-0 flex-1 flex-col px-5 pt-7 @[720px]/view:px-9 @[720px]/view:pt-9">
      <ViewHeader title="Outline" summary={summary}>
        <div
          role="tablist"
          aria-label="Outline view mode"
          className="relative flex items-center gap-6 border-b border-border"
        >
          {tabs.map((entry) => {
            const active = mode === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(entry.id)}
                className={cn(
                  "relative flex h-10 cursor-pointer items-center gap-2 font-sans text-[13.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{entry.label}</span>
                {entry.count !== undefined && (
                  <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[12px] font-normal tabular-nums text-muted-foreground">
                    {entry.count}
                  </span>
                )}
                {active && (
                  <motion.span
                    layoutId="outline-tab-underline"
                    className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-foreground"
                  />
                )}
              </button>
            );
          })}
        </div>
      </ViewHeader>

      {loading && cards.length === 0 ? (
        <ViewSkeleton label="Loading outline..." />
      ) : mode === "cards" ? (
        <CardsMode
          projectId={project?.id ?? ""}
          data={data}
          isFocusedRegion={isFocusedRegion}
          onOpenCard={onOpenCard}
          onOpenSource={onOpenSource}
        />
      ) : (
        <ScriptMode
          projectTitle={project?.name ?? "Untitled"}
          data={data}
          isFocusedRegion={isFocusedRegion}
          onOpenCard={onOpenCard}
          onOpenSource={onOpenSource}
        />
      )}
    </div>
  );
}
