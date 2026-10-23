import type { ProjectFileProgress } from "@sourcefold/core/project-file";

/** The sentence and bar position for a step of an export or import. */
export function describeProgress(progress: ProjectFileProgress): {
  label: string;
  percent: number;
} {
  const { phase, done, total } = progress;
  const share = total > 0 ? Math.min(1, done / total) : 1;
  switch (phase) {
    case "reading":
      return { label: "Reading the project…", percent: share * 10 };
    case "files":
      return { label: `Copying files ${done} of ${total}`, percent: 10 + share * 80 };
    case "packing":
      return { label: "Packing…", percent: done >= total ? 100 : 95 };
    case "uploading":
      return { label: `Uploading images ${done} of ${total}`, percent: share * 20 };
    case "saving":
      return { label: `Saving sources ${done} of ${total}`, percent: 20 + share * 60 };
    case "images":
      return { label: `Copying post images ${done} of ${total}`, percent: 80 + share * 20 };
  }
}

export function countSources(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}
