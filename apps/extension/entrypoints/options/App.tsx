import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  isLocalUrl,
  type ConnectionMode,
} from "../../lib/settings";
import { resolveTarget, invalidateTargetCache } from "../../lib/target";
import { localServerFetch } from "../../lib/local-server";
import { sendNativeMessage } from "../../lib/native-messaging";
import { unwrapResponse, type Folder } from "../../lib/api";

interface NativeHostStatus {
  installed: boolean;
  message?: string;
  manifest_path?: string;
}

export default function App() {
  const [appUrl, setAppUrl] = useState(DEFAULT_SETTINGS.appUrl);
  const [token, setToken] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>(
    DEFAULT_SETTINGS.connectionMode,
  );
  const [saveStatus, setSaveStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [testResult, setTestResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Native host registration state
  const [nativeHostStatus, setNativeHostStatus] = useState<NativeHostStatus | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerResult, setRegisterResult] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const settings = await getSettings();
      setAppUrl(settings.appUrl);
      setToken(settings.token);
      setConnectionMode(settings.connectionMode);

      // Check native host status from local desktop if running
      try {
        const res = await localServerFetch("/api/native-host/status", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          setNativeHostStatus(data);
        }
      } catch {
        // Desktop not running
      }
    }
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus(null);
    const targetUrl = appUrl.trim().replace(/\/+$/, "");

    try {
      const parsed = new URL(targetUrl);
      const origin = parsed.origin;
      const isLoopback = isLocalUrl(targetUrl);

      if (parsed.protocol !== "https:" && !isLoopback) {
        setSaveStatus({ message: "Remote URLs must use HTTPS", isError: true });
        return;
      }

      if (!isLoopback) {
        const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
        if (!granted) {
          setSaveStatus({
            message: "Sourcefold needs permission to reach that address.",
            isError: true,
          });
          return;
        }
      }
    } catch {
      setSaveStatus({ message: "Please enter a valid URL", isError: true });
      return;
    }

    await saveSettings({ appUrl, token, connectionMode });
    invalidateTargetCache();
    setSaveStatus({ message: "Saved", isError: false });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      // Force fresh resolution with the current form values
      const currentSettings = { appUrl, token, connectionMode };
      const target = await resolveTarget({
        forceRefresh: true,
        settings: currentSettings,
      });

      if (target.type === "error") {
        setTestResult({
          message: target.displayLabel,
          isError: true,
        });
        return;
      }

      if (target.type === "desktop-web") {
        const headers: Record<string, string> = {
          Accept: "application/json",
          Authorization: `Bearer ${target.token}`,
        };
        const response = await fetch(`${target.webUrl}/api/folders`, {
          method: "GET",
          headers,
        });

        if (response.status === 401) {
          setTestResult({
            message: "Your access token isn't valid. Check your sign-in in the desktop app.",
            isError: true,
          });
          return;
        }

        const body = await response.json().catch(() => null);
        const data = unwrapResponse<any>(body);
        const count = Array.isArray(data) ? data.length : 0;
        const emailNotice = target.email ? ` as ${target.email}` : "";
        setTestResult({
          message: `Connected to your account at ${target.webUrl}${emailNotice} (via desktop app). ${count} folders.`,
          isError: false,
        });
        return;
      }

      if (target.type === "desktop-offline") {
        if (target.transport === "native") {
          try {
            const raw = await sendNativeMessage<any>({ type: "list_folders" });
            const folders = unwrapResponse<Folder[]>(raw);
            const count = Array.isArray(folders) ? folders.length : 0;
            setTestResult({
              message: `Connected to this computer (desktop app, offline via native messaging). ${count} folders.`,
              isError: false,
            });
            return;
          } catch {
            // Fall back to testing local HTTP
          }
        }

        const res = await localServerFetch("/api/folders");
        if (res.ok) {
          const body = await res.json().catch(() => null);
          const data = unwrapResponse<any>(body);
          const count = Array.isArray(data) ? data.length : 0;
          setTestResult({
            message: `Connected to this computer (desktop app, offline via local HTTP). ${count} folders.`,
            isError: false,
          });
          return;
        }

        setTestResult({
          message: "Couldn't reach Sourcefold desktop app. Check that the app is running.",
          isError: true,
        });
        return;
      }

      if (target.type === "web") {
        const headers: Record<string, string> = {
          Accept: "application/json",
        };
        if (target.token) {
          headers["Authorization"] = `Bearer ${target.token}`;
        }
        const response = await fetch(`${target.webUrl}/api/folders`, {
          method: "GET",
          headers,
        });

        if (response.status === 401) {
          setTestResult({
            message: "Your access token isn't valid. Create a new one in Sourcefold's Settings.",
            isError: true,
          });
          return;
        }

        const body = await response.json().catch(() => null);
        const data = unwrapResponse<any>(body);
        if (response.ok && Array.isArray(data)) {
          const count = data.length;
          setTestResult({
            message: `Connected to ${target.webUrl}. ${count} folders.`,
            isError: false,
          });
          return;
        }

        const errMsg =
          body?.error?.message ||
          `Couldn't reach Sourcefold at ${target.webUrl}. Check the address in settings.`;
        setTestResult({
          message: errMsg,
          isError: true,
        });
        return;
      }

      // Unconfigured target
      setTestResult({
        message: target.displayLabel,
        isError: true,
      });
    } catch (err: any) {
      setTestResult({
        message: err?.message || "Failed to test connection.",
        isError: true,
      });
    } finally {
      setIsTesting(false);
    }
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

  return (
    <div className="options-page">
      <div className="options-container">
        <h1 className="options-title">Sourcefold extension settings</h1>

        <form className="options-form" onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label" htmlFor="connectionMode">
              Connection mode
            </label>
            <select
              id="connectionMode"
              className="input-field"
              value={connectionMode}
              onChange={(e) => {
                setConnectionMode(e.target.value as ConnectionMode);
                setSaveStatus(null);
                setTestResult(null);
              }}
            >
              <option value="auto">Auto (recommended)</option>
              <option value="desktop">Desktop app only</option>
              <option value="web">Web app only</option>
            </select>
            <p className="form-help">
              Auto resolves saves using the desktop app session when open, falling back to offline
              or web settings.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="appUrl">
              Web app address
            </label>
            <input
              id="appUrl"
              type="text"
              className="input-field"
              value={appUrl}
              onChange={(e) => {
                setAppUrl(e.target.value);
                setSaveStatus(null);
                setTestResult(null);
              }}
              placeholder="http://localhost:3000"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="accessToken">
              Access token
            </label>
            <input
              id="accessToken"
              type="password"
              className="input-field mono"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setSaveStatus(null);
                setTestResult(null);
              }}
              placeholder="Paste token here"
            />
            <p className="form-help">
              Only needed for Web app only mode or as a fallback when the desktop app isn't running.
            </p>
          </div>

          <div className="options-buttons">
            <button type="submit" className="btn-primary">
              Save
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting ? "Testing\u2026" : "Test connection"}
            </button>
          </div>

          {saveStatus && (
            <p
              className={`status-message ${saveStatus.isError ? "status-error" : "status-success"}`}
            >
              {saveStatus.message}
            </p>
          )}

          {testResult && (
            <p
              className={`status-message ${testResult.isError ? "status-error" : "status-success"}`}
            >
              {testResult.message}
            </p>
          )}
        </form>

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
              onClick={handleRegisterNativeHost}
              disabled={isRegistering}
            >
              {isRegistering ? "Registering\u2026" : "Register native host"}
            </button>
          </div>
          {registerResult && (
            <p
              className={`status-message ${
                registerResult.isError ? "status-error" : "status-success"
              }`}
            >
              {registerResult.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
