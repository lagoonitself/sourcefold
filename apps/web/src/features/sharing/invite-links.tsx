"use client";

import { useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callApi, messageOf } from "./api";
import { formatInviteCode, inviteLink } from "./helpers";
import { Switch } from "./switch";
import type { InviteRole, Sharing } from "./types";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    toast.error("Couldn't copy. Select the text and copy it instead.");
  }
}

/** The owner's invite controls: an edit link, and an optional view-only link. */
export function InviteLinks({
  projectId,
  invites,
  onChange,
}: {
  projectId: string;
  invites: Sharing["invites"];
  onChange: (invites: Sharing["invites"]) => void;
}) {
  const [busy, setBusy] = useState<InviteRole | null>(null);
  const editor = invites.find((i) => i.role === "editor");
  const viewer = invites.find((i) => i.role === "viewer");

  const run = async (role: InviteRole, action: () => Promise<Sharing["invites"]>) => {
    if (busy) return;
    setBusy(role);
    try {
      onChange(await action());
    } catch (err) {
      toast.error(messageOf(err, "Couldn't change the link. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const replace = (role: InviteRole, code: string) => [
    ...invites.filter((i) => i.role !== role),
    { role, code },
  ];
  const without = (role: InviteRole) => invites.filter((i) => i.role !== role);

  const turnOn = (role: InviteRole) =>
    run(role, async () => {
      const result = await callApi<{ code: string }>(`/api/projects/${projectId}/invite`, {
        method: "POST",
        body: { role },
        fallback: "Couldn't make the link. Try again.",
      });
      return replace(role, result.code);
    });

  const reset = (role: InviteRole) =>
    run(role, async () => {
      const result = await callApi<{ code: string }>(`/api/projects/${projectId}/invite/reset`, {
        method: "POST",
        body: { role },
        fallback: "Couldn't make a new link. Try again.",
      });
      toast("New link ready");
      return replace(role, result.code);
    });

  const turnOff = (role: InviteRole) =>
    run(role, async () => {
      await callApi(`/api/projects/${projectId}/invite?role=${role}`, {
        method: "DELETE",
        fallback: "Couldn't turn off the link. Try again.",
      });
      return without(role);
    });

  return (
    <section className="space-y-3" aria-label="Invite link">
      {editor ? (
        <LinkBlock
          heading="Anyone with this link can join as an editor"
          code={editor.code}
          busy={busy === "editor"}
          onReset={() => reset("editor")}
          onTurnOff={() => turnOff("editor")}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] text-muted-foreground">
            The link is off. Turn it on to invite people.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void turnOn("editor")}
            disabled={busy !== null}
          >
            <Link2 className="size-4" aria-hidden="true" />
            {busy === "editor" ? "Making the link…" : "Make an edit link"}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-sm text-foreground">Also make a view-only link</span>
        <Switch
          label="Also make a view-only link"
          checked={Boolean(viewer)}
          disabled={busy !== null}
          onCheckedChange={(on) => void (on ? turnOn("viewer") : turnOff("viewer"))}
        />
      </div>
      {viewer && (
        <LinkBlock
          heading="Anyone with this link can view"
          code={viewer.code}
          busy={busy === "viewer"}
          onReset={() => reset("viewer")}
          onTurnOff={() => turnOff("viewer")}
        />
      )}
    </section>
  );
}

function LinkBlock({
  heading,
  code,
  busy,
  onReset,
  onTurnOff,
}: {
  heading: string;
  code: string;
  busy: boolean;
  onReset: () => void;
  onTurnOff: () => void;
}) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const link = typeof window === "undefined" ? "" : inviteLink(window.location.origin, code);

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-[13px] font-medium text-foreground">{heading}</p>
      <Input
        readOnly
        value={link}
        aria-label="Invite link"
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-[13px]"
      />
      <p className="text-[13px] text-muted-foreground">
        Or share the code{" "}
        <span className="select-all font-mono text-foreground tabular-nums">
          {formatInviteCode(code)}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copy(link)}>
          <Copy className="size-3.5" aria-hidden="true" />
          Copy link
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void copy(formatInviteCode(code))}
        >
          Copy code
        </Button>
      </div>
      {confirmingReset ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[13px] text-foreground">
            The old link and code will stop working.
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setConfirmingReset(false);
              onReset();
            }}
          >
            New link
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingReset(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingReset(true)}
          >
            New link
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onTurnOff}>
            Turn off link
          </Button>
        </div>
      )}
    </div>
  );
}
