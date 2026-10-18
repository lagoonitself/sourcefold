import * as React from "react";
import {
  Check,
  CircleAlert,
  Laptop,
  Loader2,
  LogOut,
  Moon,
  Newspaper,
  Palette,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { NativeHostStatus, Settings } from "@/lib/types";
import { getNativeHostStatus, getSettings, installNativeHost, updateSettings } from "@/lib/api";
import {
  cancelSignIn,
  getSessionStatus,
  isSignInCancelledError,
  sessionFromStatus,
  signOut,
  startSignIn,
  type Session,
} from "@/lib/remote-client";
import { cn } from "@/lib/utils";
import { SubstackCookieSettings } from "../substack/SubstackCookieSettings";
import { LocalCopySettings } from "../local-copy/LocalCopySettings";
import { SearchSettings } from "../search/SearchSettings";
import { ClaudeSettings } from "../claude/ClaudeSettings";

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTheme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

type SettingsSection = "general" | "appearance" | "account" | "search" | "claude" | "substack";

interface SectionConfig {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SECTIONS: SectionConfig[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "account", label: "Account", icon: User },
  { id: "search", label: "Search", icon: Search },
  { id: "claude", label: "Claude", icon: Sparkles },
  { id: "substack", label: "Substack", icon: Newspaper },
];

const DEFAULT_WEB_URL =
  ((import.meta as any).env?.VITE_SOURCEFOLD_WEB_URL as string) || "http://localhost:3000";

export function SettingsDialog({
  open,
  onOpenChange,
  currentTheme,
  onThemeChange,
}: SettingsDialogProps) {
  const [activeSection, setActiveSection] = React.useState<SettingsSection>("general");
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [storagePath, setStoragePath] = React.useState("");
  const [hostStatus, setHostStatus] = React.useState<NativeHostStatus | null>(null);
  const [isInstalling, setIsInstalling] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Account state
  const [session, setSession] = React.useState<Session | null>(null);
  const [isOffline, setIsOffline] = React.useState(false);
  const [webUrl, setWebUrl] = React.useState(DEFAULT_WEB_URL);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);

  const loadAccountStatus = React.useCallback(async () => {
    try {
      const status = await getSessionStatus(true);
      const current = sessionFromStatus(status);
      setSession(current);
      setIsOffline(status.offline);
      if (current?.web_url) {
        setWebUrl(current.web_url);
      }
    } catch (e) {
      console.error("Failed to load session status", e);
    }
  }, []);

  React.useEffect(() => {
    const handleCustomError = (e: Event) => {
      const custom = e as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) {
        setAuthError(custom.detail.message);
      }
    };
    window.addEventListener("sourcefold:auth-error", handleCustomError);

    return () => {
      window.removeEventListener("sourcefold:auth-error", handleCustomError);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;

    void loadAccountStatus();

    async function load() {
      try {
        const s = await getSettings();
        setSettings(s);
        setStoragePath(s.storage_dir || "");
      } catch (e) {
        console.error("Failed to load settings", e);
      }

      try {
        const status = await getNativeHostStatus();
        setHostStatus(status);
      } catch (e) {
        console.error("Failed to load native host status", e);
      }
    }

    void load();
  }, [open, loadAccountStatus]);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        storage_dir: storagePath.trim(),
        theme: currentTheme,
      });
      toast.success("Settings saved");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleInstallHost = async () => {
    setIsInstalling(true);
    try {
      const res = await installNativeHost();
      setHostStatus(res);
      toast.success("Native messaging host installed");
    } catch (err: any) {
      toast.error(err.message || "Failed to install native host");
    } finally {
      setIsInstalling(false);
    }
  };

  const handleStartSignIn = async () => {
    const url = webUrl.trim();
    if (!url) {
      setAuthError("Enter your Sourcefold web address first.");
      return;
    }
    setAuthError(null);
    setIsSigningIn(true);
    try {
      const newSession = await startSignIn(url);
      setSession(newSession);
      setIsOffline(false);
      toast.success(`Signed in as ${newSession.email || "your account"}`);
    } catch (err: any) {
      if (!isSignInCancelledError(err)) {
        const message = err?.message || String(err);
        setAuthError(message);
        toast.error(message);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleCancelSignIn = async () => {
    await cancelSignIn();
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setSession(null);
      toast.success("Signed out successfully");
    } catch (err: any) {
      toast.error(err?.message || "Failed to sign out");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] h-[560px] max-h-[calc(100dvh-32px)] p-0 overflow-hidden flex flex-col sm:flex-row">
        {/* Left Nav Pane (200px, bg-muted/60, rounded on left side; horizontal chips below 640px) */}
        <div className="w-full sm:w-[200px] sm:h-full flex flex-row sm:flex-col p-3 gap-1 shrink-0 bg-muted/60 border-b sm:border-b-0 sm:border-r border-border sm:rounded-l-[16px] overflow-x-auto sm:overflow-y-auto">
          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => setActiveSection(sec.id)}
                className={cn(
                  "h-8 flex items-center gap-2.5 px-3 rounded-[8px] text-[13px] font-medium transition-colors cursor-pointer select-none whitespace-nowrap",
                  isActive
                    ? "bg-background shadow-raised text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/40",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right Content Pane (scrollable) */}
        <div className="flex-1 flex flex-col h-full min-w-0 bg-card overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 pr-10">
            {authError && (
              <div className="mb-4 rounded-[8px] border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5">
                <CircleAlert className="size-4 shrink-0 mt-0.5" />
                <div className="flex-1 leading-relaxed">{authError}</div>
                <button
                  type="button"
                  onClick={() => setAuthError(null)}
                  className="text-destructive/70 hover:text-destructive cursor-pointer"
                  aria-label="Dismiss error"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {/* Section Header */}
            <h2 className="font-serif text-[22px] font-medium leading-[28px] tracking-[-0.012em] text-foreground mb-6">
              {activeSection === "general" && "General"}
              {activeSection === "appearance" && "Appearance"}
              {activeSection === "account" && "Account"}
              {activeSection === "search" && "Search"}
              {activeSection === "claude" && "Claude"}
              {activeSection === "substack" && "Substack"}
            </h2>

            {/* Section Content */}
            {activeSection === "general" && (
              <div className="flex flex-col gap-5">
                {/* Storage Directory Row */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13.5px] font-medium text-foreground">
                      Storage directory
                    </span>
                    <p className="text-[12.5px] leading-[18px] text-muted-foreground">
                      Folder on this computer where your sources are saved as Markdown files.
                    </p>
                  </div>
                  <Input
                    value={storagePath}
                    onChange={(e) => setStoragePath(e.target.value)}
                    placeholder="Path to folder"
                    className="font-mono text-xs"
                  />
                </div>

                <LocalCopySettings open={open} signedIn={Boolean(session) && !isOffline} />

                {/* Chrome Extension Native Messaging */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-[13.5px] font-medium text-foreground">
                        Chrome extension native messaging
                      </span>
                      <p className="text-[12.5px] leading-[18px] text-muted-foreground">
                        Connect the Sourcefold browser extension directly to this app.
                      </p>
                    </div>
                    <div className="shrink-0 pt-0.5">
                      {hostStatus?.installed ? (
                        <span className="inline-flex items-center gap-1 rounded-[6px] bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                          <Check className="size-3" />
                          Installed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-[6px] bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          <CircleAlert className="size-3" />
                          Not registered
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleInstallHost}
                      disabled={isInstalling}
                    >
                      {isInstalling
                        ? "Installing..."
                        : hostStatus?.installed
                          ? "Re-register native host"
                          : "Install native host"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "appearance" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[13.5px] font-medium text-foreground">Theme</span>
                    <p className="text-[12.5px] leading-[18px] text-muted-foreground">
                      Select how Sourcefold looks on your desktop.
                    </p>
                  </div>

                  {/* Three small cards with preview */}
                  <div className="grid grid-cols-3 gap-3 pt-1">
                    {/* Light Theme Card */}
                    <button
                      type="button"
                      onClick={() => onThemeChange("light")}
                      className={cn(
                        "group flex flex-col items-center gap-2 rounded-[10px] border border-border p-2 transition-all cursor-pointer text-left",
                        currentTheme === "light"
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent font-medium text-foreground"
                          : "hover:bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <div
                        className="h-16 w-full rounded-[6px] p-2 flex flex-col justify-end overflow-hidden"
                        style={{ backgroundColor: "#e8eaee", borderColor: "#e1e4ea" }}
                      >
                        <div
                          className="h-9 w-full rounded-[4px] p-1.5 flex flex-col justify-center gap-1 shadow-xs"
                          style={{ backgroundColor: "#fcfcfb" }}
                        >
                          <div
                            className="h-1 w-7 rounded-full"
                            style={{ backgroundColor: "#15181e" }}
                          />
                          <div
                            className="h-1 w-11 rounded-full"
                            style={{ backgroundColor: "#979eaa" }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[12.5px]">
                        <Sun className="size-3.5" />
                        <span>Light</span>
                      </div>
                    </button>

                    {/* Dark Theme Card */}
                    <button
                      type="button"
                      onClick={() => onThemeChange("dark")}
                      className={cn(
                        "group flex flex-col items-center gap-2 rounded-[10px] border border-border p-2 transition-all cursor-pointer text-left",
                        currentTheme === "dark"
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent font-medium text-foreground"
                          : "hover:bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <div className="dark w-full">
                        <div
                          className="h-16 w-full rounded-[6px] p-2 flex flex-col justify-end overflow-hidden"
                          style={{ backgroundColor: "#0e0f13", borderColor: "#2a2e36" }}
                        >
                          <div
                            className="h-9 w-full rounded-[4px] p-1.5 flex flex-col justify-center gap-1 shadow-xs"
                            style={{ backgroundColor: "#17191e" }}
                          >
                            <div
                              className="h-1 w-7 rounded-full"
                              style={{ backgroundColor: "#ecedef" }}
                            />
                            <div
                              className="h-1 w-11 rounded-full"
                              style={{ backgroundColor: "#5e6573" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[12.5px]">
                        <Moon className="size-3.5" />
                        <span>Dark</span>
                      </div>
                    </button>

                    {/* System Theme Card */}
                    <button
                      type="button"
                      onClick={() => onThemeChange("system")}
                      className={cn(
                        "group flex flex-col items-center gap-2 rounded-[10px] border border-border p-2 transition-all cursor-pointer text-left",
                        currentTheme === "system"
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-card border-transparent font-medium text-foreground"
                          : "hover:bg-muted/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <div className="h-16 w-full rounded-[6px] overflow-hidden flex border border-border">
                        <div
                          className="w-1/2 h-full p-1.5 flex flex-col justify-end"
                          style={{ backgroundColor: "#e8eaee" }}
                        >
                          <div
                            className="h-9 w-full rounded-l-[4px] p-1 flex flex-col justify-center gap-1 shadow-xs"
                            style={{ backgroundColor: "#fcfcfb" }}
                          >
                            <div
                              className="h-1 w-5 rounded-full"
                              style={{ backgroundColor: "#15181e" }}
                            />
                            <div
                              className="h-1 w-6 rounded-full"
                              style={{ backgroundColor: "#979eaa" }}
                            />
                          </div>
                        </div>
                        <div className="dark w-1/2 h-full">
                          <div
                            className="w-full h-full p-1.5 flex flex-col justify-end"
                            style={{ backgroundColor: "#0e0f13" }}
                          >
                            <div
                              className="h-9 w-full rounded-r-[4px] p-1 flex flex-col justify-center gap-1 shadow-xs"
                              style={{ backgroundColor: "#17191e" }}
                            >
                              <div
                                className="h-1 w-5 rounded-full"
                                style={{ backgroundColor: "#ecedef" }}
                              />
                              <div
                                className="h-1 w-6 rounded-full"
                                style={{ backgroundColor: "#5e6573" }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[12.5px]">
                        <Laptop className="size-3.5" />
                        <span>System</span>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === "account" && (
              <div className="flex flex-col gap-5">
                {session ? (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <span className="text-[13.5px] font-medium text-foreground">
                          Connected account
                        </span>
                        <div className="text-[13.5px] font-medium text-foreground">
                          {session.email}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {session.web_url}
                        </div>
                        <p className="text-[12.5px] leading-[18px] text-muted-foreground pt-1">
                          Connected to web app and syncing with Google Drive and Chrome extension.
                        </p>
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-success bg-muted px-2 py-0.5 rounded-full">
                          <Check className="size-3" />
                          Signed in
                        </span>
                      </div>
                    </div>

                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleSignOut}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <LogOut className="size-3.5 mr-1.5" />
                        Sign out
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="text-[13.5px] font-medium text-foreground">
                          Working offline
                        </span>
                        <p className="text-[12.5px] leading-[18px] text-muted-foreground">
                          Sourcefold Desktop is storing all your items locally on your computer.
                          Sign in with your browser to connect to the Sourcefold Web App, enable
                          Google Drive sync, and sync with the Chrome extension.
                        </p>
                      </div>
                      {isOffline && (
                        <div className="shrink-0 pt-0.5">
                          <span className="text-[11.5px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
                            Offline mode
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[13.5px] font-medium text-foreground">
                        Web app URL
                      </label>
                      <Input
                        value={webUrl}
                        onChange={(e) => setWebUrl(e.target.value)}
                        placeholder="http://localhost:3000"
                        disabled={isSigningIn}
                        className="font-mono text-xs"
                      />
                      <p className="text-[12px] text-muted-foreground">
                        The URL of your hosted or local Sourcefold Web instance.
                      </p>
                    </div>

                    <div className="pt-1 flex items-center gap-2">
                      {isSigningIn ? (
                        <>
                          <Button type="button" disabled size="sm" className="gap-1.5">
                            <Loader2 className="size-3.5 animate-spin" />
                            Waiting for browser sign-in...
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCancelSignIn}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button type="button" size="sm" onClick={handleStartSignIn}>
                          Sign in with browser
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSection === "search" && <SearchSettings open={open} />}

            {activeSection === "claude" && (
              <ClaudeSettings
                signedIn={Boolean(session) && !isOffline}
                offline={isOffline}
                email={session?.email ?? null}
              />
            )}

            {activeSection === "substack" && <SubstackCookieSettings open={open} />}
          </div>

          {/* Footer Bar */}
          <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0 bg-card">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSettings} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
