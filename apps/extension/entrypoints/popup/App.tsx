import React, { useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { xStatusId } from "@sourcefold/core";
import {
  Check,
  CircleAlert,
  Cloud,
  CornerDownLeft,
  HardDrive,
  Laptop,
  LoaderCircle,
  Settings,
} from "lucide-react";
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
  pickGroupInProject,
  pickStartingPlace,
  type FolderTreeItem,
  type ProjectSection,
} from "../../lib/folder-tree";
import { getLastPlaces, rememberPlace, type LastPlaces } from "../../lib/last-folder";
import { capturePage, type CaptureResult } from "../../lib/capture-page";
import { resolveTarget } from "../../lib/target";
import { hasHostPermission, hostOf, requestHostPermission } from "../../lib/permissions";
import { hostLabel, pageKindLabel, pageKindOf, type PageKind } from "../../lib/page-kind";
import {
  readPopupCache,
  snapshotOf,
  writePopupCache,
  type TargetSnapshot,
} from "../../lib/popup-cache";
import { SourceIcon, sourceColor } from "./SourceMark";
import { ProjectMenu } from "./ProjectMenu";
import { GroupList, type VisibleGroup } from "./GroupList";
import { ThreadPicker } from "./ThreadPicker";

const CANNOT_SAVE_MESSAGE =
  "This page can't be saved. Open a web page, YouTube video, Reddit, Hacker News or Bluesky post, Substack post, Grokipedia article or X post.";

const GROUP_FILTER_FROM = 7;
const NO_PLACES: LastPlaces = { groupId: null, projectId: null, groupByProject: {} };

type Blocker =
  { kind: "setup" } | { kind: "error"; message: string } | { kind: "permission"; webUrl: string };

interface PageInfo {
  tabId: number | null;
  url: string;
  title: string;
  kind: PageKind | null;
}

interface Place {
  projectId: string;
  groupId: string;
}

type Result = { tone: "warning" | "error"; text: string };

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The open project's groups as the list shows them: a tree, or matching names while filtering. */
function visibleGroupsOf(
  section: ProjectSection | undefined,
  tree: FolderTreeItem[],
  query: string,
): VisibleGroup[] {
  if (!section) return [];
  const q = query.trim().toLowerCase();
  if (!q) return section.groups.map((item) => ({ item, level: item.depth - 1 }));
  const byId = new Map(tree.map((item) => [item.id, item]));
  const hintOf = (item: FolderTreeItem) => {
    const names: string[] = [];
    let parent = item.parentId ? byId.get(item.parentId) : undefined;
    while (parent && parent.depth > 0 && names.length < 20) {
      names.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return names.length ? names.join(" / ") : undefined;
  };
  return section.groups
    .filter((item) => item.name.toLowerCase().includes(q))
    .map((item) => ({ item, level: 0, hint: hintOf(item) }));
}

function TargetBadge({ target }: { target: TargetSnapshot }) {
  const { Icon, text } =
    target.type === "desktop-offline"
      ? { Icon: HardDrive, text: "This computer" }
      : target.type === "desktop-web"
        ? { Icon: Laptop, text: "Desktop app" }
        : { Icon: Cloud, text: hostOf(target.key) };
  return (
    <span className="target-badge" title={target.displayLabel}>
      <Icon size={13} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

export default function App() {
  const [page, setPage] = useState<PageInfo | null>(null);
  const [pageNote, setPageNote] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const [target, setTarget] = useState<TargetSnapshot | null>(null);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [booting, setBooting] = useState(true);
  const [ready, setReady] = useState(false);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [place, setPlaceState] = useState<Place>({ projectId: "", groupId: "" });
  const [query, setQuery] = useState("");
  const [savedGroupIds, setSavedGroupIds] = useState<Set<string>>(() => new Set());
  const [justSavedId, setJustSavedId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [newProjectName, setNewProjectName] = useState("");

  const startedRef = useRef(false);
  const placesRef = useRef<LastPlaces>(NO_PLACES);
  const placeRef = useRef<Place>(place);
  const foldersRef = useRef<Folder[]>([]);
  const savedRef = useRef(savedGroupIds);
  const userPickedRef = useRef(false);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const captureRef = useRef<Promise<CaptureResult> | null>(null);
  const busyRef = useRef(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});

  savedRef.current = savedGroupIds;

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const sections = useMemo(() => buildProjectSections(tree), [tree]);
  const section = sections.find((s) => s.project.id === place.projectId);
  const visibleGroups = useMemo(
    () => visibleGroupsOf(section, tree, query),
    [section, tree, query],
  );
  const selectedGroup = tree.find((item) => item.id === place.groupId && item.depth > 0);
  const showFilter = (section?.groups.length ?? 0) >= GROUP_FILTER_FROM;
  const isAlreadySaved = Boolean(place.groupId) && savedGroupIds.has(place.groupId);

  const setPlace = (next: Place) => {
    placeRef.current = next;
    setPlaceState(next);
  };

  const remember = (next: Place) => {
    if (!next.projectId) return;
    void rememberPlace(placesRef.current, next.projectId, next.groupId || null)
      .then((places) => {
        placesRef.current = places;
      })
      .catch(() => {});
  };

  const applyFolders = (next: Folder[]) => {
    foldersRef.current = next;
    setFolders(next);
    const nextTree = buildFolderTree(next);
    const current = placeRef.current;
    if (userPickedRef.current) {
      const kept = buildProjectSections(nextTree).find((s) => s.project.id === current.projectId);
      if (kept) {
        const groupId = kept.groups.some((g) => g.id === current.groupId)
          ? current.groupId
          : pickGroupInProject(kept, placesRef.current.groupByProject);
        setPlace({ projectId: current.projectId, groupId });
        return;
      }
    }
    setPlace(pickStartingPlace(nextTree, placesRef.current));
  };

  const folderPath = (folderId: string): string => {
    const all = foldersRef.current;
    const names: string[] = [];
    const seen = new Set<string>();
    let current = all.find((f) => f.id === folderId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.name);
      const parentId = current.parent_id;
      current = parentId ? all.find((f) => f.id === parentId) : undefined;
    }
    return names.length > 0 ? names.join(" / ") : "this group";
  };

  // Shows what Save will do before it's pressed: the clean title, or why the page can't be saved.
  const previewCapture = (res: CaptureResult) => {
    if (res.kind === "unsupported") {
      setUnsupported(true);
      return;
    }
    if (res.kind === "error") {
      setPageNote(res.message);
      return;
    }
    const retitle = (title: string | undefined) => {
      if (title) setPage((p) => (p ? { ...p, title } : p));
    };
    if (res.kind === "substack") {
      if (res.result.status === "not_substack") setUnsupported(true);
      else if (res.result.status === "paywalled") setPageNote("Paid post, not saved");
      else if (res.result.status === "ok") retitle(res.result.capture.title);
    } else if (res.kind === "source") {
      const kind = res.result.kind;
      setPage((p) => (p ? { ...p, kind } : p));
      if (res.result.status === "unavailable") {
        retitle(res.result.title);
        setPageNote(res.result.reason);
      } else {
        retitle(res.result.capture.title);
      }
    } else if (res.kind === "x" && res.result.status === "error") {
      setPageNote(res.result.message);
    }
  };

  // The capture script is large; injecting and running it while the user looks at the popup
  // makes Save nearly instant. It only reads the page.
  const getCapture = (tabId: number): Promise<CaptureResult> => {
    if (!captureRef.current) {
      const run = capturePage(tabId);
      captureRef.current = run;
      void run.then((res) => {
        if (captureRef.current === run) previewCapture(res);
      });
    }
    return captureRef.current;
  };

  const refresh = async (cachedKey: string | null): Promise<void> => {
    try {
      const resolved = await resolveTarget({ forceRefresh: true });
      if (resolved.type === "unconfigured") {
        setBlocker({ kind: "setup" });
        return;
      }
      if (resolved.type === "error") {
        setBlocker({ kind: "error", message: resolved.displayLabel });
        return;
      }
      if (
        (resolved.type === "web" || resolved.type === "desktop-web") &&
        !(await hasHostPermission(resolved.webUrl))
      ) {
        setBlocker({ kind: "permission", webUrl: resolved.webUrl });
        return;
      }
      setBlocker(null);
      const snapshot = snapshotOf(resolved);
      setTarget(snapshot);
      if (snapshot.key !== cachedKey) {
        userPickedRef.current = false;
        setSavedGroupIds(new Set());
      }
      const fresh = await listFolders();
      applyFolders(fresh);
      setReady(true);
      void writePopupCache({ target: snapshot, folders: fresh }).catch(() => {});
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        setBlocker({ kind: "error", message: err.message });
      } else {
        setResult({ tone: "error", text: errorText(err, "Couldn't load your projects.") });
      }
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const [tabs, cache, places] = await Promise.all([
        browser.tabs.query({ active: true, currentWindow: true }),
        readPopupCache().catch(() => null),
        getLastPlaces().catch(() => NO_PLACES),
      ]);
      placesRef.current = places;

      const tab = tabs[0];
      const url = tab?.url ?? "";
      const kind = pageKindOf(url);
      setPage({ tabId: tab?.id ?? null, url, title: tab?.title || url || "Untitled page", kind });
      if (!kind) setUnsupported(true);
      else if (kind !== "grokipedia" && tab?.id != null) getCapture(tab.id);

      if (cache) {
        setTarget(cache.target);
        applyFolders(cache.folders);
        setBooting(false);
      }
      readyRef.current = refresh(cache?.target.key ?? null);
    })();
    // Runs once per popup open.
  }, []);

  // Is the page already in the picked group? A page is saved once per group.
  useEffect(() => {
    const groupId = place.groupId;
    if (!ready || !page?.url || unsupported || !groupId || savedRef.current.has(groupId)) return;
    let ignore = false;
    checkUrl(page.url, groupId)
      .then((res) => {
        if (!ignore && res.exists) setSavedGroupIds((prev) => new Set(prev).add(groupId));
      })
      .catch(() => {
        // Save reports duplicates itself.
      });
    return () => {
      ignore = true;
    };
  }, [ready, page?.url, unsupported, place.groupId]);

  const selectGroup = (groupId: string) => {
    userPickedRef.current = true;
    const next = { projectId: placeRef.current.projectId, groupId };
    setPlace(next);
    setResult(null);
    remember(next);
  };

  const selectProject = (projectId: string) => {
    userPickedRef.current = true;
    const target = buildProjectSections(buildFolderTree(foldersRef.current)).find(
      (s) => s.project.id === projectId,
    );
    const next = {
      projectId,
      groupId: target ? pickGroupInProject(target, placesRef.current.groupByProject) : "",
    };
    setPlace(next);
    setQuery("");
    setResult(null);
    remember(next);
  };

  const changeQuery = (next: string) => {
    setQuery(next);
    const matches = visibleGroupsOf(section, tree, next);
    if (matches.length && !matches.some((g) => g.item.id === placeRef.current.groupId)) {
      selectGroup(matches[0]!.item.id);
    }
  };

  const moveSelection = (step: number) => {
    if (!visibleGroups.length) return;
    const index = visibleGroups.findIndex((g) => g.item.id === placeRef.current.groupId);
    const next =
      index === -1
        ? step > 0
          ? 0
          : visibleGroups.length - 1
        : (index + step + visibleGroups.length) % visibleGroups.length;
    selectGroup(visibleGroups[next]!.item.id);
  };

  const cacheFolders = (next: Folder[]) => {
    const snapshot = target;
    if (snapshot) void writePopupCache({ target: snapshot, folders: next }).catch(() => {});
  };

  // Shows the new folder at once, then reloads the list for its real counts.
  const addFolderLocally = (created: Folder) => {
    applyFolders([...foldersRef.current, { ...created, item_count: created.item_count ?? 0 }]);
    void listFolders()
      .then((fresh) => {
        applyFolders(fresh);
        cacheFolders(fresh);
      })
      .catch(() => {});
  };

  const createGroup = async (name: string, insideSelected: boolean): Promise<boolean> => {
    const { projectId, groupId } = placeRef.current;
    const parentId = insideSelected && groupId ? groupId : projectId;
    if (!parentId) return false;
    setResult(null);
    try {
      const created = await createFolder({ name, parent_id: parentId });
      userPickedRef.current = true;
      const next = { projectId, groupId: created.id };
      placeRef.current = next;
      addFolderLocally(created);
      setQuery("");
      setPlace(next);
      remember(next);
      return true;
    } catch (err: unknown) {
      setResult({ tone: "error", text: errorText(err, "Couldn't create the group.") });
      return false;
    }
  };

  const createProject = async (name: string): Promise<boolean> => {
    setResult(null);
    try {
      const created = await createFolder({ name, parent_id: null });
      userPickedRef.current = true;
      const next = { projectId: created.id, groupId: "" };
      placeRef.current = next;
      addFolderLocally(created);
      setQuery("");
      setPlace(next);
      remember(next);
      return true;
    } catch (err: unknown) {
      setResult({ tone: "error", text: errorText(err, "Couldn't create the project.") });
      return false;
    }
  };

  const handleSave = async (groupOverride?: string) => {
    if (busyRef.current || !page?.url || unsupported) return;
    busyRef.current = true;
    setSaving(true);
    setResult(null);

    try {
      // A cached list may belong to a library that has since changed; wait for the fresh one.
      await readyRef.current;
      const groupId =
        groupOverride && foldersRef.current.some((f) => f.id === groupOverride)
          ? groupOverride
          : placeRef.current.groupId;
      if (!groupId || savedRef.current.has(groupId)) return;

      const done = (item: { folder_id: string }, warning?: string) => {
        setSavedGroupIds((prev) => new Set(prev).add(item.folder_id));
        setJustSavedId(item.folder_id);
        applyFolders(
          foldersRef.current.map((f) =>
            f.id === item.folder_id ? { ...f, item_count: (f.item_count ?? 0) + 1 } : f,
          ),
        );
        remember({ projectId: placeRef.current.projectId, groupId: item.folder_id });
        if (warning) setResult({ tone: "warning", text: warning });
      };

      if (page.kind === "grokipedia") {
        const { item } = await saveGrokipedia(page.url, groupId);
        done(item);
        return;
      }

      if (page.tabId === null) {
        setResult({ tone: "error", text: "No active tab to save." });
        return;
      }

      const captured = await getCapture(page.tabId);
      if (captured.kind === "unsupported") {
        captureRef.current = null;
        setUnsupported(true);
        return;
      }
      if (captured.kind === "error") {
        captureRef.current = null;
        setResult({ tone: "error", text: captured.message });
        return;
      }

      if (captured.kind === "substack") {
        const res = captured.result;
        if (res.status === "not_substack") {
          setUnsupported(true);
          return;
        }
        if (res.status === "paywalled") {
          const { item } = await capture({
            kind: "substack_unavailable",
            folder_id: groupId,
            url: res.url,
            title: res.title,
          });
          done(item, "Paid post, not saved");
          return;
        }
        const { item } = await capture({
          kind: "substack",
          folder_id: groupId,
          capture: res.capture,
        });
        done(item);
        return;
      }

      if (captured.kind === "source") {
        const res = captured.result;
        if (res.status === "unavailable") {
          const { item } = await capture({
            kind: "source_unavailable",
            folder_id: groupId,
            source: res.kind,
            url: res.url,
            title: res.title,
            reason: res.reason,
          });
          done(item, res.reason);
          return;
        }
        const { item } = await capture({
          kind: res.kind,
          folder_id: groupId,
          capture: res.capture,
        });
        done(item);
        return;
      }

      if (captured.kind === "x") {
        const res = captured.result;
        if (res.status === "error") {
          captureRef.current = null;
          setResult({ tone: "error", text: res.message });
          return;
        }
        const { item } = await capture({ kind: "x", folder_id: groupId, posts: res.posts });
        done(item);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "duplicate")) {
        const groupId = groupOverride ?? placeRef.current.groupId;
        setSavedGroupIds((prev) => new Set(prev).add(groupId));
        return;
      }
      setResult({ tone: "error", text: errorText(err, "Couldn't save this page.") });
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const loadThreads = () => recentXItems(placeRef.current.groupId || placeRef.current.projectId);

  const addToThread = async (item: RecentXItem): Promise<{ message: string; isError: boolean }> => {
    if (busyRef.current || page?.tabId == null || !page.url) {
      return { message: "Wait for the save to finish.", isError: true };
    }
    busyRef.current = true;
    const notFound = "Couldn't find the post on this page. Scroll to it and try again.";
    try {
      const captured = await getCapture(page.tabId);
      if (captured.kind !== "x") return { message: "This page isn't an X post.", isError: true };
      if (captured.result.status === "error") {
        captureRef.current = null;
        return { message: captured.result.message, isError: true };
      }
      const posts = captured.result.posts;
      if (!posts?.length) return { message: "No posts found in this thread.", isError: true };

      const tabStatus = xStatusId(page.url);
      const index = tabStatus ? posts.findIndex((p) => xStatusId(p.postUrl) === tabStatus) : -1;
      const post = index === -1 ? undefined : posts[index];
      if (!post) return { message: notFound, isError: true };

      const parent_post_url = index > 0 ? posts[index - 1]?.postUrl : undefined;
      await addXPost(item.id, { post, parent_post_url });
      return { message: `Added to ${item.title}`, isError: false };
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "duplicate")) {
        return { message: "Already in this thread", isError: true };
      }
      return { message: errorText(err, "Couldn't add the post to the thread."), isError: true };
    } finally {
      busyRef.current = false;
    }
  };

  const grantPermission = async () => {
    if (blocker?.kind !== "permission") return;
    if (await requestHostPermission(blocker.webUrl)) {
      setBlocker(null);
      readyRef.current = refresh(target?.key ?? null);
    }
  };

  const openSettings = () => {
    void browser.runtime.openOptionsPage();
  };

  // Keyboard: arrows pick a group, Enter saves, typing finds a group, Escape closes.
  keyHandlerRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const active = document.activeElement as HTMLElement | null;
    const tag = active?.tagName.toLowerCase() ?? "";
    const inFilter = active !== null && active === filterRef.current;
    const inText =
      tag === "textarea" || (tag === "input" && (active as HTMLInputElement).type === "text");

    if (e.key === "Escape") {
      if (inFilter && query) {
        e.preventDefault();
        changeQuery("");
        return;
      }
      window.close();
      return;
    }
    if (blocker || booting || (inText && !inFilter)) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      const isOption = active?.getAttribute("role") === "option";
      if (!inFilter && !isOption && (tag === "button" || tag === "a")) return;
      e.preventDefault();
      void handleSave();
      return;
    }
    if (
      showFilter &&
      !inText &&
      e.key.length === 1 &&
      e.key !== " " &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      filterRef.current?.focus();
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => keyHandlerRef.current(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const renderBlocker = (b: Blocker) => {
    if (b.kind === "permission") {
      return (
        <div className="notice">
          <p>Sourcefold needs permission to reach {hostOf(b.webUrl)}.</p>
          <button type="button" className="btn-primary" onClick={() => void grantPermission()}>
            Allow access to {hostOf(b.webUrl)}
          </button>
        </div>
      );
    }
    return (
      <div className="notice">
        <p>
          {b.kind === "setup"
            ? "Open the Sourcefold desktop app, or set up the web app in Options."
            : b.message}
        </p>
        <button type="button" className="btn-primary" onClick={openSettings}>
          Open options
        </button>
      </div>
    );
  };

  const saveLabel = () => {
    if (saving) {
      return (
        <>
          <LoaderCircle size={16} className="spin" aria-hidden="true" />
          <span>Saving…</span>
        </>
      );
    }
    if (isAlreadySaved && selectedGroup) {
      return (
        <>
          <Check size={16} aria-hidden="true" />
          <span className="btn-save-text">
            {justSavedId === selectedGroup.id ? "Saved to" : "Already saved in"}{" "}
            {selectedGroup.name}
          </span>
        </>
      );
    }
    if (!selectedGroup) return <span>Choose a group</span>;
    return (
      <>
        <span className="btn-save-text">Save to {selectedGroup.name}</span>
        <kbd className="btn-save-key" aria-hidden="true">
          <CornerDownLeft size={12} />
        </kbd>
      </>
    );
  };

  const kindLabel = unsupported ? null : page?.kind ? pageKindLabel(page.kind) : "Web page";

  return (
    <div className="popup">
      <header className="popup-header">
        <div className="brand">
          <img src="/icon/32.png" alt="" width={18} height={18} />
          <span>Sourcefold</span>
        </div>
        <div className="popup-header-end">
          {target && !blocker && <TargetBadge target={target} />}
          <button
            type="button"
            className="btn-icon"
            onClick={openSettings}
            title="Options"
            aria-label="Options"
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {page && (
        <section
          className="page"
          style={{ "--mark": sourceColor(unsupported ? null : page.kind) } as React.CSSProperties}
        >
          <div className="page-meta">
            {!unsupported && <SourceIcon kind={page.kind} />}
            {kindLabel && <span className="page-kind">{kindLabel}</span>}
            {hostLabel(page.url) && <span className="page-host">{hostLabel(page.url)}</span>}
          </div>
          <h1 className="page-title" title={page.title}>
            {page.title}
          </h1>
          {unsupported ? (
            <p className="page-note">{CANNOT_SAVE_MESSAGE}</p>
          ) : (
            pageNote && (
              <p className="page-note page-note-warning">
                <CircleAlert size={13} aria-hidden="true" />
                <span>{pageNote}</span>
              </p>
            )
          )}
        </section>
      )}

      {blocker ? (
        renderBlocker(blocker)
      ) : booting ? (
        <div className="skeleton" aria-label="Loading your projects">
          <div className="skeleton-bar skeleton-short" />
          <div className="skeleton-bar" />
          <div className="skeleton-bar" />
          <div className="skeleton-bar" />
        </div>
      ) : sections.length === 0 ? (
        <div className="notice">
          <p>Create your first project to start collecting sources.</p>
          <form
            className="inline-create"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newProjectName.trim();
              if (name) void createProject(name).then((ok) => ok && setNewProjectName(""));
            }}
          >
            <input
              type="text"
              className="input-field input-sm"
              placeholder="Project name, for example the video title"
              aria-label="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <button type="submit" className="btn-primary btn-sm" disabled={!newProjectName.trim()}>
              New project
            </button>
          </form>
          {result && <p className="result result-error">{result.text}</p>}
        </div>
      ) : (
        <>
          <section className="destination">
            <span className="label">Project</span>
            <ProjectMenu
              sections={sections}
              currentId={place.projectId}
              disabled={saving}
              onSelect={selectProject}
              onCreate={createProject}
            />
            <span className="label label-spaced">Group</span>
            <GroupList
              key={place.projectId}
              groups={visibleGroups}
              selectedId={place.groupId}
              savedIds={savedGroupIds}
              showFilter={showFilter}
              query={query}
              onQueryChange={changeQuery}
              filterRef={filterRef}
              onSelect={selectGroup}
              onActivate={(groupId) => {
                selectGroup(groupId);
                void handleSave(groupId);
              }}
              onCreate={createGroup}
              selectedName={selectedGroup?.name}
              disabled={saving}
              emptyProject={Boolean(section) && section!.groups.length === 0}
            />
          </section>

          <footer className="popup-footer">
            <button
              type="button"
              className={`btn-primary btn-save${isAlreadySaved ? " is-saved" : ""}`}
              onClick={() => void handleSave()}
              disabled={saving || isAlreadySaved || unsupported || !selectedGroup}
            >
              {saveLabel()}
            </button>

            {result && (
              <p className={`result result-${result.tone}`}>
                <CircleAlert size={14} aria-hidden="true" />
                <span>{result.text}</span>
              </p>
            )}

            {page?.kind === "x" && !unsupported && section && (
              <ThreadPicker
                key={place.projectId}
                load={loadThreads}
                add={addToThread}
                disabled={saving}
              />
            )}
          </footer>
        </>
      )}
    </div>
  );
}
