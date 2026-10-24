import * as React from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TldrContent } from "./TldrPane";
import { useTldr } from "./tldr-store";

const COLLAPSED_KEY = "sourcefold:tldr-box-collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export interface TldrBoxItem {
  id: string;
  title: string;
  kind: string;
  status?: string;
  created_at?: string;
  folder_id?: string;
  meta?: Record<string, unknown>;
}

/** The reader's TL;DR, under the title: a quiet box that can be folded away (remembered). */
export function TldrBox({ item, className }: { item: TldrBoxItem; className?: string }) {
  const { tldr, state } = useTldr(item.id);
  const [collapsed, setCollapsed] = React.useState(readCollapsed);

  // Nothing to say for notes and images, and no box before there is a TL;DR or work on one.
  if (item.kind === "note" || item.kind === "image") return null;
  if (!tldr && !state) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {
      // keep the in-memory state
    }
  };

  const asItem = {
    status: "saved",
    created_at: new Date(0).toISOString(),
    folder_id: "",
    meta: {},
    ...item,
  } as unknown as Item;

  return (
    <section aria-label="TL;DR" className={cn("rounded-[12px] bg-muted/60 px-4 py-3", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left font-sans text-[12px] font-medium text-muted-foreground hover:text-foreground"
      >
        <motion.span
          animate={{ rotate: collapsed ? 0 : 90 }}
          transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          className="flex items-center"
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </motion.span>
        TL;DR
      </button>
      {!collapsed && (
        <div className="pt-2.5">
          <TldrContent item={asItem} compact />
        </div>
      )}
    </section>
  );
}
