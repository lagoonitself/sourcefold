"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AddImageButtonProps {
  folderId: string;
}

export function AddImageButton({ folderId }: AddImageButtonProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const uploadFiles = async (files: FileList | File[]) => {
    const filesArray = Array.from(files);
    if (filesArray.length === 0) return;

    setUploading(true);
    let successCount = 0;

    try {
      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];
        setProgress({ current: i + 1, total: filesArray.length });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("folder_id", folderId);

        try {
          const res = await fetch("/api/uploads", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            let errorMessage = "Failed to upload image.";
            try {
              const json = await res.json();
              if (json?.error?.message) {
                errorMessage = json.error.message;
              }
            } catch {
              // fallback
            }
            toast.error(errorMessage);
          } else {
            successCount++;
          }
        } catch {
          toast.error("Failed to upload image.");
        }
      }
    } finally {
      setUploading(false);
      setProgress(null);
    }

    if (successCount === 1) {
      toast.success("Added image");
    } else if (successCount > 1) {
      toast.success(`Added ${successCount} images`);
    }

    router.refresh();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFiles(files);
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (uploading) return;
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (uploading) return;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      void uploadFiles(files);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(isDragging && "border-primary bg-accent text-accent-foreground")}
      >
        <ImagePlus className="size-4" aria-hidden="true" />
        {uploading && progress
          ? `Uploading ${progress.current} of ${progress.total}\u2026`
          : "Add image"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChange}
      />
    </>
  );
}
