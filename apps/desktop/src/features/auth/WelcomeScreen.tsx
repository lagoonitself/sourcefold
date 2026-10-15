import * as React from "react";
import { CircleAlert, FolderGit2, Globe, HardDrive, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { isTauri } from "@/lib/api";
import {
  cancelSignIn,
  clearExpiredSessionMessage,
  getExpiredSessionMessage,
  isSignInCancelledError,
  setOfflineMode,
  startSignIn,
} from "@/lib/remote-client";

const DEFAULT_WEB_URL =
  ((import.meta as any).env?.VITE_SOURCEFOLD_WEB_URL as string) || "http://localhost:3000";

export function WelcomeScreen() {
  const [webUrl, setWebUrl] = React.useState(DEFAULT_WEB_URL);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const expired = getExpiredSessionMessage();
    if (expired) {
      setAuthError(expired);
    }

    const handleSessionExpired = (e: Event) => {
      const custom = e as CustomEvent<{ message?: string }>;
      setAuthError(custom.detail?.message || "Your sign-in expired. Sign in again.");
    };
    window.addEventListener("sourcefold:session-expired", handleSessionExpired);

    const handleCustomError = (e: Event) => {
      const custom = e as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) {
        setAuthError(custom.detail.message);
      }
    };
    window.addEventListener("sourcefold:auth-error", handleCustomError);

    return () => {
      window.removeEventListener("sourcefold:session-expired", handleSessionExpired);
      window.removeEventListener("sourcefold:auth-error", handleCustomError);
    };
  }, []);

  const handleSignIn = React.useCallback(async () => {
    if (isSigningIn) return;
    const url = webUrl.trim();
    if (!url) {
      setAuthError("Enter your Sourcefold web address first.");
      return;
    }
    setAuthError(null);
    clearExpiredSessionMessage();
    setIsSigningIn(true);
    try {
      const session = await startSignIn(url);
      toast.success(`Signed in as ${session.email || "your account"}`);
    } catch (err: any) {
      if (!isSignInCancelledError(err)) {
        const message = err?.message || String(err);
        setAuthError(message);
        toast.error(message);
      }
    } finally {
      setIsSigningIn(false);
    }
  }, [isSigningIn, webUrl]);

  const handleCancelSignIn = React.useCallback(async () => {
    await cancelSignIn();
  }, []);

  const handleUseOffline = React.useCallback(async () => {
    if (!isTauri()) {
      const msg = "Offline mode requires running the Sourcefold desktop app.";
      setAuthError(msg);
      toast.error(msg);
      return;
    }
    setAuthError(null);
    clearExpiredSessionMessage();
    try {
      await setOfflineMode(true);
      toast.info("Working offline on this computer");
    } catch (err: any) {
      const msg = err?.message || "Failed to enable offline mode";
      setAuthError(msg);
      toast.error(msg);
    }
  }, []);

  // Keyboard shortcuts:
  // Enter = sign in
  // Ctrl+Enter / Cmd+Enter or Alt+O = offline mode
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.altKey && e.key.toLowerCase() === "o") ||
        ((e.ctrlKey || e.metaKey) && e.key === "Enter")
      ) {
        e.preventDefault();
        void handleUseOffline();
        return;
      }

      if (e.key === "Enter" && !isSigningIn) {
        e.preventDefault();
        void handleSignIn();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSignIn, handleUseOffline, isSigningIn]);

  return (
    <div className="min-h-screen w-full bg-background flex flex-col items-center justify-center p-6 text-foreground select-none">
      <div className="w-full max-w-[440px] flex flex-col items-center gap-6">
        {/* Brand header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-1 shadow-sm">
            <FolderGit2 className="size-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Sourcefold</h1>
          <p className="text-sm text-muted-foreground max-w-[340px] leading-relaxed">
            Your personal research library for the web. Capture articles, threads, and notes in pure
            markdown.
          </p>
        </div>

        {/* Auth error banner */}
        {authError && (
          <div className="w-full rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5 shadow-sm">
            <CircleAlert className="size-4 shrink-0 mt-0.5" />
            <div className="flex-1 leading-relaxed">{authError}</div>
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                clearExpiredSessionMessage();
              }}
              className="text-destructive/70 hover:text-destructive cursor-pointer"
              aria-label="Dismiss error"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Card */}
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Globe className="size-3.5 text-muted-foreground" />
              Sourcefold Web URL
            </label>
            <Input
              value={webUrl}
              onChange={(e) => setWebUrl(e.target.value)}
              placeholder="http://localhost:3000"
              disabled={isSigningIn}
              className="font-mono text-xs"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">
              Sign in with your browser to sync with Google Drive and the extension.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {isSigningIn ? (
              <div className="flex items-center gap-2">
                <Button
                  disabled
                  className="flex-1 h-9 text-xs flex items-center justify-center gap-2"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  Waiting for you to finish in the browser…
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelSignIn}
                  className="h-9 px-3 text-xs cursor-pointer"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleSignIn}
                className="w-full h-9 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="size-3.5" />
                Sign in with browser
              </Button>
            )}

            <div className="relative my-1 text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <span className="relative bg-card px-2 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                or
              </span>
            </div>

            <Button
              variant="outline"
              onClick={handleUseOffline}
              disabled={isSigningIn}
              className="w-full h-9 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <HardDrive className="size-3.5" />
              Use offline on this computer
            </Button>
          </div>

          {/* Keyboard shortcuts hints */}
          <div className="pt-2 border-t border-border/60 text-center text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              Press{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                Enter
              </kbd>{" "}
              to sign in
            </span>
            <span className="mx-2">·</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                Ctrl+Enter
              </kbd>{" "}
              or{" "}
              <kbd className="px-1.5 py-0.5 rounded border border-border bg-muted/50 font-mono text-[10px]">
                Alt+O
              </kbd>{" "}
              for offline
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
