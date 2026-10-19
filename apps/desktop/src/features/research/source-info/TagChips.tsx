import { cn } from "@/lib/utils";
import { visibleTags } from "./research-logic";

/** Up to two tag chips on a source row, then "+N" for the rest. */
export function TagChips({
  tags,
  max = 2,
  className,
}: {
  tags: readonly string[] | undefined;
  max?: number;
  className?: string;
}) {
  const { shown, more } = visibleTags(tags, max);
  if (shown.length === 0) return null;
  const rest = (tags ?? []).slice(max);
  return (
    <span className={cn("flex shrink-0 items-center gap-1", className)}>
      {shown.map((tag) => (
        <span
          key={tag}
          title={tag}
          className="max-w-[112px] truncate rounded-[6px] bg-muted px-1.5 font-sans text-[12px] leading-[18px] text-muted-foreground"
        >
          {tag}
        </span>
      ))}
      {more > 0 && (
        <span
          title={rest.join(", ")}
          className="rounded-[6px] bg-muted px-1.5 font-sans text-[12px] leading-[18px] tabular-nums text-muted-foreground"
        >
          +{more}
        </span>
      )}
    </span>
  );
}
