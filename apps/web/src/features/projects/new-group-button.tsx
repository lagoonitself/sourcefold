"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NameDialog } from "./name-dialog";

export interface NewGroupButtonProps {
  parentId: string;
  label: "New group" | "New subgroup";
}

export function NewGroupButton({ parentId, label }: NewGroupButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const createGroup = async (name: string) => {
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parent_id: parentId }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message ?? "Couldn't create the group. Try again.");
        return false;
      }
      toast("Group created");
      router.refresh();
      return true;
    } catch {
      toast.error("Couldn't create the group. Try again.");
      return false;
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        {label}
      </Button>
      <NameDialog
        open={open}
        onOpenChange={setOpen}
        title={label}
        placeholder="Group name"
        submitLabel="Create group"
        onSubmit={createGroup}
      />
    </>
  );
}
