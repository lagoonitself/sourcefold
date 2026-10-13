"use client";

import { CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function SaveToDriveButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="default" disabled className="disabled:pointer-events-auto">
            <CloudUpload className="size-4" />
            Save to Drive
          </Button>
        }
      />
      <TooltipContent>Connect Google Drive first</TooltipContent>
    </Tooltip>
  );
}
