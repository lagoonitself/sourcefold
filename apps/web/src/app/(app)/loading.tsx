import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="px-8 pt-6">
      <Skeleton className="mb-2 h-4 w-32" />
      <div className="flex items-baseline justify-between gap-4 pb-3">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <div className="border-b border-border" />
      <div className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex min-h-[48px] items-center gap-3 px-3 py-2">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 max-w-md flex-1" />
            <Skeleton className="h-3.5 w-20 shrink-0" />
            <Skeleton className="h-3.5 w-14 shrink-0" />
            <Skeleton className="size-4 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
