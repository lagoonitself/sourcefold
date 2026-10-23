import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  BUILD_SUPABASE_CONFIG,
  DEFAULT_SETTINGS,
  getSettings,
  getSupabaseConfig,
  hasCustomSupabaseConfig,
  saveSettings,
  setSupabaseConfig,
  supabaseConfigProblem,
  type ConnectionMode,
} from "../../lib/settings";
import { accountStatus, resolveTarget, signIn, signOut } from "../../lib/account-channel";
import type { AccountStatus } from "../../lib/account";
import { localServerFetch } from "../../lib/local-server";
import { listFolders } from "../../lib/api";

interface NativeHostStatus {
  installed: boolean;
  message?: string;
  manifest_path?: string;
}

type Status = { message: string; isError: boolean } | null;

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p className={`status-message ${status.isError ? "status-error" : "status-success"}`}>
      {status.message}
    </p>
  );
}

export default function App() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountResult, setAccountResult] = useState<Status>(null);

  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(
    DEFAULT_SETTINGS.connectionMode,
  );
  const [testResult, setTestResult] = useState<Status>(null);
  const [isTesting, setIsTesting] = useState(false);

  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [customConfig, setCustomConfig] = useState(false);
  const [advancedResult, setAdvancedResult] = useState<Status>(null);

  // Native host registration state
  const [nativeHostStatus, setNativeHostStatus] = useState<NativeHostStatus | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<Status>(null);

  const loadAccount = async () => {
    try {
      setAccount(await accountStatus());
    } catch (err: unknown) {
      setAccount({ signedIn: false });
      setAccountResult({ message: errorText(err, "Couldn't read the sign-in."), isError: true });
    }
  };

  useEffect(() => {
    async function load() {
      const [settings, config, custom] = await Promise.all([
        getSettings(),
        getSupabaseConfig(),
        hasCustomSupabaseConfig(),
      ]);
      setConnectionMode(settings.connectionMode);
      setSupabaseUrl(config.supabaseUrl);
      setPublishableKey(config.supabasePublishableKey);
      setCustomConfig(custom);
      void loadAccount();

      // Check native host status from local desktop if running
      try {
        const res = await localServerFetch("/api/native-host/status", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          setNativeHostStatus(await res.json());
        }
      } catch {
        // Desktop not running
      }
    }
    void load();
  }, []);

  const handleSignIn = async () => {
    setAccountBusy(true);
    setAccountResult(null);
    try {
      const status = await signIn();
      setAccount(status);
      setAccountResult({
        message: status.email ? `Signed in as ${status.email}.` : "Signed in.",
        isError: false,
      });
    } catch (err: unknown) {
      setAccountResult({ message: errorText(err, "The sign-in didn't finish."), isError: true });
    } finally {
      setAccountBusy(false);
    }
  };

  const handleSignOut = async () => {
    setAccountBusy(true);
    setAccountResult(null);
    try {
      await signOut();
      setAccount({ signedIn: false });
    } catch (err: unknown) {
      setAccountResult({ message: errorText(err, "Couldn't sign out."), isError: true });
    } finally {
      setAccountBusy(false);
    }
  };

  const changeMode = async (mode: ConnectionMode) => {
    setConnectionMode(mode);
    setTestResult(null);
    await saveSettings({ connectionMode: mode });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const target = await resolveTarget({ forceRefresh: true });
      if (target.type === "signed-out" || target.type === "error") {
        setTestResult({ message: target.displayLabel, isError: true });
        return;
      }
      const folders = await listFolders();
      const projects = folders.filter((f) => !f.parent_id).length;
      setTestResult({
        message: `${target.displayLabel}. ${projects} ${projects === 1 ? "project" : "projects"}.`,
        isError: false,
      });
    } catch (err: unknown) {
      setTestResult({ message: errorText(err, "Couldn't connect."), isError: true });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAdvanced = async (e: React.FormEvent) => {
    e.preventDefault();
    const config = { supabaseUrl, supabasePublishableKey: publishableKey };
    const problem = supabaseConfigProblem(config);
    if (problem) {
      setAdvancedResult({ message: problem, isError: true });
      return;
    }
    await setSupabaseConfig(config);
    setCustomConfig(true);
    setAdvancedResult({ message: "Saved.", isError: false });
  };

  const handleUseDefault = async () => {
    await setSupabaseConfig(null);
    setSupabaseUrl(BUILD_SUPABASE_CONFIG.supabaseUrl);
    setPublishableKey(BUILD_SUPABASE_CONFIG.supabasePublishableKey);
    setCustomConfig(false);
    setAdvancedResult({ message: "Back to this build's account server.", isError: false });
  };

  const handleRegisterNativeHost = async () => {
    setIsRegistering(true);
    setRegisterResult(null);

    try {
      const extensionId = browser.runtime?.id;
      if (!extensionId) {
        setRegisterResult({
          message: "Extension ID could not be detected.",
          isError: true,
        });
        return;
      }

      const res = await localServerFetch("/api/native-host/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extension_id: extensionId }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setNativeHostStatus({ installed: true, message: data.message });
        setRegisterResult({
          message: "Native host registered successfully.",
          isError: false,
        });
      } else {
        const errJson = await res.json().catch(() => null);
        setRegisterResult({
          message: errJson?.error?.message || "Failed to register native host.",
          isError: true,
        });
      }
    } catch {
      setRegisterResult({
        message:
          "Couldn't reach Sourcefold desktop app at http://127.0.0.1:23456. Open the desktop app first.",
        isError: true,
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const signedIn = Boolean(account?.signedIn);

  return (
    <div className="options-page">
      <div className="options-container">
        <h1 className="options-title">Sourcefold extension settings</h1>

        <div className="options-form">
          <h2 className="options-section-title">Account</h2>
          <p className="form-help">
            {account === null
              ? "Checking…"
              : signedIn
                ? `Signed in as ${account.email ?? "your Google account"}. Saves go to your account and Google Drive.`
                : "Sign in with the Google account you use in Sourcefold. Without it, the extension uses the desktop app's sign-in while the app is open."}
          </p>
          <div className="options-buttons">
            {signedIn ? (
              <button
                type="button"
                className="btn-outline"
                onClick={() => void handleSignOut()}
                disabled={accountBusy}
              >
                {accountBusy ? "Signing out…" : "Sign out"}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleSignIn()}
                disabled={accountBusy || account === null}
              >
                {accountBusy ? "Finish in the Google window…" : "Sign in with Google"}
              </button>
            )}
          </div>
          <StatusLine status={accountResult} />
        </div>

        <div className="options-section">
          <h2 className="options-section-title">Where saves go</h2>
          <div className="form-group">
            <label className="form-label" htmlFor="connectionMode">
              Connection mode
            </label>
            <select
              id="connectionMode"
              className="input-field"
              value={connectionMode}
              onChange={(e) => void changeMode(e.target.value as ConnectionMode)}
            >
              <option value="auto">Auto (recommended)</option>
              <option value="desktop">Desktop app only</option>
            </select>
            <p className="form-help">
              Auto saves to your account when the extension is signed in. Otherwise it uses the
              desktop app: its sign-in, or its offline library on this computer. Desktop app only
              always goes through the desktop app.
            </p>
          </div>
          <div className="options-buttons">
            <button
              type="button"
              className="btn-outline"
              onClick={() => void handleTestConnection()}
              disabled={isTesting}
            >
              {isTesting ? "Testing…" : "Test connection"}
            </button>
          </div>
          <StatusLine status={testResult} />
        </div>

        <div className="options-section">
          <h2 className="options-section-title">Native messaging helper</h2>
          <p className="form-help">
            Allows the extension to communicate directly with the Sourcefold desktop app.
          </p>
          {nativeHostStatus && (
            <p className="status-message status-success">
              {nativeHostStatus.installed
                ? "Native host manifest is registered."
                : "Native host manifest is not yet registered."}
            </p>
          )}
          <div className="options-buttons" style={{ marginTop: "8px" }}>
            <button
              type="button"
              className="btn-outline"
              onClick={() => void handleRegisterNativeHost()}
              disabled={isRegistering}
            >
              {isRegistering ? "Registering…" : "Register native host"}
            </button>
          </div>
          <StatusLine status={registerResult} />
        </div>

        <details className="options-section">
          <summary className="options-section-title">Advanced</summary>
          <form className="options-form" onSubmit={(e) => void handleSaveAdvanced(e)}>
            <p className="form-help">
              Only for your own copy of Sourcefold: the Supabase project that holds the accounts.
              {signedIn ? " Sign out before changing it." : ""}
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="supabaseUrl">
                Supabase address
              </label>
              <input
                id="supabaseUrl"
                type="text"
                className="input-field"
                value={supabaseUrl}
                disabled={signedIn}
                onChange={(e) => {
                  setSupabaseUrl(e.target.value);
                  setAdvancedResult(null);
                }}
                placeholder="https://your-project.supabase.co"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="publishableKey">
                Publishable key
              </label>
              <input
                id="publishableKey"
                type="text"
                className="input-field mono"
                value={publishableKey}
                disabled={signedIn}
                onChange={(e) => {
                  setPublishableKey(e.target.value);
                  setAdvancedResult(null);
                }}
                placeholder="sb_publishable_…"
              />
            </div>
            <div className="options-buttons">
              <button type="submit" className="btn-primary" disabled={signedIn}>
                Save
              </button>
              {customConfig && (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => void handleUseDefault()}
                  disabled={signedIn}
                >
                  Use the default
                </button>
              )}
            </div>
            <StatusLine status={advancedResult} />
          </form>
        </details>
      </div>
    </div>
  );
}
