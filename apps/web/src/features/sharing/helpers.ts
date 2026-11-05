import type { FolderSharing, InviteRole, Person } from "./types";

const CODE_LENGTH = 8;

/** Pulls the 8-character code out of a pasted link or a typed code. Null when it isn't one. */
export function extractInviteCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const marker = text.toLowerCase().lastIndexOf("/join/");
  const raw = marker >= 0 ? text.slice(marker + "/join/".length).split(/[/?#]/)[0] : text;
  const code = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return code.length === CODE_LENGTH ? code : null;
}

/** K7QM2XPD becomes K7QM-2XPD. */
export function formatInviteCode(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function inviteLink(origin: string, code: string): string {
  return `${origin}/join/${code}`;
}

export function initialsFor(person: Pick<Person, "name" | "email">): string {
  const source = person.name.trim() || person.email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function peopleCount(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

export function roleLabel(role: InviteRole): string {
  return role === "editor" ? "Can edit" : "Can view";
}

export function joinAsText(role: InviteRole): string {
  return role === "editor" ? "You'll join as an editor." : "You'll join as a viewer.";
}

/** The muted text beside a shared project in the switcher. */
export function sharedLabel(sharing: FolderSharing): string {
  if (sharing.role === "owner") return "Shared";
  return `by ${sharing.owner_name.trim() || sharing.owner_email}`;
}
