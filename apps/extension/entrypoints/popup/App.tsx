import React, { useEffect, useRef, useState } from "react";
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
  moveItem,
  ApiError,
  type Folder,
  type RecentXItem,
} from "../../lib/api";
import {
  buildFolderTree,
  buildProjectSections,
  formatFolderLabel,
  pickDefaultGroup,
  projectIdOf,
  type FolderTreeItem,
} from "../../lib/folder-tree";
import { getLastFolderId, setLastFolderId } from "../../lib/last-folder";
import { capturePage } from "../../lib/capture-page";
import { getSettings } from "../../lib/settings";

const FOLDER_TREE_CACHE_KEY = "sourcefold:folderTreeCache";

interface FolderTreeCache {
  baseUrl: string;
  timestamp: number;
  folders: Folder[];
  tree: FolderTreeItem[];
}

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
  // The saved item for this page, so it can be moved to another folder
  const [savedItem, setSavedItem] = useState<{ id: string; folderId: string } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Synchronous in-flight guards to prevent double-submit or concurrent operations
  const isSavingRef = useRef(false);
  const isAddingToThreadRef = useRef(false);

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
          setLoading(false);
          return;
        }

        const baseUrl = settings.appUrl.replace(/\/+$/, "");

        // Concurrently read tabs, last folder ID, and cached folder tree
        const [tabs, lastFolderId, cacheResult] = await Promise.all([
          browser.tabs.query({ active: true, currentWindow: true }),
          getLastFolderId(),
          browser.storage.local.get([FOLDER_TREE_CACHE_KEY]),
        ]);

        const activeTab = tabs[0];
        const currentUrl = activeTab?.url ?? "";
        setTabId(activeTab?.id ?? null);
        setTabTitle(activeTab?.title || currentUrl || "Untitled page");
        setTabUrl(currentUrl);

        const source = currentUrl ? detectSource(currentUrl) : null;
        setDetectedSource(source);

        // Render cached folder tree immediately if present and matching current base URL
        const cached = cacheResult[FOLDER_TREE_CACHE_KEY] as FolderTreeCache | undefined;
        if (
          cached &&
          cached.baseUrl === baseUrl &&
          Array.isArray(cached.folders) &&
          Array.isArray(cached.tree) &&
          cached.tree.length > 0
        ) {
          setFolders(cached.folders);
          setFolderTree(cached.tree);
          setSelectedFolderId(pickDefaultGroup(cached.tree, lastFolderId));
          setLoading(false);
        }

        // Run independent API calls in parallel: refresh folder tree + duplicate check concurrently
        const foldersPromise = listFolders();
        const checkPromise = currentUrl
          ? checkUrl(currentUrl).catch(() => null)
          : Promise.resolve(null);

        const [loadedFolders, checkResult] = await Promise.all([foldersPromise, checkPromise]);

        setFolders(loadedFolders);
        const tree = buildFolderTree(loadedFolders);
        setFolderTree(tree);

        // Update folder tree cache
        await browser.storage.local.set({
          [FOLDER_TREE_CACHE_KEY]: {
            baseUrl,
            timestamp: Date.now(),
            folders: loadedFolders,
            tree,
          },
        });

        // Set selected folder ID: if lastFolderId is in the tree, use it; otherwise fallback and persist
        const defaultGroupId = pickDefaultGroup(tree, lastFolderId);
        setSelectedFolderId(defaultGroupId);
        if (defaultGroupId && defaultGroupId !== lastFolderId) {
          await setLastFolderId(defaultGroupId);
        }

        if (checkResult && checkResult.exists) {
          setIsAlreadySaved(true);
          setAlreadySavedFolder(checkResult.folder_name);
          setSavedItem({ id: checkResult.item_id, folderId: checkResult.folder_id });
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
  const projectSections = buildProjectSections(folderTree);
  const hasGroups = projectSections.some((section) => section.groups.length > 0);
  const canMove =
    savedItem !== null && selectedFolderId !== "" && savedItem.folderId !== selectedFolderId;

  // "Parent / Child" so a save into a subfolder is easy to find in the app
  const folderPath = (folderId: string): string | null => {
    const names: string[] = [];
    const seen = new Set<string>();
    let current = folders.find((f) => f.id === folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      const parentId = current.parent_id;
      current = parentId ? folders.find((f) => f.id === parentId) : undefined;
    }
    return names.length > 0 ? names.join(" / ") : null;
  };

  const markSaved = (item: { id: string; folder_id: string }) => {
    setIsAlreadySaved(true);
    setSavedItem({ id: item.id, folderId: item.folder_id });
  };

  const handleMove = async () => {
    if (!savedItem || !canMove || isSavingRef.current) return;

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setSuccessMessage(null);

    try {
      await moveItem(savedItem.id, selectedFolderId);
      await setLastFolderId(selectedFolderId);
      setSavedItem({ id: savedItem.id, folderId: selectedFolderId });
      setSuccessMessage(`Moved to ${folderPath(selectedFolderId) ?? "folder"}`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to move the page.");
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || isCreatingFolder) return;

    setIsCreatingFolder(true);
    setErrorMessage(null);

    try {
      // A new group goes into the selected group's project, or inside the group if ticked.
      const parentId =
        insideSelected && selectedFolderId
          ? selectedFolderId
          : (projectIdOf(folderTree, selectedFolderId) ?? projectSections[0]?.project.id ?? null);
      if (!parentId) return;
      const created = await createFolder({ name: trimmed, parent_id: parentId });
      const updatedFolders = await listFolders();
      setFolders(updatedFolders);
      const tree = buildFolderTree(updatedFolders);
      setFolderTree(tree);
      setSelectedFolderId(created.id);
      await setLastFolderId(created.id);

      const settings = await getSettings();
      const baseUrl = settings.appUrl.replace(/\/+$/, "");
      await browser.storage.local.set({
        [FOLDER_TREE_CACHE_KEY]: {
          baseUrl,
          timestamp: Date.now(),
          folders: updatedFolders,
          tree,
        },
      });

      setNewFolderOpen(false);
      setNewFolderName("");
      setInsideSelected(false);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to create group.");
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const handleSave = async () => {
    if (isSavingRef.current || isAddingToThreadRef.current) {
      return;
    }
    if (canMove) {
      await handleMove();
      return;
    }
    if (!tabUrl || !selectedFolderId || isAlreadySaved) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setSuccessMessage(null);

    const folderName = folderPath(selectedFolderId) ?? "folder";

    try {
      if (detectedSource === "grokipedia") {
        const { item } = await saveGrokipedia(tabUrl, selectedFolderId);
        await setLastFolderId(selectedFolderId);
        markSaved(item);
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
          const { item } = await capture({
            kind: "substack_unavailable",
            folder_id: selectedFolderId,
            url: res.url,
            title: res.title,
          });
          await setLastFolderId(selectedFolderId);
          markSaved(item);
          setWarningMessage("Paid post, not saved");
          return;
        }

        if (res.status === "ok") {
          const { item } = await capture({
            kind: "substack",
            folder_id: selectedFolderId,
            capture: res.capture,
          });
          await setLastFolderId(selectedFolderId);
          markSaved(item);
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
          const { item } = await capture({
            kind: "x",
            folder_id: selectedFolderId,
            posts: res.posts,
          });
          await setLastFolderId(selectedFolderId);
          markSaved(item);
          setSuccessMessage(`Saved to ${folderName}`);
          return;
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === "duplicate") {
          setIsAlreadySaved(true);
          const existing = await checkUrl(tabUrl).catch(() => null);
          if (existing?.exists) {
            setAlreadySavedFolder(existing.folder_name);
            setSavedItem({ id: existing.item_id, folderId: existing.folder_id });
          } else {
            setWarningMessage(`Already saved in ${err.folderName || folderName}`);
          }
          return;
        }
        setErrorMessage(err.message);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : "Failed to save page.");
    } finally {
      isSavingRef.current = false;
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
    if (isSavingRef.current || isAddingToThreadRef.current) {
      return;
    }
    if (tabId === null || !tabUrl) return;

    isAddingToThreadRef.current = true;
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
      const postIndex = tabStatus ? posts.findIndex((p) => xStatusId(p.postUrl) === tabStatus) : -1;

      if (postIndex === -1) {
        setThreadStatus({
          message: "Couldn't find the post on this page. Scroll to it and try again.",
          isError: true,
        });
        return;
      }

      const post = posts[postIndex];
      if (!post) {
        setThreadStatus({
          message: "Couldn't find the post on this page. Scroll to it and try again.",
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
      isAddingToThreadRef.current = false;
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
              disabled={!hasGroups || isSaving}
            >
              {!hasGroups ? (
                <option value="">No groups yet</option>
              ) : (
                projectSections
                  .filter((section) => section.groups.length > 0)
                  .map((section) => (
                    <optgroup key={section.project.id} label={section.project.name}>
                      {section.groups.map((item) => (
                        <option key={item.id} value={item.id}>
                          {formatFolderLabel(item.name, item.depth - 1)}
                        </option>
                      ))}
                    </optgroup>
                  ))
              )}
            </select>

            {projectSections.length === 0 ? (
              <p className="popup-detected-type">Create a project in Sourcefold first.</p>
            ) : !newFolderOpen ? (
              <button type="button" className="btn-text" onClick={() => setNewFolderOpen(true)}>
                New group
              </button>
            ) : (
              <div className="popup-new-folder">
                <input
                  type="text"
                  className="input-field"
                  placeholder="Group name"
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
                isSaving || (isAlreadySaved && !canMove) || unsupported || folderTree.length === 0
              }
            >
              {isSaving ? (canMove ? "Moving…" : "Saving…") : canMove ? "Move here" : "Save"}
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

            {!successMessage &&
              (warningMessage || (isAlreadySaved && (savedItem || alreadySavedFolder))) && (
                <p className="popup-result popup-result-warning">
                  {warningMessage ||
                    `Already saved in ${
                      (savedItem && folderPath(savedItem.folderId)) || alreadySavedFolder
                    }`}
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
                      disabled={addingToThreadId !== null || isSaving}
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
