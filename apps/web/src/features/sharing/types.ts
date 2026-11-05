import type { FolderNode } from "@/features/folders/tree";

export type ShareRole = "owner" | "editor" | "viewer";
export type InviteRole = "editor" | "viewer";

export interface Person {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface Member extends Person {
  role: InviteRole;
  joined_at: string;
}

export interface Sharing {
  project_id: string;
  project_name: string;
  your_role: ShareRole;
  owner: Person;
  members: Member[];
  invites: { role: InviteRole; code: string }[];
}

export interface InvitePreview {
  project_id: string;
  project_name: string;
  role: InviteRole;
  owner: Person;
  member_count: number;
  your_role: string | null;
}

/** What `GET /api/folders` adds to a project that involves someone else. */
export interface FolderSharing {
  role: ShareRole;
  owner_name: string;
  owner_email: string;
  member_count: number;
}

export type SharedFolderNode = FolderNode & { sharing?: FolderSharing };
