import * as React from "react";
import { motion } from "motion/react";
import { Copy, FilePlus, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ShelfLink } from "@sourcefold/core";
import { shelfHost } from "@sourcefold/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/utils";
import { formatShelfOpened, shelfNoteLine, shelfTileLetter } from "./shelf-format";

/** Tags shown on a row before the rest collapse into "+N". */
const VISIBLE_TAGS = 2;

export interface ShelfRowProps {
  link: ShelfLink;
  index: number;
  focused: boolean;
  now: Date;
  onFocus: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  /** Opens Add links with this link's address filled in. */
  onSaveAsSource: () => void;
}

/**
 * One shelf link: a site tile, the title in serif, the host and the note's first line under it,
 * tags, and when it was last opened. Enter or a click opens the link; the menu holds the rest.
 */
export function ShelfRow({
  link,
  index,
  focused,
  now,
  onFocus,
  onOpen,
  onEdit,
  onTogglePin,
  onDelete,
  onSaveAsSource,
}: ShelfRowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const host = shelfHost(link.url);
  const note = shelfNoteLine(link.note);
  const shownTags = link.tags.slice(0, VISIBLE_TAGS);
  const hiddenTagCount = link.tags.length - shownTags.length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy to the clipboard. Try again.");
    }
  };

  return (
    <motion.li
      data-shelf-row
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.24,
        ease: [0.16, 1, 0.3, 1],
        delay: index < 12 ? index * 0.02 : 0,
      }}
      className={cn(
        "group relative -mx-2.5 flex min-h-[52px] items-center gap-1 rounded-[10px] px-2.5 py-1.5 transition-colors duration-100",
        focused ? "bg-accent" : "hover:bg-muted",
      )}
    >
      {focused && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0.5 w-[2px] rounded-full bg-foreground"
        />
      )}

      <div
        role="button"
        tabIndex={focused ? 0 : -1}
        data-shelf-id={link.id}
        aria-label={`Open ${link.title}`}
        title={link.url}
        onFocus={onFocus}
        onClick={() => {
          onFocus();
          onOpen();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[8px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-[8px] font-serif text-[14px] font-medium text-foreground"
          style={{ backgroundColor: "color-mix(in oklab, var(--foreground) 12%, transparent)" }}
        >
          {shelfTileLetter(link.url)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex min-w-0 items-center gap-1.5">
            {link.pinned && (
              <span
                role="img"
                aria-label="Pinned"
                title="Pinned"
                className="inline-flex shrink-0 text-muted-foreground"
              >
                <Pin className="size-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="truncate font-serif text-[16px] font-medium leading-[22px] text-foreground">
              {link.title}
            </span>
            {shownTags.map((tag) => (
              <span
                key={tag}
                className="hidden shrink-0 rounded-[5px] bg-muted px-1.5 text-[11.5px] leading-[18px] text-muted-foreground @[560px]/view:inline-block"
              >
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 && (
              <span className="hidden shrink-0 text-[11.5px] leading-[18px] text-muted-foreground tabular-nums @[560px]/view:inline">
                +{hiddenTagCount}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 font-sans text-[12px] leading-4 text-muted-foreground">
            <span className="shrink-0">{host}</span>
            {note && <span className="min-w-0 truncate">{note}</span>}
          </div>
        </div>

        <span className="hidden shrink-0 whitespace-nowrap font-sans text-[12.5px] leading-[18px] text-muted-foreground tabular-nums @[440px]/view:block">
          {formatShelfOpened(link.last_opened_at, now)}
        </span>
      </div>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          aria-label={`More actions for ${link.title}`}
          title="More actions"
          className={cn(
            "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-[opacity,background-color] duration-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            menuOpen
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onTogglePin}>
            {link.pinned ? (
              <PinOff className="size-3.5" aria-hidden="true" />
            ) : (
              <Pin className="size-3.5" aria-hidden="true" />
            )}
            {link.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void copyLink()}>
            <Copy className="size-3.5" aria-hidden="true" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSaveAsSource}>
            <FilePlus className="size-3.5" aria-hidden="true" />
            Save as a source
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.li>
  );
}
