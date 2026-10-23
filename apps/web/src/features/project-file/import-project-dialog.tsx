"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ProjectFileError,
  assertProjectFileName,
  formatProjectFileSummary,
  importProjectViaApi,
  readProjectFile,
  summarizeProjectFile,
  type ProjectFileContents,
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
import { rememberProject } from "@/features/projects/project";
import { ProgressBar } from "./progress-bar";
import { countSources, describeProgress } from "./progress-text";
import { SkippedList } from "./skipped-list";
import { createWebProjectFileApi } from "./web-api";

/**
 * Opens a project file the user chose. Resolves to its contents, or shows why it can't be read
 * and resolves to null.
 */
export async function openProjectFile(file: File): Promise<ProjectFileContents | null> {
  try {
    assertProjectFileName(file.name);
    return readProjectFile(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    toast.error(
      err instanceof ProjectFileError ? err.message : "Couldn't open that file. Try again.",
    );
    return null;
  }
}

/** A hidden file input; click `inputRef` to choose a project file. */
export function ProjectFileInput({
  inputRef,
  onContents,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onContents: (contents: ProjectFileContents) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".sourcefold,.zip"
      className="hidden"
      aria-label="Project file"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const contents = await openProjectFile(file);
        if (contents) onContents(contents);
      }}
    />
  );
}

export interface ImportProjectDialogProps {
  contents: ProjectFileContents | null;
  onClose: () => void;
}

export function ImportProjectDialog({ contents, onClose }: ImportProjectDialogProps) {
  return (
    <Dialog open={contents !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]" showCloseButton={false}>
        {contents && <ImportFlow contents={contents} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

type FlowState =
  | { status: "preview" }
  | { status: "importing"; progress: ProjectFileProgress | null }
  | { status: "done"; name: string; skipped: SkippedSource[] }
  | { status: "failed"; message: string };

function ImportFlow({ contents, onClose }: { contents: ProjectFileContents; onClose: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>({ status: "preview" });
  const controllerRef = useRef<AbortController | null>(null);

  // Closing the dialog while importing stops the upload.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const summary = formatProjectFileSummary(summarizeProjectFile(contents.manifest, contents.bytes));

  const start = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "importing", progress: null });
    try {
      const result = await importProjectViaApi(
        createWebProjectFileApi(controller.signal),
        contents,
        {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) setState({ status: "importing", progress });
          },
        },
      );
      rememberProject(result.projectId);
      router.push(`/?folder=${result.projectId}`);
      router.refresh();
      if (result.skipped.length === 0) {
        toast("Project imported");
        onClose();
      } else {
        setState({ status: "done", name: result.name, skipped: result.skipped });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        status: "failed",
        message: err instanceof Error ? err.message : "Couldn't import the project file.",
      });
    }
  };

  const progress =
    state.status === "importing" && state.progress
      ? describeProgress(state.progress)
      : { label: "Starting…", percent: 0 };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-sans text-[18px] font-semibold leading-[24px] text-foreground">
          {state.status === "done" ? "Project imported" : "Import project file"}
        </DialogTitle>
        <DialogDescription>
          {state.status === "preview" && `${summary}. It will be added as a new project.`}
          {state.status === "importing" && summary}
          {state.status === "done" && `${state.name} is now a project.`}
          {state.status === "failed" && state.message}
        </DialogDescription>
      </DialogHeader>
      {state.status === "importing" && <ProgressBar {...progress} />}
      {state.status === "done" && (
        <SkippedList
          heading={`${countSources(state.skipped.length)} couldn't be imported:`}
          skipped={state.skipped}
        />
      )}
      <DialogFooter>
        {state.status === "preview" && (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={start}>
              Import
            </Button>
          </>
        )}
        {state.status === "importing" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose();
              toast("Import cancelled. What was already added stays as a project you can delete.");
            }}
          >
            Cancel
          </Button>
        )}
        {(state.status === "done" || state.status === "failed") && (
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
