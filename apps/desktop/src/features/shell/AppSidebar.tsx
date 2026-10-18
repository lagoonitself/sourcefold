import * as React from "react";
import { Command, HardDrive, Keyboard, PanelLeftClose, Settings2 } from "lucide-react";
import { Kbd } from "@/components/ui/Kbd";
import { Logo } from "@/components/ui/Logo";
import { useAuth } from "@/features/auth";
import { cn } from "@/lib/utils";

export interface AppSidebarProps {
  isMac: boolean;
  /** Shown highlighted while the keyboard is in the group tree. */
  isFocusedRegion: boolean;
  projectSwitcher: React.ReactNode;
  tree: React.ReactNode;
  onOpenCommandPalette: () => void;
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  onHide: () => void;
  onActivate: () => void;
}

/** Brand row, project switcher, the open project's groups, and the account footer. */
export function AppSidebar({
  isMac,
  isFocusedRegion,
  projectSwitcher,
  tree,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenSettings,
  onHide,
  onActivate,
}: AppSidebarProps) {
  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <div
      className="flex h-full w-full flex-col text-sidebar-foreground"
      onClick={onActivate}
      data-focused={isFocusedRegion || undefined}
    >
      {/* On macOS the traffic lights sit in this strip, so it is taller and drags the window. */}
      <div
        data-tauri-drag-region
        className="flex h-12 shrink-0 items-center gap-2 pl-4 pr-2 [.platform-mac_&]:h-[52px] [.platform-mac_&]:pl-[84px]"
      >
        <Logo className="pointer-events-none size-[22px] [.platform-mac_&]:hidden" />
        <span
          data-tauri-drag-region
          className="truncate text-[14.5px] font-semibold tracking-[-0.01em] [.platform-mac_&]:hidden"
        >
          Sourcefold
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title={`Command palette (${mod}K)`}
            aria-label="Command palette"
            className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Command className="size-3.5" aria-hidden="true" />
            <Kbd className="bg-transparent shadow-none">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
            title={`Hide sidebar (${mod}B)`}
            aria-label="Hide sidebar"
            className="flex size-7 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-2">{projectSwitcher}</div>

      <div className="flex min-h-0 flex-1 flex-col px-1.5">{tree}</div>

      <AccountFooter onOpenShortcuts={onOpenShortcuts} onOpenSettings={onOpenSettings} mod={mod} />
    </div>
  );
}

function AccountFooter({
  onOpenShortcuts,
  onOpenSettings,
  mod,
}: {
  onOpenShortcuts: () => void;
  onOpenSettings: () => void;
  mod: string;
}) {
  const { signedIn, offlineMode, session } = useAuth();
  const email = session?.email ?? "";
  const initials = (email.split("@")[0] || "?")
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <footer className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-3 py-2.5">
      <button
        type="button"
        onClick={onOpenSettings}
        title={signedIn ? `Signed in as ${email}` : "Offline library on this computer"}
        className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[9px] p-1 pr-2 text-left transition-colors hover:bg-sidebar-accent"
      >
        {signedIn && !offlineMode ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-[11px] font-semibold text-background">
            {initials || "?"}
          </span>
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-sidebar-accent text-muted-foreground shadow-raised">
            <HardDrive className="size-3.5" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-foreground">
            {signedIn && !offlineMode ? email.split("@")[0] : "Offline library"}
          </span>
          <span className="block truncate text-[11.5px] leading-4 text-muted-foreground">
            {signedIn && !offlineMode ? "Synced with your account" : "Saved on this computer"}
          </span>
        </span>
      </button>
      <IconAction label="Keyboard shortcuts (?)" onClick={onOpenShortcuts}>
        <Keyboard className="size-4" aria-hidden="true" />
      </IconAction>
      <IconAction label={`Settings (${mod},)`} onClick={onOpenSettings}>
        <Settings2 className="size-4" aria-hidden="true" />
      </IconAction>
    </footer>
  );
}

function IconAction({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
