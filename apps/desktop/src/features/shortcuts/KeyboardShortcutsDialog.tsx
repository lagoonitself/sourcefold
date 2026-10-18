import * as React from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/Kbd";
import { getCommandsByGroup, type ShortcutGroup } from "./registry";
import { isMacPlatform, splitComboForKbd } from "./key-utils";

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_ORDER: ShortcutGroup[] = [
  "Navigation",
  "Projects",
  "Groups",
  "Sources",
  "Reader",
  "App",
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const isMac = React.useMemo(() => isMacPlatform(), []);
  const commandsByGroup = React.useMemo(() => getCommandsByGroup(), []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] max-h-[calc(100dvh-32px)] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="mb-3 pr-8">
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-foreground" />
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </div>
          <DialogDescription>
            Navigate, organize, and manage your sources entirely from the keyboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            {GROUP_ORDER.map((group) => {
              const commands = commandsByGroup[group];
              if (!commands || commands.length === 0) return null;

              return (
                <div key={group} className="space-y-2">
                  <h3 className="text-[12px] font-medium text-muted-foreground pb-1 border-b border-border">
                    {group}
                  </h3>
                  <div className="space-y-1.5">
                    {commands.map((cmd) => (
                      <div
                        key={cmd.id}
                        className="flex items-center justify-between gap-3 text-[13px] py-0.5"
                      >
                        <span className="text-foreground min-w-0 truncate" title={cmd.description}>
                          {cmd.title}
                        </span>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {cmd.combos.map((combo, idx) => (
                            <React.Fragment key={combo}>
                              {idx > 0 && (
                                <span className="text-[11px] text-muted-foreground">or</span>
                              )}
                              <div className="flex items-center">
                                {splitComboForKbd(combo, isMac).map((k, i) => (
                                  <React.Fragment key={i}>
                                    {i > 0 && (
                                      <span className="text-muted-foreground text-[10px] select-none">
                                        &thinsp;
                                      </span>
                                    )}
                                    <Kbd>{k}</Kbd>
                                  </React.Fragment>
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
        </div>

        <div className="pt-4 border-t border-border flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            Platform detected:{" "}
            <span className="font-medium text-foreground">
              {isMac ? "macOS (⌘)" : "Windows / Linux (Ctrl)"}
            </span>
          </span>
          <span className="flex items-center gap-1">
            Press <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
