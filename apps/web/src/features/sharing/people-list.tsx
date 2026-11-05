"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { callApi, messageOf } from "./api";
import { initialsFor, roleLabel } from "./helpers";
import type { InviteRole, Member, Person } from "./types";

function Avatar({ person }: { person: Person }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[12px] font-medium text-muted-foreground"
    >
      {person.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Google avatar URLs, not worth a loader
        <img src={person.avatar_url} alt="" referrerPolicy="no-referrer" className="size-full" />
      ) : (
        initialsFor(person)
      )}
    </span>
  );
}

function PersonText({ person, suffix }: { person: Person; suffix?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-foreground">
        {person.name.trim() || person.email}
        {suffix && <span className="font-normal text-muted-foreground">{` (${suffix})`}</span>}
      </span>
      {person.name.trim() && (
        <span className="block truncate text-[13px] text-muted-foreground">{person.email}</span>
      )}
    </span>
  );
}

export function PeopleList({
  projectId,
  owner,
  members,
  yourUserId,
  canManage,
  onMembersChange,
}: {
  projectId: string;
  owner: Person;
  members: Member[];
  yourUserId: string | null;
  canManage: boolean;
  onMembersChange: (members: Member[]) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const setRole = async (member: Member, role: InviteRole) => {
    if (role === member.role || busy) return;
    setBusy(member.user_id);
    try {
      await callApi(`/api/projects/${projectId}/members/${member.user_id}`, {
        method: "PATCH",
        body: { role },
        fallback: "Couldn't change that. Try again.",
      });
      onMembersChange(members.map((m) => (m.user_id === member.user_id ? { ...m, role } : m)));
    } catch (err) {
      toast.error(messageOf(err, "Couldn't change that. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (member: Member) => {
    if (busy) return;
    setBusy(member.user_id);
    try {
      await callApi(`/api/projects/${projectId}/members/${member.user_id}`, {
        method: "DELETE",
        fallback: "Couldn't remove them. Try again.",
      });
      onMembersChange(members.filter((m) => m.user_id !== member.user_id));
      setRemoving(null);
    } catch (err) {
      toast.error(messageOf(err, "Couldn't remove them. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="space-y-1" aria-label="People in this project">
      <li className="flex items-center gap-3 py-1.5">
        <Avatar person={owner} />
        <PersonText person={owner} suffix={owner.user_id === yourUserId ? "you" : undefined} />
        <span className="shrink-0 text-[13px] text-muted-foreground">Owner</span>
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
                    aria-label={`Role for ${member.name.trim() || member.email}`}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {roleLabel(member.role)}
                </span>
              )}
            </div>
            {confirming && (
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2 pl-11">
                <span className="text-[13px] text-foreground">
                  Remove {member.name.trim() || member.email} from the project?
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
        <li className="py-1.5 text-[13px] text-muted-foreground">
          Only you so far. Share the link below to invite people.
        </li>
      )}
    </ul>
  );
}
