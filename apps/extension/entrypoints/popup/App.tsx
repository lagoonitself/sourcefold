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
  ApiError,
  type Folder,
  type RecentXItem,
} from "../../lib/api";
import {
  buildFolderTree,
  buildProjectSections,
  pickDefaultGroup,
  projectIdOf,
  type FolderTreeItem,
} from "../../lib/folder-tree";
import { getLastFolderId, setLastFolderId } from "../../lib/last-folder";
import { capturePage } from "../../lib/capture-page";
import { resolveTarget, type ResolvedTarget } from "../../lib/target";
import { hasHostPermission, hostOf, requestHostPermission } from "../../lib/permissions";

const FOLDER_TREE_CACHE_KEY = "sourcefold:folderTreeCache";

interface FolderTreeCache {
  targetKey: string;
  timestamp: number;
  folders: Folder[];
  tree: FolderTreeItem[];
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedTarget | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [permissionHost, setPermissionHost] = useState<string>("");

  const [tabTitle, setTabTitle] = useState("");
  const [tabUrl, setTabUrl] = useState("");
  const [tabId, setTabId] = useState<number | null>(null);
  const [detectedSource, setDetectedSource] = useState<SourceKind | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderTree, setFolderTree] = useState<FolderTreeItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");

  // Combobox filterable dropdown state
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const comboboxInputRef = useRef<HTMLInputElement>(null);
  const comboboxListRef = useRef<HTMLUListElement>(null);

  // Groups that already hold this page. A page is saved once per group.
  const [savedGroupIds, setSavedGroupIds] = useState<Set<string>>(() => new Set());

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
  const [threadsProjectId, setThreadsProjectId] = useState<string | null>(null);
  const [addingToThreadId, setAddingToThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<{ message: string; isError: boolean } | null>(
    null,
  );

  const loadData = async (forceRefresh = false) => {
    try {
      const target = await resolveTarget({ forceRefresh });
      setResolvedTarget(target);

      if (target.type === "unconfigured" || target.type === "error") {
        setLoading(false);
        return;
      }

      // Check host permissions for web targets
      if (target.type === "desktop-web" || target.type === "web") {
        const permitted = await hasHostPermission(target.webUrl);
        if (!permitted) {
          setNeedsPermission(true);
          setPermissionHost(target.webUrl);
          setLoading(false);
          return;
        }
      }
      setNeedsPermission(false);

      const targetKey =
        target.type === "desktop-web" || target.type === "web" ? target.webUrl : "desktop-offline";

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

      // Render cached folder tree immediately if present and matching current target
      const cached = cacheResult[FOLDER_TREE_CACHE_KEY] as FolderTreeCache | undefined;
      if (
        cached &&
        cached.targetKey === targetKey &&
        Array.isArray(cached.folders) &&
        Array.isArray(cached.tree) &&
        cached.tree.length > 0
      ) {
        setFolders(cached.folders);
        setFolderTree(cached.tree);
        setSelectedFolderId(pickDefaultGroup(cached.tree, lastFolderId));
        setLoading(false);
      }

      const loadedFolders = await listFolders();
      setFolders(loadedFolders);
      const tree = buildFolderTree(loadedFolders);
      setFolderTree(tree);

      // Update folder tree cache
      await browser.storage.local.set({
        [FOLDER_TREE_CACHE_KEY]: {
          targetKey,
          timestamp: Date.now(),
          folders: loadedFolders,
          tree,
        },
      });

      // Set selected folder ID
      const defaultGroupId = pickDefaultGroup(tree, lastFolderId);
      setSelectedFolderId(defaultGroupId);
      if (defaultGroupId && defaultGroupId !== lastFolderId) {
        await setLastFolderId(defaultGroupId);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        // Re-resolve
        const target = await resolveTarget({ forceRefresh: true });
        setResolvedTarget(target);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load Sourcefold data.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard navigation: Escape closes popup or cancels; Enter saves
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (newFolderOpen) {
          setNewFolderOpen(false);
          setNewFolderName("");
          return;
        }
        if (comboboxOpen) {
          setComboboxOpen(false);
          return;
        }
        window.close();
        return;
      }

      if (e.key === "Enter") {
        // Don't intercept Enter inside new folder inline input or open combobox menu
        if (newFolderOpen || comboboxOpen) {
          return;
        }
        const activeTag = (document.activeElement?.tagName || "").toLowerCase();
        if (activeTag === "button" || activeTag === "a" || activeTag === "textarea") {
          return;
        }
        e.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [newFolderOpen, comboboxOpen, tabUrl, selectedFolderId, isSaving]);

  // Check the selected group each time it changes
  useEffect(() => {
    if (!resolvedTarget || resolvedTarget.type === "unconfigured" || !tabUrl || !selectedFolderId) {
      return;
    }
    let ignore = false;
    checkUrl(tabUrl, selectedFolderId)
      .then((result) => {
        if (!ignore && result.exists) {
          setSavedGroupIds((prev) => new Set(prev).add(selectedFolderId));
        }
      })
      .catch(() => {
        // Save itself reports duplicates, so failed check is ignored
      });
    return () => {
      ignore = true;
    };
  }, [resolvedTarget, tabUrl, selectedFolderId]);

  const openSettings = () => {
    browser.runtime.openOptionsPage();
  };

  const handleGrantPermission = async () => {
    if (!permissionHost) return;
    const granted = await requestHostPermission(permissionHost);
    if (granted) {
      setNeedsPermission(false);
      setLoading(true);
      await loadData(true);
    }
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
  const isAlreadySaved = savedGroupIds.has(selectedFolderId);

  // Flattened group list with project names for type-to-filter combobox
  interface FlatGroupItem {
    id: string;
    name: string;
    projectName: string;
  }
  const allGroups: FlatGroupItem[] = [];
  for (const section of projectSections) {
    for (const group of section.groups) {
      allGroups.push({
        id: group.id,
        name: group.name,
        projectName: section.project.name,
      });
    }
  }

  const filteredGroups = allGroups.filter((g) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.projectName.toLowerCase().includes(q);
  });

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

  const markSaved = (item: { folder_id: string }) => {
    setSavedGroupIds((prev) => new Set(prev).add(item.folder_id));
  };

  const selectGroup = (groupId: string) => {
    setSelectedFolderId(groupId);
    setComboboxOpen(false);
    setFilterQuery("");
    setSuccessMessage(null);
    setWarningMessage(null);
    setErrorMessage(null);
  };

  const handleComboboxKeyDown = (e: React.KeyboardEvent) => {
    if (!comboboxOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        setComboboxOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1 < filteredGroups.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredGroups.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredGroups.length > 0 && highlightedIndex < filteredGroups.length) {
        const item = filteredGroups[highlightedIndex];
        if (item) {
          selectGroup(item.id);
        }
      } else {
        setComboboxOpen(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setComboboxOpen(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || isCreatingFolder) return;

    setIsCreatingFolder(true);
    setErrorMessage(null);

    try {
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
      selectGroup(created.id);
      await setLastFolderId(created.id);

      const targetKey =
        resolvedTarget && (resolvedTarget.type === "desktop-web" || resolvedTarget.type === "web")
          ? resolvedTarget.webUrl
          : "desktop-offline";

      await browser.storage.local.set({
        [FOLDER_TREE_CACHE_KEY]: {
          targetKey,
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
    if (!tabUrl || !selectedFolderId || isAlreadySaved) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setSuccessMessage(null);

    const folderName = folderPath(selectedFolderId) ?? "this group";

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
          markSaved({ folder_id: selectedFolderId });
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
    const projectId = projectIdOf(folderTree, selectedFolderId);
    if (details.open && projectId && threadsProjectId !== projectId && !loadingThreads) {
      setLoadingThreads(true);
      try {
        const items = await recentXItems(selectedFolderId);
        setRecentThreads(items);
        setThreadsProjectId(projectId);
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

  const isUnconfigured = !resolvedTarget || resolvedTarget.type === "unconfigured";

  return (
    <div className="popup-container">
      <div className="popup-header">
        <div className="popup-header-content">
          <h1 className="popup-header-title">Sourcefold</h1>
          {!isUnconfigured && resolvedTarget && (
            <span className="popup-target-label">{resolvedTarget.displayLabel}</span>
          )}
        </div>
        <button
          type="button"
          className="btn-icon"
          onClick={openSettings}
          title="Options"
          aria-label="Options"
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

      {resolvedTarget?.type === "error" ? (
        <div className="popup-main">
          <p className="popup-connect-text">{resolvedTarget.displayLabel}</p>
          <div className="popup-actions">
            <button type="button" className="btn-primary" onClick={openSettings}>
              Open options
            </button>
          </div>
        </div>
      ) : isUnconfigured ? (
        <div className="popup-main">
          <p className="popup-connect-text">
            Open the Sourcefold desktop app or set up the web app in Options.
          </p>
          <div className="popup-actions">
            <button type="button" className="btn-primary" onClick={openSettings}>
              Open options
            </button>
          </div>
        </div>
      ) : needsPermission ? (
        <div className="popup-main">
          <div className="popup-permission-banner">
            <p className="popup-permission-text">
              Sourcefold needs permission to reach {hostOf(permissionHost)}.
            </p>
            <button type="button" className="btn-primary btn-sm" onClick={handleGrantPermission}>
              Allow access to {hostOf(permissionHost)}
            </button>
          </div>
        </div>
      ) : (
        <div className="popup-main">
          <h2 className="popup-page-title">{tabTitle}</h2>
          <p className="popup-detected-type">{getDetectedTypeLabel()}</p>

          <div className="popup-folder-section">
            <div className="popup-combobox">
              <input
                ref={comboboxInputRef}
                type="text"
                className="input-field popup-combobox-input"
                placeholder={
                  selectedFolder
                    ? `${folderPath(selectedFolder.id) || selectedFolder.name}`
                    : "Type to filter groups…"
                }
                value={
                  comboboxOpen
                    ? filterQuery
                    : selectedFolder
                      ? folderPath(selectedFolder.id) || selectedFolder.name
                      : ""
                }
                onChange={(e) => {
                  setFilterQuery(e.target.value);
                  setHighlightedIndex(0);
                  if (!comboboxOpen) setComboboxOpen(true);
                }}
                onFocus={() => {
                  setComboboxOpen(true);
                  setHighlightedIndex(0);
                }}
                onKeyDown={handleComboboxKeyDown}
                disabled={!hasGroups || isSaving}
                aria-label="Folder"
                role="combobox"
                aria-expanded={comboboxOpen}
              />

              {comboboxOpen && (
                <ul ref={comboboxListRef} className="popup-combobox-list" role="listbox">
                  {filteredGroups.length === 0 ? (
                    <li className="popup-combobox-empty">No matching groups</li>
                  ) : (
                    filteredGroups.map((item, idx) => (
                      <li
                        key={item.id}
                        role="option"
                        aria-selected={item.id === selectedFolderId}
                        className={`popup-combobox-option ${
                          idx === highlightedIndex ? "is-highlighted" : ""
                        } ${item.id === selectedFolderId ? "is-selected" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectGroup(item.id);
                        }}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                      >
                        <span style={{ color: "var(--muted-foreground)", marginRight: "6px" }}>
                          {item.projectName} /
                        </span>
                        <span>{item.name}</span>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>

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
                    {isCreatingFolder ? "Creating\u2026" : "Create"}
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
              disabled={isSaving || isAlreadySaved || unsupported || !selectedFolderId}
            >
              {isSaving ? "Saving\u2026" : "Save"}
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

            {!successMessage && (warningMessage || isAlreadySaved) && (
              <p className="popup-result popup-result-warning">
                {warningMessage ||
                  `Already saved in ${folderPath(selectedFolderId) ?? "this group"}`}
              </p>
            )}

            {errorMessage && <p className="popup-result popup-result-error">{errorMessage}</p>}
          </div>

          {detectedSource === "x" && (
            <details
              key={projectIdOf(folderTree, selectedFolderId) ?? "none"}
              className="popup-details"
              onToggle={handleDetailsToggle}
            >
              <summary className="popup-summary">Add to this thread</summary>
              <div className="popup-thread-list">
                {loadingThreads && <p className="popup-thread-loading">Loading threads\u2026</p>}
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
                        <span className="popup-thread-item-adding">Adding\u2026</span>
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
