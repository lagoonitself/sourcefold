import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { removeMember, setMemberRole } from "@/lib/api";
import type { InviteRole, ShareMember, SharePerson } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { displayName, initialsFor, roleLabel } from "./helpers";

function Avatar({ person }: { person: SharePerson }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[12px] font-medium text-muted-foreground"
    >
      {person.avatar_url ? (
        <img src={person.avatar_url} alt="" referrerPolicy="no-referrer" className="size-full" />
      ) : (
        initialsFor(person)
      )}
    </span>
  );
}

function PersonText({ person, suffix }: { person: SharePerson; suffix?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13.5px] font-medium text-foreground">
        {displayName(person)}
        {suffix && <span className="font-normal text-muted-foreground">{` (${suffix})`}</span>}
      </span>
      {person.name.trim() && (
        <span className="block truncate text-[12.5px] text-muted-foreground">{person.email}</span>
      )}
    </span>
  );
}

export interface PeopleListProps {
  projectId: string;
  owner: SharePerson;
  members: ShareMember[];
  yourUserId: string | null;
  /** Owners can change roles and remove people. */
  canManage: boolean;
  onMembersChange: (members: ShareMember[]) => void;
}

export function PeopleList({
  projectId,
  owner,
  members,
  yourUserId,
  canManage,
  onMembersChange,
}: PeopleListProps) {
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const setRole = async (member: ShareMember, role: InviteRole) => {
    if (role === member.role || busy) return;
    setBusy(member.user_id);
    try {
      await setMemberRole(projectId, member.user_id, role);
      onMembersChange(members.map((m) => (m.user_id === member.user_id ? { ...m, role } : m)));
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't change that. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: ShareMember) => {
    if (busy) return;
    setBusy(member.user_id);
    try {
      await removeMember(projectId, member.user_id);
      onMembersChange(members.filter((m) => m.user_id !== member.user_id));
      setRemoving(null);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't remove them. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="flex flex-col gap-1" aria-label="People in this project">
      <li className="flex items-center gap-3 py-1.5">
        <Avatar person={owner} />
        <PersonText person={owner} suffix={owner.user_id === yourUserId ? "you" : undefined} />
        <span className="shrink-0 text-[12.5px] text-muted-foreground">Owner</span>
      </li>
      {members.map((member) => {
        const isYou = member.user_id === yourUserId;
        const confirming = removing === member.user_id;
        return (
          <li key={member.user_id} className="py-1.5">
            <div className="flex items-center gap-3">
              <Avatar person={member} />
              <PersonText person={member} suffix={isYou ? "you" : undefined} />
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={busy === member.user_id}
                    aria-label={`Role for ${displayName(member)}`}
                    className="flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-[8px] px-2 text-[12.5px] text-foreground outline-none transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    {roleLabel(member.role)}
                    <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["editor", "viewer"] as const).map((role) => (
                      <DropdownMenuItem key={role} onClick={() => void setRole(member, role)}>
                        <span className="flex-1">{roleLabel(role)}</span>
                        {member.role === role && <Check className="size-4" aria-hidden="true" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setRemoving(member.user_id)}
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="shrink-0 text-[12.5px] text-muted-foreground">
                  {roleLabel(member.role)}
                </span>
              )}
            </div>
            {confirming && (
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2 pl-11">
                <span className="text-[12.5px] text-foreground">
                  Remove {displayName(member)} from the project?
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy === member.user_id}
                  onClick={() => void remove(member)}
                >
                  {busy === member.user_id ? "Removing…" : "Remove"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </li>
        );
      })}
      {members.length === 0 && canManage && (
        <li className="py-1.5 text-[12.5px] text-muted-foreground">
          Only you so far. Share the link below to invite people.
        </li>
      )}
    </ul>
  );
}
