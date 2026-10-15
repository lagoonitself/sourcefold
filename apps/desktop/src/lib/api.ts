import { isRemoteConfigured, remoteFetch } from "./remote-client";
import type {
  AddXPostRequest,
  CaptureRequest,
  CheckUrlResult,
  Folder,
  Item,
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

export async function getItems(folderId: string): Promise<Item[]> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item[]>("get_items", { folderId });
  }
  const rawItems = await httpFetch<Item[]>(`/items?folder=${encodeURIComponent(folderId)}`);
  return rawItems.map((item) => ({
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

export async function getItem(id: string): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("get_item", { id });
  }
  return httpFetch<Item>(`/items/${id}`);
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

export async function updateItemNote(id: string, note: string | null): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("update_item_note", { id, note });
  }
  await httpFetch<void>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ note }),
  });
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

/** Images can be stored on this computer (offline mode). Signed-in image upload needs the web app. */
export function canAddImages(): boolean {
  return shouldUseTauri();
}

export async function addImage(
  folderId: string,
  fileName: string,
  mimeType: string,
  dataBase64: string,
): Promise<Item> {
  if (shouldUseTauri()) {
    return await tauriInvoke<Item>("add_image", {
      folderId,
      fileName,
      mimeType,
      dataBase64,
    });
  }
  throw new Error("Adding images isn't available while signed in yet. Use the web app.");
}

/** Opens an offline image with the system's image viewer. */
export async function openItemFile(id: string): Promise<void> {
  if (shouldUseTauri()) {
    return await tauriInvoke<void>("open_item_file", { id });
  }
  throw new Error("This image is stored in your account. Open it from the web app.");
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
