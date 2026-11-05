import { z } from "zod";
import { jsonError } from "../../http";
import type { RouteContext } from "../../context";

// Shared projects: types for the database's sharing functions, and what the sharing routes have
// in common (docs/dev/PLAN-teams.md, "New API routes").

export type ProjectRole = "owner" | "editor" | "viewer";
/** The roles someone can be invited as or changed to. */
export type InviteRole = "editor" | "viewer";

export const inviteRoleSchema = z.enum(["editor", "viewer"], {
  message: "Role must be editor or viewer.",
});

export interface SharingPerson {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
}

export interface ProjectMember extends SharingPerson {
  role: InviteRole;
  joined_at: string;
}

/** The answer of `get_project_sharing`. `invites` is only filled in for the owner. */
export interface ProjectSharing {
  project_id: string;
  project_name: string;
  your_role: ProjectRole;
  owner: SharingPerson;
  members: ProjectMember[];
  invites: { role: InviteRole; code: string }[];
}

/** The answer of `preview_project_invite`. */
export interface InvitePreview {
  project_id: string;
  project_name: string;
  /** The role the link gives. */
  role: InviteRole;
  owner: SharingPerson;
  member_count: number;
  /** Your role in the project already, or null if you haven't joined. */
  your_role: ProjectRole | null;
}

export const TOKEN_SHARING_MESSAGE = "Sharing needs the Sourcefold app or website.";
export const NOT_OWNER_MESSAGE = "Only the project's owner can do that.";

/** A 403 for `sf_` tokens, which can't reach shared projects; null for everyone else. */
export function refuseToken(auth: RouteContext): Response | null {
  return auth.via === "token" ? jsonError(403, TOKEN_SHARING_MESSAGE) : null;
}

/** Turns a Postgres error from a sharing function into an answer. */
export function sharingError(error: { code?: string; message: string }): Response {
  if (error.code === "42501" || /only the project owner/i.test(error.message)) {
    return jsonError(403, NOT_OWNER_MESSAGE);
  }
  if (error.code === "P0002") return jsonError(404, error.message);
  console.error("Sharing request failed:", error);
  return jsonError(500, "Something went wrong. Try again.");
}

export const projectIdSchema = z.string().uuid("Invalid project ID.");

export async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | null> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return null;
  }
}
