"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function ReconnectDriveButton() {
  const [pending, setPending] = useState(false);

  const handleReconnect = async () => {
    setPending(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/settings`,
          scopes: "https://www.googleapis.com/auth/drive.file",
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) {
        toast.error("Couldn't start Google sign-in. Try again.");
        setPending(false);
      }
    } catch {
      toast.error("Couldn't start Google sign-in. Try again.");
      setPending(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleReconnect} disabled={pending}>
      {pending ? "Opening Google\u2026" : "Reconnect Drive"}
    </Button>
  );
}
