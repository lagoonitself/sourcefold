import * as React from "react";
import { CircleAlert } from "lucide-react";
import { isTauri } from "@/lib/api";
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
    return <div className="min-h-screen w-full bg-background" />;
  }

  // If outside Tauri and not signed in, show a clear error state instead of fake data
  if (!isTauri() && !signedIn) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-[420px] rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col items-center text-center gap-4">
          <div className="size-10 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
            <CircleAlert className="size-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="font-serif text-base font-semibold">Desktop app required</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Sourcefold requires the Tauri desktop app for local storage, or an active signed-in
              connection.
            </p>
          </div>
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
