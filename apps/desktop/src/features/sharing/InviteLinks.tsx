import * as React from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { createInvite, deleteInvite, resetInvite } from "@/lib/api";
import type { InviteRole, Sharing } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { formatInviteCode, inviteLink } from "./helpers";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Couldn't copy to the clipboard. Try again.");
  }
}

export interface InviteLinksProps {
  projectId: string;
  invites: Sharing["invites"];
  onChange: (invites: Sharing["invites"]) => void;
}

/** The owner's invite controls: an edit link, and an optional view-only link. */
export function InviteLinks({ projectId, invites, onChange }: InviteLinksProps) {
  const [busy, setBusy] = React.useState<InviteRole | null>(null);
  const editor = invites.find((i) => i.role === "editor");
  const viewer = invites.find((i) => i.role === "viewer");

  const run = async (role: InviteRole, action: () => Promise<Sharing["invites"]>) => {
    if (busy) return;
    setBusy(role);
    try {
      onChange(await action());
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't change the link. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const replace = (role: InviteRole, code: string) => [
    ...invites.filter((i) => i.role !== role),
    { role, code },
  ];

  const turnOn = (role: InviteRole) =>
    run(role, async () => replace(role, (await createInvite(projectId, role)).code));

  const reset = (role: InviteRole) =>
    run(role, async () => {
      const result = await resetInvite(projectId, role);
      toast.success("New link ready");
      return replace(role, result.code);
    });

  const turnOff = (role: InviteRole) =>
    run(role, async () => {
      await deleteInvite(projectId, role);
      return invites.filter((i) => i.role !== role);
    });

  return (
    <section className="flex flex-col gap-3" aria-label="Invite link">
      {editor ? (
        <LinkBlock
          heading="Anyone with this link can join as an editor"
          code={editor.code}
          busy={busy === "editor"}
          onReset={() => void reset("editor")}
          onTurnOff={() => void turnOff("editor")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] text-muted-foreground">
            The link is off. Turn it on to invite people.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void turnOn("editor")}
            disabled={busy !== null}
          >
            <Link2 className="size-4" aria-hidden="true" />
            {busy === "editor" ? "Making the link…" : "Make an edit link"}
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[13.5px] text-foreground">Also make a view-only link</span>
        <Switch
          aria-label="Also make a view-only link"
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
          onReset={() => void reset("viewer")}
          onTurnOff={() => void turnOff("viewer")}
        />
      )}
    </section>
  );
}

export function LinkBlock({
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
  const [confirmingReset, setConfirmingReset] = React.useState(false);
  const link = inviteLink(code);
  const shownCode = formatInviteCode(code);

  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-border p-3">
      <p className="text-[12.5px] font-medium text-foreground">{heading}</p>
      {link && (
        <Input
          readOnly
          value={link}
          aria-label="Invite link"
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-[12.5px]"
        />
      )}
      <p className="text-[12.5px] text-muted-foreground">
        {link ? "Or share the code " : "Share the code "}
        <span className="select-all font-mono text-foreground tabular-nums">{shownCode}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {link && (
          <Button type="button" size="sm" onClick={() => void copy(link)}>
            <Copy className="size-3.5" aria-hidden="true" />
            Copy link
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => void copy(shownCode)}>
          Copy code
        </Button>
      </div>
      {confirmingReset ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[12.5px] text-foreground">
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
