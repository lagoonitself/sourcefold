"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AddLinksButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="outline" disabled className="disabled:pointer-events-auto">
            <Plus className="size-4" />
            Add links
          </Button>
        }
      />
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}
