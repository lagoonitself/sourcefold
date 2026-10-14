import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllowedEmails } from "@/lib/env";
import { ReconnectDriveButton } from "@/features/settings/reconnect-drive-button";
import { TokenManager } from "@/features/settings/token-manager";
import { SettingsAppAddress } from "./settings-app-address";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  let allowedEmails: string[];
  try {
    allowedEmails = getAllowedEmails();
  } catch {
    redirect("/login");
  }

  const email = user.email?.trim().toLowerCase();
  if (!email || !allowedEmails.includes(email)) {
    redirect("/login");
  }

  const supabase = await createClient();

  let adminKeyMissing = false;
  let googleTokenPromise: PromiseLike<{ data: { user_id: string } | null; error: unknown } | null>;
  try {
    const admin = createAdminClient();
    googleTokenPromise = admin
      .from("google_tokens")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
  } catch {
    adminKeyMissing = true;
    googleTokenPromise = Promise.resolve(null);
  }

  const [tokensResult, driveStateResult, googleTokenResult] = await Promise.all([
    supabase
      .from("api_tokens")
      .select("id, name, created_at, last_used_at")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("drive_state")
      .select("root_folder_id, last_saved_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    googleTokenPromise,
  ]);

  const hasGoogleToken = Boolean(googleTokenResult?.data);

  const lastSavedText = driveStateResult.data?.last_saved_at
    ? `Last saved ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(driveStateResult.data.last_saved_at))}`
    : "Not saved yet";

  return (
    <div className="max-w-[720px] px-8 pt-6 pb-12">
      <h1 className="font-serif text-[28px] leading-[34px] font-semibold text-foreground">
        Settings
      </h1>

      <Separator className="my-6" />

      <section className="space-y-4">
        <h2 className="font-sans text-[15px] leading-[20px] font-semibold text-foreground">
          Google Drive
        </h2>

        {adminKeyMissing ? (
          <p className="text-sm text-muted-foreground">
            Drive status unavailable: the server is missing SUPABASE_SECRET_KEY.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-foreground">
              {hasGoogleToken ? (
                <>
                  <Check className="size-4 text-primary" aria-hidden="true" />
                  <span>Connected</span>
                </>
              ) : (
                <span>Not connected</span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground">{lastSavedText}</p>
            {driveStateResult.data?.root_folder_id ? (
              <p>
                <a
                  href={`https://drive.google.com/drive/folders/${driveStateResult.data.root_folder_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  Open the Sourcefold folder in Drive
                </a>
              </p>
            ) : null}
          </div>
        )}

        <div>
          <ReconnectDriveButton />
        </div>
      </section>

      <Separator className="my-6" />

      <section className="space-y-4">
        <h2 className="font-sans text-[15px] leading-[20px] font-semibold text-foreground">
          Extension
        </h2>
        <p className="text-sm text-foreground">
          Create an access token, then paste it and this app&apos;s address into the Sourcefold
          extension&apos;s settings.
        </p>
        <SettingsAppAddress />
        <div className="pt-2">
          <TokenManager initialTokens={tokensResult.data ?? []} />
        </div>
      </section>
    </div>
  );
}
