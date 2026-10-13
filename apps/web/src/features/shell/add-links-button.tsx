"use client";

import { Suspense, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddLinksDialog } from "@/features/grokipedia/add-links-dialog";

export function AddLinksButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Add links
      </Button>
      <Suspense fallback={null}>
        <AddLinksDialog open={open} onOpenChange={setOpen} />
      </Suspense>
    </>
  );
}
