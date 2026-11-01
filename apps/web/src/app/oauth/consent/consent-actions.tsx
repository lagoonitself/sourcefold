"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface ConsentActionsProps {
  authorizationId: string;
  allowDisabled: boolean;
}

export function ConsentActions({ authorizationId, allowDisabled }: ConsentActionsProps) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function decide(decision: "allow" | "deny") {
    if (decision === "allow" && allowDisabled) return;
    setPending(decision);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const result =
        decision === "allow"
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            });

      if (result.error || !result.data?.redirect_url) {
        setErrorMessage("Sourcefold couldn't finish this request. Refresh the page and try again.");
        setPending(null);
        return;
      }

      window.location.assign(result.data.redirect_url);
    } catch {
      setErrorMessage("Sourcefold couldn't finish this request. Refresh the page and try again.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {errorMessage ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void decide("deny")}
        >
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
        <Button
          type="button"
          disabled={allowDisabled || pending !== null}
          onClick={() => void decide("allow")}
        >
          {pending === "allow" ? "Allowing…" : "Allow"}
        </Button>
      </div>
    </div>
  );
}
