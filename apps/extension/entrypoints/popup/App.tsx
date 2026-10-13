import React, { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { detectSource, xStatusId, type SourceKind } from "@sourcefold/core";
import {
  listFolders,
  createFolder,
  checkUrl,
  saveGrokipedia,
  capture,
  recentXItems,
  addXPost,
  ApiError,
  type Folder,
  type RecentXItem,
} from "../../lib/api";
import { buildFolderTree, formatFolderLabel, type FolderTreeItem } from "../../lib/folder-tree";
import { getLastFolderId, setLastFolderId } from "../../lib/last-folder";
import { capturePage } from "../../lib/capture-page";
import { getSettings } from "../../lib/settings";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [tabTitle, setTabTitle] = useState("");
  const [tabUrl, setTabUrl] = useState("");
  const [tabId, setTabId] = useState<number | null>(null);
  const [detectedSource, setDetectedSource] = useState<SourceKind | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderTree, setFolderTree] = useState<FolderTreeItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");

  const [isAlreadySaved, setIsAlreadySaved] = useState(false);
  const [alreadySavedFolder, setAlreadySavedFolder] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // New folder inline state
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [insideSelected, setInsideSelected] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // X "Add to this thread" state
  const [recentThreads, setRecentThreads] = useState<RecentXItem[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [addingToThreadId, setAddingToThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<{ message: string; isError: boolean } | null>(
    null,
  );

  useEffect(() => {
    async function loadData() {
      try {
        const settings = await getSettings();
        const tokenPresent = Boolean(settings.token && settings.token.trim().length > 0);
        setHasToken(tokenPresent);

        if (!tokenPresent) {
          return;
        }

        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];
        const currentUrl = activeTab?.url ?? "";
        setTabId(activeTab?.id ?? null);
        setTabTitle(activeTab?.title || currentUrl || "Untitled page");
        setTabUrl(currentUrl);

        const source = currentUrl ? detectSource(currentUrl) : null;
        setDetectedSource(source);

        // Load folders, last used folder, and duplicate check in parallel
        const foldersPromise = listFolders();
        const lastFolderPromise = getLastFolderId();
        const checkPromise = currentUrl
          ? checkUrl(currentUrl).catch(() => null)
          : Promise.resolve(null);

        const [loadedFolders, lastFolderId, checkResult] = await Promise.all([
          foldersPromise,
          lastFolderPromise,
          checkPromise,
        ]);

        setFolders(loadedFolders);
        const tree = buildFolderTree(loadedFolders);
        setFolderTree(tree);

        if (tree.length > 0) {
          const first = tree[0];
          if (lastFolderId && tree.some((item) => item.id === lastFolderId)) {
            setSelectedFolderId(lastFolderId);
          } else if (first) {
            setSelectedFolderId(first.id);
          }
        }

        if (checkResult && checkResult.exists) {
          setIsAlreadySaved(true);
          setAlreadySavedFolder(checkResult.folder_name);
        }
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          setHasToken(false);
        } else {
          setErrorMessage(err instanceof Error ? err.message : "Failed to load Sourcefold data.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  const getDetectedTypeLabel = (): string => {
    if (unsupported) {
      return "This page can't be saved. Open a Grokipedia article, a Substack post or an X post.";
    }
    switch (detectedSource) {
      case "grokipedia":
        return "Grokipedia article";
      case "substack":
        return "Substack post";
      case "x":
        return "X post";
      default:
        return "Save this page if it's a Substack post.";
    }
  };

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || isCreatingFolder) return;

    setIsCreatingFolder(true);
    setErrorMessage(null);

    try {
      const parentId = insideSelected && selectedFolderId ? selectedFolderId : null;
      const created = await createFolder({ name: trimmed, parent_id: parentId });
      const updatedFolders = await listFolders();
      setFolders(updatedFolders);
      const tree = buildFolderTree(updatedFolders);
      setFolderTree(tree);
      setSelectedFolderId(created.id);
      await setLastFolderId(created.id);
      setNewFolderOpen(false);
      setNewFolderName("");
      setInsideSelected(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create folder.");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleSave = async () => {
    if (!tabUrl || !selectedFolderId || isSaving || isAlreadySaved) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setSuccessMessage(null);

    const folderName = selectedFolder?.name || "folder";

    try {
      if (detectedSource === "grokipedia") {
        await saveGrokipedia(tabUrl, selectedFolderId);
        await setLastFolderId(selectedFolderId);
        setSuccessMessage(`Saved to ${folderName}`);
        return;
      }

      if (tabId === null) {
        setErrorMessage("No active tab to save.");
        return;
      }

      const captureRes = await capturePage(tabId);

      if (captureRes.kind === "unsupported") {
        setUnsupported(true);
        setErrorMessage(
          "This page can't be saved. Open a Grokipedia article, a Substack post or an X post.",
        );
        return;
      }

      if (captureRes.kind === "error") {
        setErrorMessage(captureRes.message);
        return;
      }

      if (captureRes.kind === "substack") {
        const res = captureRes.result;
        if (res.status === "not_substack") {
          setUnsupported(true);
          setErrorMessage(
            "This page can't be saved. Open a Grokipedia article, a Substack post or an X post.",
          );
          return;
        }

        if (res.status === "paywalled") {
          await capture({
            kind: "substack_unavailable",
            folder_id: selectedFolderId,
            url: res.url,
            title: res.title,
          });
          await setLastFolderId(selectedFolderId);
          setWarningMessage("Paid post, not saved");
          return;
        }

        if (res.status === "ok") {
          await capture({
            kind: "substack",
            folder_id: selectedFolderId,
            capture: res.capture,
          });
          await setLastFolderId(selectedFolderId);
          setSuccessMessage(`Saved to ${folderName}`);
          return;
        }
      }

      if (captureRes.kind === "x") {
        const res = captureRes.result;
        if (res.status === "error") {
          setErrorMessage(res.message);
          return;
        }

        if (res.status === "ok") {
          await capture({
            kind: "x",
            folder_id: selectedFolderId,
            posts: res.posts,
          });
          await setLastFolderId(selectedFolderId);
          setSuccessMessage(`Saved to ${folderName}`);
          return;
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === "duplicate") {
          const destFolder = err.folderName || folderName;
          setWarningMessage(`Already saved in ${destFolder}`);
          setIsAlreadySaved(true);
          return;
        }
        setErrorMessage(err.message);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "Failed to save page.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetailsToggle = async (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const details = e.currentTarget;
    if (details.open && !threadsLoaded && !loadingThreads) {
      setLoadingThreads(true);
      try {
        const items = await recentXItems();
        setRecentThreads(items);
        setThreadsLoaded(true);
      } catch (err: unknown) {
        setThreadStatus({
          message: err instanceof Error ? err.message : "Failed to load recent threads.",
          isError: true,
        });
      } finally {
        setLoadingThreads(false);
      }
    }
  };

  const handleAddToThread = async (item: RecentXItem) => {
    if (tabId === null || !tabUrl || addingToThreadId) return;

    setAddingToThreadId(item.id);
    setThreadStatus(null);

    try {
      const captureRes = await capturePage(tabId);
      if (captureRes.kind !== "x") {
        setThreadStatus({
          message: "This page isn't an X post.",
          isError: true,
        });
        return;
      }

      if (captureRes.result.status === "error") {
        setThreadStatus({
          message: captureRes.result.message,
          isError: true,
        });
        return;
      }

      const posts = captureRes.result.posts;
      if (!posts || posts.length === 0) {
        setThreadStatus({
          message: "No posts found in this thread.",
          isError: true,
        });
        return;
      }

      const tabStatus = xStatusId(tabUrl);
      let postIndex = -1;
      if (tabStatus) {
        postIndex = posts.findIndex((p) => xStatusId(p.postUrl) === tabStatus);
      }
      if (postIndex === -1) {
        postIndex = posts.length - 1;
      }

      const post = posts[postIndex];
      if (!post) {
        setThreadStatus({
          message: "No posts found in this thread.",
          isError: true,
        });
        return;
      }

      const parent_post_url = postIndex > 0 ? posts[postIndex - 1]?.postUrl : undefined;

      await addXPost(item.id, { post, parent_post_url });
      setThreadStatus({
        message: `Added to ${item.title}`,
        isError: false,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === "duplicate") {
          setThreadStatus({
            message: "Already in this thread",
            isError: true,
          });
          return;
        }
        setThreadStatus({
          message: err.message,
          isError: true,
        });
        return;
      }
      setThreadStatus({
        message: err instanceof Error ? err.message : "Failed to add post to thread.",
        isError: true,
      });
    } finally {
      setAddingToThreadId(null);
    }
  };

  if (loading) {
    return <div className="popup-container" />;
  }

  return (
    <div className="popup-container">
      <div className="popup-header">
        <h1 className="popup-header-title">Sourcefold</h1>
        <button
          type="button"
          className="btn-icon"
          onClick={openSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {!hasToken ? (
        <div className="popup-main">
          <p className="popup-connect-text">Connect the extension to your Sourcefold app.</p>
          <div className="popup-actions">
            <button type="button" className="btn-primary" onClick={openSettings}>
              Open settings
            </button>
          </div>
        </div>
      ) : (
        <div className="popup-main">
          <h2 className="popup-page-title">{tabTitle}</h2>
          <p className="popup-detected-type">{getDetectedTypeLabel()}</p>

          <div className="popup-folder-section">
            <select
              className="popup-select"
              value={selectedFolderId}
              onChange={(e) => setSelectedFolderId(e.target.value)}
              disabled={folderTree.length === 0 || isSaving}
            >
              {folderTree.length === 0 ? (
                <option value="">No folders available</option>
              ) : (
                folderTree.map((item) => (
                  <option key={item.id} value={item.id}>
                    {formatFolderLabel(item.name, item.depth)}
                  </option>
                ))
              )}
            </select>

            {!newFolderOpen ? (
              <button type="button" className="btn-text" onClick={() => setNewFolderOpen(true)}>
                New folder
              </button>
            ) : (
              <div className="popup-new-folder">
                <input
                  type="text"
                  className="input-field"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateFolder();
                    } else if (e.key === "Escape") {
                      setNewFolderOpen(false);
                      setNewFolderName("");
                    }
                  }}
                  autoFocus
                />
                {selectedFolder && (
                  <label className="popup-checkbox-label">
                    <input
                      type="checkbox"
                      checked={insideSelected}
                      onChange={(e) => setInsideSelected(e.target.checked)}
                    />
                    <span>Inside {selectedFolder.name}</span>
                  </label>
                )}
                <div className="popup-new-folder-actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                  >
                    {isCreatingFolder ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    onClick={() => {
                      setNewFolderOpen(false);
                      setNewFolderName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="popup-actions">
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={handleSave}
              disabled={
                isSaving ||
                isAlreadySaved ||
                unsupported ||
                folderTree.length === 0 ||
                Boolean(successMessage)
              }
            >
              {isSaving ? "Saving…" : "Save"}
            </button>

            {successMessage && (
              <p className="popup-result popup-result-success">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{successMessage}</span>
              </p>
            )}

            {(warningMessage || (isAlreadySaved && !warningMessage && alreadySavedFolder)) && (
              <p className="popup-result popup-result-warning">
                {warningMessage || `Already saved in ${alreadySavedFolder}`}
              </p>
            )}

            {errorMessage && <p className="popup-result popup-result-error">{errorMessage}</p>}
          </div>

          {detectedSource === "x" && (
            <details className="popup-details" onToggle={handleDetailsToggle}>
              <summary className="popup-summary">Add to this thread</summary>
              <div className="popup-thread-list">
                {loadingThreads && <p className="popup-thread-loading">Loading threads…</p>}
                {!loadingThreads && recentThreads.length === 0 && (
                  <p className="popup-thread-empty">No recent X threads.</p>
                )}
                {!loadingThreads &&
                  recentThreads.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="popup-thread-item"
                      onClick={() => handleAddToThread(item)}
                      disabled={addingToThreadId !== null}
                    >
                      <span className="popup-thread-item-title">{item.title}</span>
                      {addingToThreadId === item.id && (
                        <span className="popup-thread-item-adding">Adding…</span>
                      )}
                    </button>
                  ))}
                {threadStatus && (
                  <p
                    className={`popup-result ${
                      threadStatus.isError ? "popup-result-error" : "popup-result-success"
                    }`}
                  >
                    {!threadStatus.isError && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    <span>{threadStatus.message}</span>
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
