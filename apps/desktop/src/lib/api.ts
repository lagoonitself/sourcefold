import { isRemoteConfigured, localApiFetch, remoteFetch } from "./remote-client";
import type {
  Card,
  CardInput,
  CardPatch,
  Highlight,
  HighlightInput,
  ItemResearchPatch,
  OutlineSection,
  OutlineSectionInput,
} from "@sourcefold/core";
import type {
  AddXPostRequest,
  CaptureRequest,
  CheckUrlResult,
  Folder,
  Item,
  MergeResult,
  NativeHostStatus,
  Settings,
} from "./types";

export function isTauri(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);
}

export function shouldUseTauri(): boolean {
  return isTauri() && !isRemoteConfigured();
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function httpFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isRemoteConfigured()) {
    const endpoint = path.startsWith("/") ? `/api${path}` : `/api/${path}`;
    return await remoteFetch<T>(endpoint, options);
  }
  throw new Error(
    "Sourcefold requires the Tauri desktop app or a signed-in Sourcefold Web connection.",
  );
}

/**
 * Like `httpFetch`, for endpoints that answer with plain text (a Markdown file) instead of JSON.
 * `localApiFetch` signs an expired session out and tells the app.
 */
async function httpFetchText(path: string): Promise<string> {
  if (!isRemoteConfigured()) {
    throw new Error("Sign in, or use Sourcefold on this computer only, to open this.");
  }
  const endpoint = path.startsWith("/") ? `/api${path}` : `/api/${path}`;
  const res = await localApiFetch(endpoint);

  if (res.ok) return await res.text();

  const body = await res.json().catch(() => null);
  const message = body?.error?.message ?? body?.message ?? body?.error;
  throw new Error(
    typeof message === "string" && message ? message : `Request failed with status ${res.status}`,
  );
}

// ----------------- FOLDER OPERATIONS -----------------

export async function getFolders(includeArchived = true): Promise<Folder[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Folder[]>("get_folders", { includeArchived });
  }

  const rawFolders = await httpFetch<
    Array<{
      id: string;
      parent_id: string | null;
      name: string;
      position?: number;
      item_count?: number;
      archived?: boolean;
      archived_at?: string | null;
      created_at?: string;
      updated_at?: string;
    }>
  >("/folders");

  const now = new Date().toISOString();
  let folders: Folder[] = rawFolders.map((f) => ({
    id: f.id,
    parent_id: f.parent_id ?? null,
    name: f.name,
    position: f.position ?? 0,
    archived_at: f.archived_at ?? (f.archived ? now : null),
    deleted_at: null,
    created_at: f.created_at || now,
    updated_at: f.updated_at || now,
    item_count: f.item_count ?? 0,
  }));

  if (!includeArchived) {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const hidden = new Set<string>();
    for (const folder of folders) {
      let current: Folder | undefined = folder;
      for (let depth = 0; current && depth < 1000; depth++) {
        if (!current.parent_id) {
          if (current.archived_at) hidden.add(folder.id);
          break;
        }
        current = byId.get(current.parent_id);
      }
    }
    folders = folders.filter((f) => !hidden.has(f.id));
  }

  return folders;
}

export async function createFolder(name: string, parentId?: string | null): Promise<Folder> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Folder>("create_folder", {
      name,
      parentId: parentId ?? null,
    });
  }
  return httpFetch<Folder>("/folders", {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parentId ?? null }),
  });
}

export async function renameFolder(id: string, name: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("rename_folder", { id, name });
  }
  await httpFetch<void>(`/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function moveFolder(
  id: string,
  parentId?: string | null,
  position = 0,
): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("move_folder", {
      id,
      parentId: parentId ?? null,
      position,
    });
  }
  await httpFetch<void>(`/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ parent_id: parentId ?? null, position }),
  });
}

export async function deleteFolder(id: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("delete_folder", { id });
  }
  await httpFetch<void>(`/folders/${id}`, {
    method: "DELETE",
  });
}

export async function archiveProject(id: string, archived: boolean): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("archive_project", { id, archived });
  }
  await httpFetch<void>(`/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
}

// ----------------- ITEM OPERATIONS -----------------

function withItemDefaults(item: Item): Item {
  return {
    ...item,
    canonical_url: item.canonical_url ?? null,
    status: item.status ?? "saved",
    error: item.error ?? null,
    markdown: item.markdown ?? null,
    note: item.note ?? null,
    position: item.position ?? 0,
    storage_path: item.storage_path ?? null,
    deleted_at: item.deleted_at ?? null,
    updated_at: item.updated_at ?? item.created_at,
    triage: item.triage ?? null,
    tags: item.tags ?? [],
    summary: item.summary ?? null,
    author: item.author ?? null,
    author_type: item.author_type ?? null,
  };
}

export async function getItems(folderId: string): Promise<Item[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item[]>("get_items", { folderId });
  }
  const rawItems = await httpFetch<Item[]>(`/items?folder=${encodeURIComponent(folderId)}`);
  return rawItems.map(withItemDefaults);
}

/** Every live source in every group of a project (duplicates, tags, the outline). */
export async function getProjectItems(projectId: string): Promise<Item[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item[]>("list_project_items", { projectId });
  }
  const rawItems = await httpFetch<Item[]>(`/items?project=${encodeURIComponent(projectId)}`);
  return rawItems.map(withItemDefaults);
}

export async function getItem(id: string): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("get_item", { id });
  }
  return withItemDefaults(await httpFetch<Item>(`/items/${id}`));
}

/**
 * The text of an item's file for the reader: front matter, title, source line, body and note
 * (docs/FILE-FORMAT.md). Signed in it comes from the web app, which reads it back from Google
 * Drive when needed; offline it is the copy in the local database.
 */
export async function loadReaderText(id: string): Promise<string> {
  if (shouldUseTauri()) {
    const item = await tauriInvoke<Item>("get_item", { id });
    return item?.markdown ?? "";
  }
  return httpFetchText(`/items/${encodeURIComponent(id)}/content`);
}

export async function checkUrl(url: string, folderId: string): Promise<CheckUrlResult> {
  if (shouldUseTauri()) {
    return await tauriInvoke<CheckUrlResult>("check_url", { url, folderId });
  }
  return httpFetch<CheckUrlResult>("/items/check", {
    method: "POST",
    body: JSON.stringify({ url, folder_id: folderId }),
  });
}

export async function saveGrokipedia(url: string, folderId: string): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("save_grokipedia", { url, folderId });
  }
  const res = await httpFetch<{ item?: Item } | Item>("/grokipedia", {
    method: "POST",
    body: JSON.stringify({ url, folder_id: folderId }),
  });
  return (res as any).item ?? res;
}

export async function capture(request: CaptureRequest): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("capture", { request });
  }
  const res = await httpFetch<{ item?: Item } | Item>("/capture", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return (res as any).item ?? res;
}

export async function addXPost(req: AddXPostRequest): Promise<[string, string]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<[string, string]>("add_x_post", { req });
  }
  const body = {
    post: {
      postUrl: req.post_url,
      authorName: req.author_name,
      handle: req.handle,
      authorUrl: req.author_url,
      postedAt: req.posted_at || undefined,
      text: req.text,
    },
    parent_post_url: req.parent_post_url || undefined,
  };
  const res = await httpFetch<{ item_id: string; post_id: string }>(`/x/${req.item_id}/posts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return [res.item_id, res.post_id];
}

export async function renameItem(id: string, title: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("rename_item", { id, title });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function moveItem(id: string, folderId: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("move_item", { id, folderId });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export async function deleteItem(id: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("delete_item", { id });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "DELETE",
  });
}

/**
 * Replaces a saved source's text with `body` (the part between the title and the note): the
 * reader's "Remove text" and "Edit as text". Signed in, the web app keeps it until it reaches
 * Drive; offline, the file on disk is rewritten.
 */
export async function updateItemBody(id: string, body: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("update_item_body", { id, body });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ markdown: body }),
  });
}

export async function updateItemNote(id: string, note: string | null): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("update_item_note", { id, note });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

// ----------------- RESEARCH: STATUS, TAGS, CARDS, OUTLINE -----------------
// Contract: docs/dev/handoff-research.md.

/** Sets some of a source's status, tags, summary, author and author type; `null` clears one. */
export async function updateItemResearch(id: string, patch: ItemResearchPatch): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("update_item_research", { id, patch });
  }
  const item = await httpFetch<Item>(`/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return withItemDefaults(item);
}

/** Keeps `keepId` and merges the other copies into it (highlights, cards, tags, notes). */
export async function mergeItems(keepId: string, ids: string[]): Promise<MergeResult> {
  if (shouldUseTauri()) {
    return await tauriInvoke<MergeResult>("merge_items", { keepId, ids });
  }
  const res = await httpFetch<MergeResult>(`/items/${encodeURIComponent(keepId)}/merge`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  return { ...res, item: withItemDefaults(res.item) };
}

export async function getCards(scope: { projectId: string } | { itemId: string }): Promise<Card[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Card[]>("list_cards", {
      projectId: "projectId" in scope ? scope.projectId : undefined,
      itemId: "itemId" in scope ? scope.itemId : undefined,
    });
  }
  const query =
    "projectId" in scope
      ? `project=${encodeURIComponent(scope.projectId)}`
      : `item=${encodeURIComponent(scope.itemId)}`;
  return await httpFetch<Card[]>(`/cards?${query}`);
}

export async function putCard(card: CardInput): Promise<Card> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Card>("put_card", { card });
  }
  return await httpFetch<Card>(`/cards/${encodeURIComponent(card.id)}`, {
    method: "PUT",
    body: JSON.stringify(card),
  });
}

export async function updateCard(id: string, patch: CardPatch): Promise<Card> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Card>("update_card", { id, patch });
  }
  return await httpFetch<Card>(`/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteCard(id: string): Promise<void> {
  if (shouldUseTauri()) {
    await tauriInvoke<null>("delete_card", { id });
    return;
  }
  await httpFetch<unknown>(`/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getOutlineSections(projectId: string): Promise<OutlineSection[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<OutlineSection[]>("list_outline_sections", { projectId });
  }
  return await httpFetch<OutlineSection[]>(
    `/outline-sections?project=${encodeURIComponent(projectId)}`,
  );
}

/** Creates or replaces a section; a new title also renames that tag on the project's sources. */
export async function putOutlineSection(section: OutlineSectionInput): Promise<OutlineSection> {
  if (shouldUseTauri()) {
    return await tauriInvoke<OutlineSection>("put_outline_section", { section });
  }
  return await httpFetch<OutlineSection>(`/outline-sections/${encodeURIComponent(section.id)}`, {
    method: "PUT",
    body: JSON.stringify(section),
  });
}

/** Deletes a section; its cards go back to the pile. */
export async function deleteOutlineSection(id: string): Promise<void> {
  if (shouldUseTauri()) {
    await tauriInvoke<null>("delete_outline_section", { id });
    return;
  }
  await httpFetch<unknown>(`/outline-sections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ----------------- HIGHLIGHTS -----------------
// Contract: docs/dev/handoff-highlights.md.

export async function getHighlights(
  scope: { itemId: string } | { folderId: string },
): Promise<Highlight[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Highlight[]>("list_highlights", {
      itemId: "itemId" in scope ? scope.itemId : undefined,
      folderId: "folderId" in scope ? scope.folderId : undefined,
    });
  }
  const query =
    "itemId" in scope
      ? `item=${encodeURIComponent(scope.itemId)}`
      : `folder=${encodeURIComponent(scope.folderId)}`;
  return await httpFetch<Highlight[]>(`/highlights?${query}`);
}

export async function putHighlight(highlight: HighlightInput): Promise<Highlight> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Highlight>("put_highlight", { highlight });
  }
  return await httpFetch<Highlight>(`/highlights/${encodeURIComponent(highlight.id)}`, {
    method: "PUT",
    body: JSON.stringify(highlight),
  });
}

export async function updateHighlightNote(id: string, note: string | null): Promise<Highlight> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Highlight>("update_highlight_note", { id, note });
  }
  return await httpFetch<Highlight>(`/highlights/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
}

export async function deleteHighlight(id: string): Promise<void> {
  if (shouldUseTauri()) {
    await tauriInvoke<null>("delete_highlight", { id });
    return;
  }
  await httpFetch<unknown>(`/highlights/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createStandaloneNote(
  folderId: string,
  title: string,
  markdown: string,
): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("create_note", {
      folderId,
      title,
      markdown,
    });
  }
  const res = await httpFetch<Item>("/notes", {
    method: "POST",
    body: JSON.stringify({
      folder_id: folderId,
      title,
      markdown,
    }),
  });
  return { ...res, markdown };
}

export async function updateStandaloneNote(
  id: string,
  title: string,
  markdown: string,
): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("update_note", {
      id,
      title: title || null,
      markdown,
    });
  }
  const body: { title?: string; markdown: string } = { markdown };
  const trimmed = title.trim();
  if (trimmed) {
    body.title = trimmed;
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read that file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function storageErrorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const message = body?.message ?? body?.error?.message ?? body?.error;
  return typeof message === "string" && message
    ? message
    : `The upload failed with status ${res.status}.`;
}

/**
 * Adds an image to a group. Offline it is saved on this computer. Signed in it is uploaded in
 * three steps, like the web app does: ask the server for a signed upload URL, send the file to
 * Supabase Storage, then tell the server to create the item.
 */
export async function addImage(folderId: string, file: File): Promise<Item> {
  if (shouldUseTauri()) {
    const dataBase64 = await readAsBase64(file);
    return await tauriInvoke<Item>("add_image", {
      folderId,
      fileName: file.name || "image",
      mimeType: file.type,
      dataBase64,
    });
  }

  const fileName = file.name || "image";
  const signed = await httpFetch<{
    item_id: string;
    storage_path: string;
    signed_url: string;
    apikey?: string | null;
  }>("/uploads/sign", {
    method: "POST",
    body: JSON.stringify({
      folder_id: folderId,
      file_name: fileName,
      mime_type: file.type,
      size: file.size,
    }),
  });

  // The same request supabase-js makes for uploadToSignedUrl with a Blob.
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);
  const headers: Record<string, string> = { "x-upsert": "false" };
  if (signed.apikey) headers.apikey = signed.apikey;
  const put = await fetch(signed.signed_url, { method: "PUT", headers, body: form });
  if (!put.ok) throw new Error(await storageErrorMessage(put));

  return httpFetch<Item>("/uploads", {
    method: "POST",
    body: JSON.stringify({
      item_id: signed.item_id,
      folder_id: folderId,
      storage_path: signed.storage_path,
      file_name: fileName,
      mime_type: file.type,
      size: file.size,
    }),
  });
}

/** Opens an image: offline in the system image viewer, signed in in the browser. */
export async function openImage(item: Pick<Item, "id">): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("open_item_file", { id: item.id });
  }
  const { url } = await httpFetch<{ url: string }>(`/items/${item.id}/file?format=json`);
  const { openUrl } = await import("./utils");
  await openUrl(url);
}

export async function searchItems(query: string, projectId?: string | null): Promise<Item[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item[]>("search_items", {
      query,
      projectId: projectId ?? null,
    });
  }

  const rawItems = await httpFetch<Item[]>(`/items?q=${encodeURIComponent(query)}`);

  let folderMap: Map<string, Folder> | null = null;
  if (projectId) {
    try {
      const allFolders = await getFolders(true);
      folderMap = new Map(allFolders.map((f) => [f.id, f]));
    } catch {
      folderMap = null;
    }
  }

  return rawItems
    .filter((item) => {
      if (!projectId || !folderMap) return true;
      let curr = folderMap.get(item.folder_id);
      for (let depth = 0; curr && depth < 1000; depth++) {
        if (!curr.parent_id) {
          return curr.id === projectId;
        }
        curr = folderMap.get(curr.parent_id);
      }
      return false;
    })
    .map((item) => ({
      ...item,
      canonical_url: item.canonical_url ?? null,
      status: item.status ?? "saved",
      error: item.error ?? null,
      markdown: item.markdown ?? null,
      note: item.note ?? null,
      position: item.position ?? 0,
      storage_path: item.storage_path ?? null,
      deleted_at: item.deleted_at ?? null,
      updated_at: item.updated_at ?? item.created_at,
    }));
}

// ----------------- SETTINGS OPERATIONS -----------------

export async function getSettings(): Promise<Settings> {
  if (isTauri()) {
    return await tauriInvoke<Settings>("get_settings");
  }
  return {
    storage_dir: "",
    theme: "system",
    native_host_installed: false,
  };
}

export async function updateSettings(settings: Partial<Settings>): Promise<void> {
  if (isTauri()) {
    return await tauriInvoke<void>("update_settings", { settings });
  }
}

export async function installNativeHost(): Promise<NativeHostStatus> {
  if (isTauri()) {
    return await tauriInvoke<NativeHostStatus>("install_native_host");
  }
  return {
    installed: false,
    message: "Native messaging is only available in the desktop app",
  };
}

export async function getNativeHostStatus(): Promise<NativeHostStatus> {
  if (isTauri()) {
    return await tauriInvoke<NativeHostStatus>("get_native_host_status");
  }
  return {
    installed: false,
    message: "Native messaging is only available in the desktop app",
  };
}
