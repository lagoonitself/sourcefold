import * as React from "react";
import { CircleAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Logo } from "@/components/ui/Logo";
import { isTauri } from "@/lib/api";
import { syncLocalCopy } from "../local-copy/local-copy";
import { getSessionStatus, sessionFromStatus, type Session } from "@/lib/remote-client";
import { WelcomeScreen } from "./WelcomeScreen";

export interface AuthContextType {
  signedIn: boolean;
  offlineMode: boolean;
  session: Session | null;
  refresh: () => Promise<void>;
}

export const AuthContext = React.createContext<AuthContextType>({
  signedIn: false,
  offlineMode: false,
  session: null,
  refresh: async () => {},
});

export function useAuth() {
  return React.useContext(AuthContext);
}

export interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = React.useState(true);
  const [signedIn, setSignedIn] = React.useState(false);
  const [offlineMode, setOfflineMode] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const status = await getSessionStatus(true);
      setSignedIn(status.signedIn);
      setOfflineMode(status.offline);
      setSession(sessionFromStatus(status));
    } catch (e) {
      console.error("Failed to refresh session", e);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();

    const onAuthChanged = () => {
      void refresh();
    };

    window.addEventListener("sourcefold:auth-changed", onAuthChanged);
    window.addEventListener("sourcefold:session-expired", onAuthChanged);

    return () => {
      window.removeEventListener("sourcefold:auth-changed", onAuthChanged);
      window.removeEventListener("sourcefold:session-expired", onAuthChanged);
    };
  }, [refresh]);

  // Signed in, every reload also brings the copy on this computer up to date (it skips itself
  // when turned off, and never runs twice at once).
  React.useEffect(() => {
    if (!signedIn || offlineMode) return;
    const sync = () => {
      syncLocalCopy().catch((e) => console.error("Local copy failed", e));
    };
    sync();
    window.addEventListener("sourcefold:refresh", sync);
    return () => window.removeEventListener("sourcefold:refresh", sync);
  }, [signedIn, offlineMode]);

  // Signed-in views reload on window focus and every 30 s while visible. Nothing runs once the
  // session is gone (sign-out, or a 401 that cleared it).
  React.useEffect(() => {
    if (!signedIn) return;

    const onFocus = () => {
      window.dispatchEvent(new Event("sourcefold:refresh"));
    };
    window.addEventListener("focus", onFocus);

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && !document.hidden) {
        window.dispatchEvent(new Event("sourcefold:refresh"));
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [signedIn]);

  if (loading) {
    return (
      <div className="desk-grain relative flex h-dvh w-full flex-col items-center justify-center text-foreground select-none">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-[52px]" />
        <Logo className="size-10 motion-safe:animate-fade-in" />
        <div className="skeleton mt-5 h-1 w-24 rounded-full" aria-hidden="true" />
      </div>
    );
  }

  // If outside Tauri and not signed in, show a clear error state instead of fake data
  if (!isTauri() && !signedIn) {
    return (
      <div className="desk-grain relative flex h-dvh w-full items-center justify-center p-6 text-foreground select-none">
        <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-[52px]" />
        <div className="w-full max-w-[420px] rounded-[16px] bg-background p-6 shadow-sheet">
          <EmptyState
            icon={CircleAlert}
            title="Desktop app required"
            description="Sourcefold requires the Tauri desktop app for local storage, or an active signed-in connection."
            compact
          />
        </div>
      </div>
    );
  }

  // First launch welcome screen if not signed in and offline mode not chosen
  if (!signedIn && !offlineMode) {
    return (
      <AuthContext.Provider value={{ signedIn, offlineMode, session, refresh }}>
        <WelcomeScreen />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ signedIn, offlineMode, session, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
