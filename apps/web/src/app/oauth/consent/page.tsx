import { redirect } from "next/navigation";
import { isEmailAllowed } from "@/lib/env";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { ConsentActions } from "./consent-actions";

export const dynamic = "force-dynamic";

interface ConsentPageProps {
  searchParams: Promise<{ authorization_id?: string }>;
}

function ConsentMessage({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-sidebar p-4">
      <section className="flex w-full max-w-[480px] flex-col gap-5 rounded-[10px] border border-border bg-background p-8">
        <h1 className="font-serif text-[24px] leading-[30px] font-semibold text-foreground">
          {title}
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">{message}</p>
      </section>
    </main>
  );
}

function redirectHost(redirectUri: string): string {
  try {
    return new URL(redirectUri).host;
  } catch {
    return redirectUri;
  }
}

export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId || !/^[A-Za-z0-9_-]{1,128}$/.test(authorizationId)) {
    return (
      <ConsentMessage
        title="Authorization request unavailable"
        message="Start the connection again in Claude or ChatGPT."
      />
    );
  }

  const user = await getSessionUser();
  if (!user) {
    const next = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/login?${new URLSearchParams({ next })}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return (
      <ConsentMessage
        title="Authorization request unavailable"
        message="Refresh the connection in Claude or ChatGPT and try again."
      />
    );
  }

  if (!("authorization_id" in data)) {
    redirect(data.redirect_url);
  }

  let allowed = false;
  try {
    allowed = isEmailAllowed(user.email);
  } catch {
    allowed = false;
  }

  const scopes = data.scope.split(/\s+/).filter(Boolean);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-sidebar p-4">
      <section className="flex w-full max-w-[480px] flex-col gap-5 rounded-[10px] border border-border bg-background p-8">
        <div className="space-y-2">
          <h1 className="font-serif text-[24px] leading-[30px] font-semibold text-foreground">
            Allow {data.client.name} to use Sourcefold?
          </h1>
          <p className="text-sm leading-5 text-muted-foreground">
            This app can read and change your Sourcefold library, and add links.
          </p>
        </div>

        <dl className="space-y-3 rounded-md border border-border bg-muted p-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Signed in as</dt>
            <dd className="break-all font-medium text-foreground">
              {user.email || "Unknown account"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Redirects to</dt>
            <dd className="break-all font-medium text-foreground">
              {redirectHost(data.redirect_uri)}
            </dd>
          </div>
          {scopes.length > 0 ? (
            <div>
              <dt className="text-muted-foreground">Sign-in information requested</dt>
              <dd className="break-all font-mono text-[13px] text-foreground">
                {scopes.join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>

        {!allowed ? (
          <p className="text-sm leading-5 text-destructive" role="alert">
            This account can&apos;t approve access. Deny this request, then sign out and use an
            allowed account.
          </p>
        ) : null}

        <ConsentActions authorizationId={authorizationId} allowDisabled={!allowed} />

        <p className="text-xs leading-4 text-muted-foreground">
          You can deny access now. Sourcefold only shares data from this signed-in account.
        </p>
      </section>
    </main>
  );
}
