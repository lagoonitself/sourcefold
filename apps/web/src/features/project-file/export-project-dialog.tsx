"use client";

import { useEffect, useRef, useState } from "react";
import {
  exportProjectViaApi,
  type ProjectFileProgress,
  type SkippedSource,
} from "@sourcefold/core/project-file";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProgressBar } from "./progress-bar";
import { countSources, describeProgress } from "./progress-text";
import { SkippedList } from "./skipped-list";
import { createWebProjectFileApi } from "./web-api";

export interface ExportProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: string; name: string } | null;
}

export function ExportProjectDialog({ open, onOpenChange, project }: ExportProjectDialogProps) {
  // Closing the dialog unmounts the run, which aborts it.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
        {open && project && (
          <ExportRun key={project.id} project={project} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type RunState =
  | { status: "running"; progress: ProjectFileProgress | null }
  | { status: "done"; skipped: SkippedSource[] }
  | { status: "failed"; message: string };

function download(chunks: Uint8Array[], fileName: string) {
  const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function ExportRun({
  project,
  onClose,
}: {
  project: { id: string; name: string };
  onClose: () => void;
}) {
  const [state, setState] = useState<RunState>({ status: "running", progress: null });
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const controller = new AbortController();
    exportProjectViaApi(createWebProjectFileApi(controller.signal), project.id, {
      app: "Sourcefold web",
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setState({ status: "running", progress });
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        download(result.chunks, result.fileName);
        if (result.skipped.length === 0) closeRef.current();
        else setState({ status: "done", skipped: result.skipped });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "failed",
          message: err instanceof Error ? err.message : "Couldn't make the project file.",
        });
      });
    return () => {
      controller.abort();
    };
  }, [project.id]);

  const progress =
    state.status === "running" && state.progress
      ? describeProgress(state.progress)
      : { label: "Reading the project…", percent: 0 };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
          {state.status === "done" ? "Project file saved" : "Download project file"}
        </DialogTitle>
        <DialogDescription>
          {state.status === "failed"
            ? state.message
            : state.status === "done"
              ? `${project.name} is in your downloads.`
              : `Making a file with everything in ${project.name}.`}
        </DialogDescription>
      </DialogHeader>
      {state.status === "running" && <ProgressBar {...progress} />}
      {state.status === "done" && (
        <SkippedList
          heading={`${countSources(state.skipped.length)} ${state.skipped.length === 1 ? "was" : "were"} saved without their text:`}
          skipped={state.skipped}
        />
      )}
      <DialogFooter>
        {state.status === "running" ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        ) : (
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
