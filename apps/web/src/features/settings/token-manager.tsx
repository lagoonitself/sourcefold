"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface TokenItem {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface CreatedTokenPayload {
  id: string;
  name: string;
  created_at: string;
  token: string;
}

interface TokenManagerProps {
  initialTokens: TokenItem[];
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatDate(iso: string): string {
  try {
    return dateFormatter.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function TokenManager({ initialTokens }: TokenManagerProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<CreatedTokenPayload | null>(null);
  const [revokingToken, setRevokingToken] = useState<TokenItem | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingRef.current) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    isCreatingRef.current = true;
    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      const body = await res.json();
      if (!res.ok) {
        setCreateError(body?.error?.message ?? "Couldn't create the token. Try again.");
        return;
      }

      setCreatedToken(body.data);
      setName("");
    } catch {
      setCreateError("Couldn't create the token. Try again.");
    } finally {
      isCreatingRef.current = false;
      setIsCreating(false);
    }
  };

  const handleCopyCreatedToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken.token);
      toast("Copied");
    } catch {
      toast.error("Couldn't copy token. Try again.");
    }
  };

  const handleConfirmRevoke = async () => {
    if (!revokingToken) return;
    setIsRevoking(true);
    try {
      const res = await fetch(`/api/tokens/${revokingToken.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        toast.error("Couldn't revoke the token. Try again.");
        return;
      }

      toast("Token revoked");
      setRevokingToken(null);
      router.refresh();
    } catch {
      toast.error("Couldn't revoke the token. Try again.");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      {createdToken ? (
        <div className="rounded-[6px] bg-accent p-4 text-accent-foreground space-y-3">
          <div className="flex items-center justify-between gap-3">
            <code className="font-mono text-sm break-all select-all font-medium text-foreground">
              {createdToken.token}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={handleCopyCreatedToken}>
              Copy
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
            <p className="text-[13px] text-muted-foreground">
              Copy it now. You won&apos;t see it again.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setCreatedToken(null);
                router.refresh();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleCreateToken} className="space-y-2">
        <Label htmlFor="token-name" className="text-sm font-medium">
          Token name
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="token-name"
            placeholder="Chrome on my laptop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            disabled={isCreating}
            className="max-w-xs"
          />
          <Button type="submit" disabled={isCreating || !name.trim()}>
            {isCreating ? "Creating…" : "Create token"}
          </Button>
        </div>
        {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
      </form>

      <div className="space-y-3">
        {initialTokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {initialTokens.map((token) => (
              <div key={token.id} className="flex items-center justify-between py-3 gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{token.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    Created {formatDate(token.created_at)} ·{" "}
                    {token.last_used_at
                      ? `Last used ${formatDate(token.last_used_at)}`
                      : "Never used"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevokingToken(token)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={revokingToken !== null}
        onOpenChange={(open) => {
          if (!open) setRevokingToken(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &ldquo;{revokingToken?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>The extension using it stops working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRevokingToken(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? "Revoking…" : "Revoke"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
