import React, { useEffect, useState } from "react";
import { getSettings, saveSettings } from "../../lib/settings";

export default function App() {
  const [appUrl, setAppUrl] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [testResult, setTestResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    async function load() {
      const settings = await getSettings();
      setAppUrl(settings.appUrl);
      setToken(settings.token);
    }
    load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings({ appUrl, token });
    setSaveStatus("Saved");
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const targetUrl = appUrl.trim().replace(/\/+$/, "");
    try {
      const response = await fetch(`${targetUrl}/api/health`);
      if (response.status === 200) {
        const data = await response.json();
        if (data && data.status === "ok") {
          setTestResult({ message: "Connected to Sourcefold", isError: false });
          return;
        }
      }
      setTestResult({
        message: `Couldn't reach Sourcefold at ${targetUrl}. Check the URL and that the app is running.`,
        isError: true,
      });
    } catch {
      setTestResult({
        message: `Couldn't reach Sourcefold at ${targetUrl}. Check the URL and that the app is running.`,
        isError: true,
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="options-page">
      <div className="options-container">
        <h1 className="options-title">Sourcefold extension settings</h1>

        <form className="options-form" onSubmit={handleSave}>
          <div className="form-group">
            <label className="form-label" htmlFor="appUrl">
              App URL
            </label>
            <input
              id="appUrl"
              type="text"
              className="input-field"
              value={appUrl}
              onChange={(e) => {
                setAppUrl(e.target.value);
                setSaveStatus("");
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
                setSaveStatus("");
              }}
              placeholder="Paste token here"
            />
            <p className="form-help">Create a token in the Sourcefold app under Settings.</p>
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
              {isTesting ? "Testing..." : "Test connection"}
            </button>
          </div>

          {saveStatus && <p className="status-message status-success">{saveStatus}</p>}

          {testResult && (
            <p
              className={`status-message ${testResult.isError ? "status-error" : "status-success"}`}
            >
              {testResult.message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
