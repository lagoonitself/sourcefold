"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    setPending(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: "https://www.googleapis.com/auth/drive.file",
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });

      if (error) {
        toast.error(error.message);
        setPending(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open Google sign-in");
      setPending(false);
    }
  }

  return (
    <Button type="button" className="w-full" disabled={pending} onClick={handleSignIn}>
      {pending ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}
