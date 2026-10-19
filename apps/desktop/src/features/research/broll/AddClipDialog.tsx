import * as React from "react";
import { Film, Link as LinkIcon, Plus } from "lucide-react";
import { toast } from "sonner";
import { parseClipTime, type CardInput } from "@sourcefold/core";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { Item } from "@/lib/types";

export interface AddClipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  items: readonly Item[];
  onCreateClip: (input: CardInput) => Promise<boolean>;
}

export function AddClipDialog({
  open,
  onOpenChange,
  projectId,
  items,
  onCreateClip,
}: AddClipDialogProps) {
  const [sourceMode, setSourceMode] = React.useState<"project" | "url">("project");
  const [selectedItemId, setSelectedItemId] = React.useState<string>("");
  const [customUrl, setCustomUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startTime, setStartTime] = React.useState("");
  const [endTime, setEndTime] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const videoItems = React.useMemo(() => {
    return items.filter(
      (item) =>
        item.kind === "youtube" ||
        item.source_url?.includes("youtu") ||
        item.canonical_url?.includes("youtu"),
    );
  }, [items]);

  React.useEffect(() => {
    if (open) {
      if (videoItems.length > 0) {
        setSourceMode("project");
        setSelectedItemId(videoItems[0].id);
      } else {
        setSourceMode("url");
        setSelectedItemId("");
      }
      setCustomUrl("");
      setDescription("");
      setStartTime("");
      setEndTime("");
      setNote("");
      setIsSubmitting(false);
    }
  }, [open, videoItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const desc = description.trim();
    if (!desc) {
      toast.error("Please describe what the clip shows.");
      return;
    }

    let itemId: string | null = null;
    let url: string | null = null;

    if (sourceMode === "project") {
      if (!selectedItemId) {
        toast.error("Please select a video source.");
        return;
      }
      itemId = selectedItemId;
    } else {
      const trimmedUrl = customUrl.trim();
      if (!trimmedUrl) {
        toast.error("Please enter a video URL.");
        return;
      }
      if (!/^https?:\/\//i.test(trimmedUrl)) {
        toast.error("Video URL must start with http:// or https://");
        return;
      }
      url = trimmedUrl;
    }

    const startSec = startTime.trim() ? parseClipTime(startTime) : null;
    if (startTime.trim() && startSec === null) {
      toast.error("Invalid start time (e.g. 1:05, 65, 1m5s).");
      return;
    }

    const endSec = endTime.trim() ? parseClipTime(endTime) : null;
    if (endTime.trim() && endSec === null) {
      toast.error("Invalid end time (e.g. 1:20, 80, 1m20s).");
      return;
    }

    if (startSec !== null && endSec !== null && endSec < startSec) {
      toast.error("Clip end time cannot be before start time.");
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await onCreateClip({
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `broll-${Date.now()}`,
        project_id: projectId,
        kind: "broll",
        item_id: itemId,
        highlight_id: null,
        quote: desc,
        seconds: startSec,
        end_seconds: endSec,
        url,
        note: note.trim() || null,
        script_line: null,
        section_id: null,
        position: Date.now() / 1000,
      });
      if (ok) {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add B-roll clip</DialogTitle>
            <DialogDescription>
              Save a clip to show in your video script or export as a shot list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-3">
            {/* Source selector */}
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-foreground">Video Source</label>
              <div className="flex gap-2 text-[13px]">
                {videoItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSourceMode("project")}
                    className={`flex-1 rounded-[7px] border px-2.5 py-1.5 text-center transition-colors ${
                      sourceMode === "project"
                        ? "border-foreground bg-accent font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Project video ({videoItems.length})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSourceMode("url")}
                  className={`flex-1 rounded-[7px] border px-2.5 py-1.5 text-center transition-colors ${
                    sourceMode === "url"
                      ? "border-foreground bg-accent font-medium text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Video URL / link
                </button>
              </div>

              {sourceMode === "project" ? (
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="mt-1.5 block w-full rounded-[8px] border border-input bg-background px-2.5 py-1.5 text-[13.5px] text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {videoItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1.5 relative">
                  <Input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                    className="pl-8"
                  />
                  <LinkIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              )}
            </div>

            {/* Description / What it shows */}
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-foreground">What it shows</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Overhead drone shot of assembly line"
                autoFocus
              />
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-foreground">Start time</label>
                <Input
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="e.g. 1:05"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[12.5px] font-medium text-foreground">
                  End time (optional)
                </label>
                <Input
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  placeholder="e.g. 1:20"
                />
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <label className="text-[12.5px] font-medium text-foreground">Note (optional)</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Slow motion, color grade warmly"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              <Plus className="size-4" aria-hidden="true" />
              Add clip
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
