import type {
  AuthorType,
  CaptureRequest as CoreCaptureRequest,
  Triage,
  SubstackCapture,
  XPostCapture,
} from "@sourcefold/core";

export type CaptureRequest = CoreCaptureRequest;
export type { SubstackCapture, XPostCapture };

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  archived_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  item_count?: number | null;
  /** Set on a project that involves someone else (a shared project). */
  sharing?: FolderSharing;
}

/** What `GET /api/folders` adds to a project that involves someone else. */
export interface FolderSharing {
  role: "owner" | "editor" | "viewer";
  owner_name: string;
  owner_email: string;
  member_count: number;
}

export type ShareRole = FolderSharing["role"];
export type InviteRole = "editor" | "viewer";

export interface SharePerson {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface ShareMember extends SharePerson {
  role: InviteRole;
  joined_at: string;
}

/** `GET /api/projects/{id}/sharing`: who is in a project and which invite links are on. */
export interface Sharing {
  project_id: string;
  project_name: string;
  your_role: ShareRole;
  owner: SharePerson;
  members: ShareMember[];
  invites: { role: InviteRole; code: string }[];
}

/** `GET /api/invites/{code}`: what a link or code would join. */
export interface InvitePreview {
  project_id: string;
  project_name: string;
  role: InviteRole;
  owner: SharePerson;
  member_count: number;
  your_role: string | null;
}

/** `GET /api/settings/backup`. */
export interface BackupSetting {
  enabled: boolean;
  connected: boolean;
}

export type Project = Folder;

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  itemCount: number;
  archived?: boolean;
  children: FolderNode[];
}

export type ItemKind =
  | "grokipedia"
  | "substack"
  | "wikipedia"
  | "x"
  | "note"
  | "image"
  | "youtube"
  | "web"
  | "reddit"
  | "pdf"
  | "hackernews"
  | "bluesky"
  | string;
export type ItemStatus = "saved" | "pending" | "failed" | "unavailable" | string;

export interface Item {
  id: string;
  folder_id: string;
  kind: ItemKind;
  title: string;
  source_url: string | null;
  canonical_url?: string | null;
  status: ItemStatus;
  error?: string | null;
  markdown?: string | null;
  meta: Record<string, any>;
  note?: string | null;
  position?: number;
  storage_path?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at?: string;
  // Research fields (docs/dev/handoff-research.md). Optional: older rows and routes lack them.
  triage?: Triage | null;
  tags?: string[];
  summary?: string | null;
  author?: string | null;
  author_type?: AuthorType | null;
}

/** `mergeItems`: the copy kept and how much moved onto it. */
export interface MergeResult {
  item: Item;
  moved_highlights: number;
  moved_cards: number;
}

export interface XPost {
  id: string;
  item_id: string;
  parent_id: string | null;
  post_url: string;
  canonical_url: string;
  author_name: string;
  handle: string;
  author_url: string;
  posted_at: string | null;
  text: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface RecentXItem {
  id: string;
  title: string;
  folder_id: string;
  created_at: string;
}

export interface CheckUrlResult {
  exists: boolean;
  item_id?: string | null;
  folder_id?: string | null;
  folder_name?: string | null;
  /** The same link saved in another group of the project; saving it again is refused. */
  elsewhere?: { item_id: string; folder_id: string; folder_path: string } | null;
}

export interface CreateFolderRequest {
  name: string;
  parent_id?: string | null;
}

export interface SaveItemRequest {
  folder_id: string;
  kind: ItemKind;
  title: string;
  source_url?: string | null;
  canonical_url?: string | null;
  status?: string;
  error?: string | null;
  markdown?: string | null;
  meta?: Record<string, any>;
  note?: string | null;
}

export interface AddXPostRequest {
  item_id: string;
  post_url: string;
  canonical_url: string;
  author_name: string;
  handle: string;
  author_url: string;
  posted_at?: string | null;
  text: string;
  parent_post_url?: string | null;
}

export interface Settings {
  storage_dir: string;
  theme?: "light" | "dark" | "system";
  native_host_installed?: boolean;
  port?: number;
  remote_api_url?: string;
  api_token?: string;
}

export interface NativeHostStatus {
  installed: boolean;
  manifest_path?: string;
  host_path?: string;
  message?: string;
}

/** The signed-in account (the Supabase session itself stays in `lib/supabase.ts`). */
export interface Session {
  user_id: string;
  email: string;
  signed_in_at: string;
}

export interface SessionStatus {
  signedIn: boolean;
  offline: boolean;
  email?: string | null;
  userId?: string | null;
}
