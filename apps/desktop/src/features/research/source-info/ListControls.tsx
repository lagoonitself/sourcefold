import * as React from "react";
import { Check, ChevronDown, ListFilter, Tag } from "lucide-react";
import { TRIAGE_LABELS, TRIAGE_VALUES, type Triage } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";
import {
  STATUS_FILTERS,
  hasTag,
  tagSuggestions,
  type ListFilter,
  type ResearchItem,
  type StatusFilter,
} from "./research-logic";
import { TRIAGE_META } from "./triage";
import { useProjectTagData } from "./use-project-info";

const statusLabel = (status: StatusFilter) =>
  STATUS_FILTERS.find((f) => f.id === status)?.label ?? "All";

/**
 * The group toolbar's filter: All / Keep / Maybe / Cut / No status, and a menu of the group's
 * tags. The status choices turn into one menu when the sheet is narrow.
 */
export function ListFilterBar({
  filter,
  onChange,
  tags,
  className,
}: {
  filter: ListFilter;
  onChange: (next: ListFilter) => void;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <div
        role="group"
        aria-label="Filter by status"
        className="hidden items-center gap-0.5 @[640px]/view:flex"
      >
        {STATUS_FILTERS.map((entry) => {
          const active = filter.status === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...filter, status: entry.id })}
              className={cn(
                "h-8 cursor-pointer rounded-[8px] px-2.5 font-sans text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="@[640px]/view:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" title="Filter by status">
              <ListFilter className="size-3.5" aria-hidden="true" />
              <span>{filter.status === "all" ? "Status" : statusLabel(filter.status)}</span>
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            {STATUS_FILTERS.map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onClick={() => onChange({ ...filter, status: entry.id })}
              >
                <span className="flex size-3.5 items-center justify-center">
                  {filter.status === entry.id && (
                    <Check className="size-3.5 !text-foreground" aria-hidden="true" />
                  )}
                </span>
                <span>{entry.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={tags.length === 0 && filter.tag === null}
            title={tags.length === 0 ? "No sources in this group have tags" : "Filter by tag"}
          >
            <Tag className="size-3.5" aria-hidden="true" />
            <span className="max-w-[120px] truncate">
              {filter.tag === null ? "Tag" : filter.tag}
            </span>
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuItem onClick={() => onChange({ ...filter, tag: null })}>
            <span className="flex size-3.5 items-center justify-center">
              {filter.tag === null && (
                <Check className="size-3.5 !text-foreground" aria-hidden="true" />
              )}
            </span>
            <span>Any tag</span>
          </DropdownMenuItem>
          {tags.length > 0 && <DropdownMenuSeparator />}
          {tags.map((entry) => (
            <DropdownMenuItem
              key={entry.tag}
              onClick={() => onChange({ ...filter, tag: entry.tag })}
            >
              <span className="flex size-3.5 items-center justify-center">
                {filter.tag === entry.tag && (
                  <Check className="size-3.5 !text-foreground" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.tag}</span>
              <span className="text-[12px] tabular-nums text-muted-foreground">{entry.count}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Select mode's Status menu: Keep, Maybe, Cut or clear, for every ticked source. */
export function BulkStatusMenu({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (triage: Triage | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} title="Set status (1, 2, 3, 0)">
          <span>Status</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bottom-full mb-1.5 mt-0 w-44">
        {TRIAGE_VALUES.map((triage) => {
          const { Icon, textClass, key } = TRIAGE_META[triage];
          return (
            <DropdownMenuItem key={triage} onClick={() => onPick(triage)}>
              <Icon className={cn("size-3.5", textClass)} aria-hidden="true" />
              <span>{TRIAGE_LABELS[triage]}</span>
              <Kbd>{key}</Kbd>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPick(null)}>
          <span className="size-3.5" aria-hidden="true" />
          <span>Clear status</span>
          <Kbd>0</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Select mode's Tag menu: the project's sections and tags, a click adds the tag to every ticked
 * source (or takes it off when they all have it). "Other tag" opens the tags editor.
 */
export function BulkTagMenu({
  targets,
  projectId,
  disabled,
  onToggle,
  onMore,
}: {
  targets: ResearchItem[];
  projectId: string | null;
  disabled?: boolean;
  onToggle: (tag: string, add: boolean) => void;
  onMore: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const data = useProjectTagData(projectId, open);
  const options = React.useMemo(() => {
    const onAll = (tag: string) => targets.length > 0 && targets.every((t) => hasTag(t, tag));
    const used = new Set<string>();
    const list = tagSuggestions({ ...data, current: [] }).map((s) => ({ ...s, on: onAll(s.tag) }));
    for (const s of list) used.add(s.tag.toLowerCase());
    // Tags the ticked sources already share, even when the project data hasn't loaded.
    for (const t of targets[0]?.tags ?? []) {
      if (!used.has(t.toLowerCase()) && onAll(t)) list.push({ tag: t, kind: "project", on: true });
    }
    return list;
  }, [data, targets]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} title="Tag (t)">
          <Tag className="size-3.5" aria-hidden="true" />
          <span>Tag</span>
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bottom-full mb-1.5 mt-0 max-h-72 w-56 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem key={option.tag} onClick={() => onToggle(option.tag, !option.on)}>
            <span className="flex size-3.5 items-center justify-center">
              {option.on && <Check className="size-3.5 !text-foreground" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.tag}</span>
            {option.kind === "section" && (
              <span className="text-[12px] text-muted-foreground">Section</span>
            )}
          </DropdownMenuItem>
        ))}
        {options.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onMore}>
          <Tag className="size-3.5" aria-hidden="true" />
          <span>Other tag</span>
          <Kbd>t</Kbd>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
