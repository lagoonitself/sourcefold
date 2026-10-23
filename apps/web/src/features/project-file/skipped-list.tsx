import type { SkippedSource } from "@sourcefold/core/project-file";

export function SkippedList({ heading, skipped }: { heading: string; skipped: SkippedSource[] }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-foreground">{heading}</p>
      <ul className="max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-muted-foreground">
        {skipped.map((s, i) => (
          <li key={i}>
            {s.title}: {s.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
