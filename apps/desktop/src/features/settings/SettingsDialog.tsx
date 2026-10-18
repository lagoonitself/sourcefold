import * as React from "react";
import { Check, CircleAlert, Laptop, Loader2, LogOut, Moon, Sun, User, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { NativeHostStatus, Settings } from "@/lib/types";
import {
  getNativeHostStatus,
  getSettings,
  installNativeHost,
  isTauri,
  updateSettings,
} from "@/lib/api";
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

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTheme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

const DEFAULT_WEB_URL =
  ((import.meta as any).env?.VITE_SOURCEFOLD_WEB_URL as string) || "http://localhost:3000";

export function SettingsDialog({
  open,
  onOpenChange,
  currentTheme,
  onThemeChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = React.useState<"general" | "account" | "substack">("general");
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
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure storage, appearance, browser extension, your Sourcefold account and Substack.
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex border-b border-border text-xs font-medium -mt-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={cn(
              "pb-2 px-3 border-b-2 font-medium transition-colors cursor-pointer",
              activeTab === "general"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            General
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("account")}
            className={cn(
              "pb-2 px-3 border-b-2 font-medium transition-colors cursor-pointer flex items-center gap-1.5",
              activeTab === "account"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <User className="size-3.5" />
            <span>Account</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("substack")}
            className={cn(
              "pb-2 px-3 border-b-2 font-medium transition-colors cursor-pointer",
              activeTab === "substack"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Substack
          </button>
        </div>

        {authError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5">
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

        {activeTab === "general" ? (
          <div className="flex flex-col gap-5 py-2">
            {/* Storage Directory */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground">Storage Directory</label>
              <p className="text-[11px] text-muted-foreground">
                Folder on this computer where your sources are saved as Markdown files.
              </p>
              <div className="flex gap-2">
                <Input
                  value={storagePath}
                  onChange={(e) => setStoragePath(e.target.value)}
                  placeholder="Path to folder"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <LocalCopySettings open={open} signedIn={Boolean(session) && !isOffline} />

            <SearchSettings open={open} />

            {/* Native Messaging Host Installer */}
            <div className="flex flex-col gap-2 rounded-[6px] border border-border p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    Chrome Extension Native Messaging
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Connect the Sourcefold browser extension directly to this app.
                  </div>
                </div>
                <div className="shrink-0">
                  {hostStatus?.installed ? (
                    <span className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                      <Check className="size-3" />
                      Installed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      <CircleAlert className="size-3" />
                      Not registered
                    </span>
                  )}
                </div>
              </div>

              <div className="pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleInstallHost}
                  disabled={isInstalling}
                  className="text-xs h-8 cursor-pointer"
                >
                  {isInstalling
                    ? "Installing..."
                    : hostStatus?.installed
                      ? "Re-register native host"
                      : "1-Click Install Native Host"}
                </Button>
              </div>
            </div>

            {/* Theme Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-foreground">Appearance</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onThemeChange("light")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-[6px] border border-border p-2 text-xs font-medium transition-colors cursor-pointer",
                    currentTheme === "light"
                      ? "border-primary bg-primary/5 text-primary font-semibold"
                      : "hover:bg-muted text-muted-foreground",
                  )}
                >
                  <Sun className="size-4" />
                  <span>Light</span>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange("dark")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-[6px] border border-border p-2 text-xs font-medium transition-colors cursor-pointer",
                    currentTheme === "dark"
                      ? "border-primary bg-primary/5 text-primary font-semibold"
                      : "hover:bg-muted text-muted-foreground",
                  )}
                >
                  <Moon className="size-4" />
                  <span>Dark</span>
                </button>

                <button
                  type="button"
                  onClick={() => onThemeChange("system")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-[6px] border border-border p-2 text-xs font-medium transition-colors cursor-pointer",
                    currentTheme === "system"
                      ? "border-primary bg-primary/5 text-primary font-semibold"
                      : "hover:bg-muted text-muted-foreground",
                  )}
                >
                  <Laptop className="size-4" />
                  <span>System</span>
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === "substack" ? (
          <SubstackCookieSettings open={open} />
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {session ? (
              <div className="flex flex-col gap-4">
                <div className="rounded-[8px] border border-border p-4 bg-muted/20 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Connected Account</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      <Check className="size-3" />
                      Signed in
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm font-medium text-foreground">{session.email}</div>
                    <div className="text-xs text-muted-foreground font-mono">{session.web_url}</div>
                  </div>

                  <div className="text-[11px] text-muted-foreground">
                    Connected to web app and syncing with Google Drive and Chrome extension.
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSignOut}
                    className="text-xs text-destructive hover:bg-destructive/10 cursor-pointer"
                  >
                    <LogOut className="size-3.5 mr-1.5" />
                    Sign out
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="rounded-[8px] border border-border p-4 bg-muted/20 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Working Offline</span>
                    {isOffline && (
                      <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
                        Offline Mode
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Sourcefold Desktop is storing all your items locally on your computer. Sign in
                    with your browser to connect to the Sourcefold Web App, enable Google Drive
                    sync, and sync with the Chrome extension.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-foreground">Web App URL</label>
                  <Input
                    value={webUrl}
                    onChange={(e) => setWebUrl(e.target.value)}
                    placeholder="http://localhost:3000"
                    disabled={isSigningIn}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The URL of your hosted or local Sourcefold Web instance.
                  </p>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  {isSigningIn ? (
                    <>
                      <Button
                        type="button"
                        disabled
                        className="text-xs h-8 flex items-center gap-1.5"
                      >
                        <Loader2 className="size-3.5 animate-spin" />
                        Waiting for browser sign-in...
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancelSignIn}
                        className="text-xs h-8 cursor-pointer"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleStartSignIn}
                      className="text-xs h-8 cursor-pointer"
                    >
                      Sign in with browser
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">
            Cancel
          </Button>
          <Button onClick={handleSaveSettings} disabled={isSaving} className="cursor-pointer">
            {isSaving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
