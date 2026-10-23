import * as React from "react";
import { toast } from "sonner";
import {
  formatProjectFileSummary,
  type ProjectFileProgress,
  type SkippedSource,
} from "@sourcefold/core/project-file";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { exportProjectFile, importProjectFile, type OpenedProjectFile } from "./project-file-api";

/** The sentence and bar position for a step of an export or import. */
export function describeProgress(progress: ProjectFileProgress | null): {
  label: string;
  percent: number;
} {
  if (!progress) return { label: "Working…", percent: 0 };
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

function countSources(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

function ProgressBar({ progress }: { progress: ProjectFileProgress | null }) {
  const { label, percent } = describeProgress(progress);
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full origin-left bg-foreground transition-transform duration-200"
          style={{ transform: `scaleX(${percent / 100})` }}
        />
      </div>
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SkippedList({ heading, skipped }: { heading: string; skipped: SkippedSource[] }) {
  return (
    <div className="flex flex-col gap-2 text-[13px]">
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

// ---------------------------------------------------------------------------------------------
// Download

export interface ExportRequest {
  project: { id: string; name: string };
  path: string;
}

type ExportState =
  | { status: "running"; progress: ProjectFileProgress | null }
  | { status: "done"; skipped: SkippedSource[] }
  | { status: "failed"; message: string };

export function ExportProjectDialog({
  request,
  onClose,
}: {
  request: ExportRequest | null;
  onClose: () => void;
}) {
  const [state, setState] = React.useState<ExportState>({ status: "running", progress: null });
  const controllerRef = React.useRef<AbortController | null>(null);
  const closeRef = React.useRef(onClose);
  React.useEffect(() => {
    closeRef.current = onClose;
  });

  React.useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "running", progress: null });
    exportProjectFile(request.project.id, request.path, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setState({ status: "running", progress });
      },
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.skipped.length === 0) {
          toast.success("Project file saved");
          closeRef.current();
        } else {
          setState({ status: "done", skipped: result.skipped });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "failed", message: errorText(err, "Couldn't make the project file.") });
      });
    return () => controller.abort();
  }, [request]);

  const running = state.status === "running";
  const close = () => {
    controllerRef.current?.abort();
    onClose();
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {state.status === "done" ? "Project file saved" : "Download project file"}
          </DialogTitle>
          <DialogDescription>
            {state.status === "failed"
              ? state.message
              : state.status === "done"
                ? `${request?.project.name} is saved.`
                : `Making a file with everything in ${request?.project.name}.`}
          </DialogDescription>
        </DialogHeader>
        {running && <ProgressBar progress={state.progress} />}
        {state.status === "done" && (
          <SkippedList
            heading={`${countSources(state.skipped.length)} ${state.skipped.length === 1 ? "was" : "were"} saved without their text:`}
            skipped={state.skipped}
          />
        )}
        <DialogFooter>
          {running ? (
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
          ) : (
            <Button type="button" onClick={close} autoFocus>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Import

type ImportState =
  | { status: "preview" }
  | { status: "importing"; progress: ProjectFileProgress | null }
  | { status: "done"; name: string; skipped: SkippedSource[] }
  | { status: "failed"; message: string };

export function ImportProjectDialog({
  file,
  onClose,
  onImported,
}: {
  file: OpenedProjectFile | null;
  onClose: () => void;
  /** Called once the project exists, to refresh the list and switch to it. */
  onImported: (projectId: string) => Promise<void> | void;
}) {
  const [state, setState] = React.useState<ImportState>({ status: "preview" });
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setState({ status: "preview" });
  }, [file]);
  // Closing the window part way stops a signed-in import.
  React.useEffect(() => () => controllerRef.current?.abort(), []);

  const summary = file ? formatProjectFileSummary(file.summary) : "";

  const start = async () => {
    if (!file) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "importing", progress: null });
    try {
      const result = await importProjectFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setState({ status: "importing", progress });
        },
      });
      await onImported(result.projectId);
      if (result.skipped.length === 0) {
        toast.success(`Imported ${result.name}`);
        onClose();
      } else {
        setState({ status: "done", name: result.name, skipped: result.skipped });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({ status: "failed", message: errorText(err, "Couldn't import the project file.") });
    }
  };

  const importing = state.status === "importing";
  const close = () => {
    if (importing) {
      controllerRef.current?.abort();
      toast(
        file?.mode === "offline"
          ? "Import cancelled. Nothing was added."
          : "Import cancelled. What was already added stays as a project you can delete.",
      );
    }
    onClose();
  };

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {state.status === "done" ? "Project imported" : "Import project file"}
          </DialogTitle>
          <DialogDescription>
            {state.status === "preview" && `${summary}. It will be added as a new project.`}
            {importing && summary}
            {state.status === "done" && `${state.name} is now a project.`}
            {state.status === "failed" && state.message}
          </DialogDescription>
        </DialogHeader>
        {importing && <ProgressBar progress={state.progress} />}
        {state.status === "done" && (
          <SkippedList
            heading={`${countSources(state.skipped.length)} couldn't be imported:`}
            skipped={state.skipped}
          />
        )}
        <DialogFooter>
          {state.status === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="button" onClick={start} autoFocus>
                Import
              </Button>
            </>
          )}
          {importing && (
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
          )}
          {(state.status === "done" || state.status === "failed") && (
            <Button type="button" onClick={close} autoFocus>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
