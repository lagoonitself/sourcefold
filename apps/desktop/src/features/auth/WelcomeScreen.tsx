import * as React from "react";
import { motion } from "motion/react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  HardDrive,
  Loader2,
  LogIn,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Kbd } from "@/components/ui/Kbd";
import { Logo } from "@/components/ui/Logo";
import { isTauri } from "@/lib/api";
import {
  cancelSignIn,
  clearExpiredSessionMessage,
  getExpiredSessionMessage,
  isSignInCancelledError,
  setOfflineMode,
  startSignIn,
} from "@/lib/remote-client";
import {
  getSupabaseConfig,
  isSupabaseConfigured,
  setSupabaseConfig,
  supabaseConfigProblem,
} from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SourceTile } from "../items/source-kinds";
import { isMacPlatform } from "../shortcuts/key-utils";

/** One orchestrated entrance: each block rises in 60ms after the one before it. */
function rise(index: number, extraDelay = 0) {
  const delay = extraDelay + index * 0.06;
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: {
      y: { duration: 0.55, ease: [0.32, 0.72, 0, 1] as const, delay },
      opacity: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const, delay },
    },
  };
}

// Purely decorative: three source rows laid out like cards on the desk.
const SAMPLE_CARDS = [
  {
    kind: "youtube",
    title: "How a turbocharger works",
    meta: "YouTube, 14 min",
    className: "left-0 top-0 -rotate-2",
  },
  {
    kind: "grokipedia",
    title: "Turbocharger",
    meta: "Grokipedia",
    className: "left-[9%] top-[112px] rotate-1",
  },
  {
    kind: "substack",
    title: "Why boost lag matters less than you think",
    meta: "Substack, Oct 17",
    className: "left-[2%] top-[224px] rotate-3",
  },
];

function SampleStack() {
  return (
    <div
      aria-hidden="true"
      className="relative hidden h-[330px] w-[300px] shrink-0 min-[900px]:block min-[1100px]:w-[360px]"
    >
      {SAMPLE_CARDS.map((card, index) => (
        <motion.div
          key={card.kind}
          className={cn(
            "absolute flex w-[88%] items-center gap-3 rounded-[14px] bg-background p-3.5 shadow-sheet",
            card.className,
          )}
          {...rise(index, 0.3)}
        >
          <SourceTile kind={card.kind} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-serif text-[15px] font-medium leading-[20px] tracking-[-0.005em] text-foreground">
              {card.title}
            </div>
            <div className="truncate text-[12px] leading-4 text-muted-foreground">{card.meta}</div>
          </div>
          <Check className="size-4 shrink-0 text-muted-foreground" />
        </motion.div>
      ))}
    </div>
  );
}

export function WelcomeScreen() {
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const isMac = React.useMemo(() => isMacPlatform(), []);
  // Advanced: the Supabase project to sign in to. Prefilled from the build; open when the build
  // has none (a self-hosted copy built without them).
  const [showAdvanced, setShowAdvanced] = React.useState(() => !isSupabaseConfigured());
  const [supabaseUrl, setSupabaseUrl] = React.useState(() => getSupabaseConfig().supabaseUrl);
  const [publishableKey, setPublishableKey] = React.useState(
    () => getSupabaseConfig().supabasePublishableKey,
  );
  const supabaseUrlId = React.useId();
  const publishableKeyId = React.useId();

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
    const typed = { supabaseUrl, supabasePublishableKey: publishableKey };
    const problem = supabaseConfigProblem(typed);
    if (problem) {
      setShowAdvanced(true);
      setAuthError(problem);
      return;
    }
    const current = getSupabaseConfig();
    if (
      typed.supabaseUrl.trim().replace(/\/+$/, "") !== current.supabaseUrl ||
      typed.supabasePublishableKey.trim() !== current.supabasePublishableKey
    ) {
      setSupabaseConfig(typed);
    }
    setAuthError(null);
    clearExpiredSessionMessage();
    setIsSigningIn(true);
    try {
      const session = await startSignIn();
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
  }, [isSigningIn, supabaseUrl, publishableKey]);

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
    <div className="desk-grain relative h-dvh w-full overflow-hidden text-foreground select-none">
      {/* On macOS the title bar is transparent; this strip drags the window. */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-[52px]" />

      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[1120px] items-center gap-12 px-8 pb-12 pt-16 min-[900px]:px-14 min-[1100px]:gap-16">
          <div className="flex w-full min-w-0 max-w-[520px] flex-1 flex-col gap-6">
            <motion.div className="flex items-center gap-2.5" {...rise(0)}>
              <Logo className="size-10" />
              <span className="text-[15px] font-semibold tracking-[-0.005em]">Sourcefold</span>
            </motion.div>

            <motion.h1
              className="font-serif text-[44px] font-medium leading-[48px] tracking-[-0.02em] text-balance"
              {...rise(1)}
            >
              <span className="block">Collect sources</span>
              <span className="block">
                <span className="marker marker-sweep" style={{ animationDelay: "480ms" }}>
                  for your next video
                </span>
              </span>
            </motion.h1>

            <motion.p
              className="max-w-[46ch] text-[15px] leading-[22px] text-muted-foreground"
              {...rise(2)}
            >
              Save YouTube videos, articles and threads as plain markdown and keep them together by
              group.
            </motion.p>

            {authError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-[12px] bg-destructive/10 p-3 text-[13px] leading-[19px] text-destructive shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--destructive)_25%,transparent)] motion-safe:animate-rise-in"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="flex-1">{authError}</div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setAuthError(null);
                    clearExpiredSessionMessage();
                  }}
                  className="-my-1 -mr-1 text-destructive hover:bg-destructive/10"
                  aria-label="Dismiss error"
                  title="Dismiss"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}

            <motion.section
              aria-labelledby="welcome-account-title"
              className="flex flex-col gap-4 rounded-[14px] bg-background p-5 shadow-raised transition-shadow duration-200 ease-out hover:shadow-[var(--shadow-sheet)]"
              {...rise(3)}
            >
              <div className="flex items-start gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted">
                  <Cloud className="size-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2
                    id="welcome-account-title"
                    className="font-serif text-[20px] font-medium leading-6 tracking-[-0.012em]"
                  >
                    Use my Sourcefold account
                  </h2>
                  <p className="text-[13px] leading-[19px] text-muted-foreground">
                    Sign in with Google to keep your sources in your account and Google Drive, and
                    to save from the extension.
                  </p>
                </div>
              </div>

              {isSigningIn ? (
                <div className="flex items-center gap-2">
                  <div
                    role="status"
                    className="flex h-9 flex-1 items-center gap-2 rounded-[9px] bg-muted px-3 text-[13px] text-muted-foreground"
                  >
                    <Loader2 className="size-4 shrink-0 motion-safe:animate-spin" />
                    <span className="truncate">Waiting for you to finish in the browser…</span>
                  </div>
                  <Button variant="outline" onClick={handleCancelSignIn}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button onClick={handleSignIn} className="w-full" autoFocus>
                  <LogIn className="size-4" />
                  Sign in with Google
                </Button>
              )}

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((open) => !open)}
                  aria-expanded={showAdvanced}
                  className="flex w-fit cursor-pointer items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 transition-transform duration-200",
                      showAdvanced && "rotate-90",
                    )}
                    aria-hidden="true"
                  />
                  Advanced
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-3 motion-safe:animate-rise-in">
                    <p className="text-[12px] leading-[17px] text-muted-foreground">
                      Only change these if you run your own copy of Sourcefold.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={supabaseUrlId}
                        className="text-[12px] font-medium text-muted-foreground"
                      >
                        Supabase address
                      </label>
                      <Input
                        id={supabaseUrlId}
                        value={supabaseUrl}
                        onChange={(e) => setSupabaseUrl(e.target.value)}
                        placeholder="https://your-project.supabase.co"
                        disabled={isSigningIn}
                        spellCheck={false}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={publishableKeyId}
                        className="text-[12px] font-medium text-muted-foreground"
                      >
                        Publishable key
                      </label>
                      <Input
                        id={publishableKeyId}
                        value={publishableKey}
                        onChange={(e) => setPublishableKey(e.target.value)}
                        placeholder="sb_publishable_…"
                        disabled={isSigningIn}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.section>

            <motion.button
              type="button"
              onClick={handleUseOffline}
              disabled={isSigningIn}
              className="flex w-full cursor-pointer items-start gap-3.5 rounded-[14px] bg-background p-5 text-left shadow-raised transition-shadow duration-200 ease-out hover:shadow-[var(--shadow-sheet)] disabled:pointer-events-none disabled:opacity-60"
              {...rise(4)}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted">
                <HardDrive className="size-[18px]" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-[20px] font-medium leading-6 tracking-[-0.012em]">
                  Keep everything on this computer
                </span>
                <span className="block text-[13px] leading-[19px] text-muted-foreground">
                  Work without an account. Your sources stay on this computer.
                </span>
              </span>
            </motion.button>

            <motion.p
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground"
              {...rise(5)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Kbd>Enter</Kbd>
                to sign in
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>Enter</Kbd>
                or
                <Kbd>{isMac ? "⌥" : "Alt"}</Kbd>
                <Kbd>O</Kbd>
                for offline
              </span>
            </motion.p>
          </div>

          <SampleStack />
        </div>
      </div>
    </div>
  );
}
