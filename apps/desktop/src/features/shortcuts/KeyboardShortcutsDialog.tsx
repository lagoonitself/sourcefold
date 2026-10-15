import * as React from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { getCommandsByGroup, type ShortcutGroup, type ShortcutCommand } from "./registry";
import { isMacPlatform, splitComboForKbd } from "./key-utils";
import { cn } from "@/lib/utils";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_ORDER: ShortcutGroup[] = ["Navigation", "Projects", "Groups", "Sources", "App"];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const commandsByGroup = React.useMemo(() => getCommandsByGroup(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="mb-2">
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-primary" />
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </div>
          <DialogDescription>
            Navigate, organize, and manage your sources entirely from the keyboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6">
          {GROUP_ORDER.map((group) => {
            const commands = commandsByGroup[group];
            if (!commands || commands.length === 0) return null;

            return (
              <div key={group} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">
                  {group}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                  {commands.map((cmd) => (
                    <div
                      key={cmd.id}
                      className="flex items-center justify-between gap-3 text-xs py-1"
                    >
                      <span className="text-foreground min-w-0 truncate" title={cmd.description}>
                        {cmd.title}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {cmd.combos.map((combo, idx) => (
                          <React.Fragment key={combo}>
                            {idx > 0 && (
                              <span className="text-[10px] text-muted-foreground">or</span>
                            )}
                            <div className="flex items-center gap-0.5">
                              {splitComboForKbd(combo, isMac).map((k, i) => (
                                <kbd
                                  key={i}
                                  className="inline-flex min-w-5 h-5 items-center justify-center rounded border border-border bg-muted/80 px-1.5 font-mono text-[10px] font-semibold text-foreground shadow-2xs"
                                >
                                  {k}
                                </kbd>
                              ))}
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Platform detected:{" "}
            <span className="font-semibold">{isMac ? "macOS (⌘)" : "Windows / Linux (Ctrl)"}</span>
          </span>
          <span>
            Press <kbd className="font-semibold text-foreground">Esc</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
