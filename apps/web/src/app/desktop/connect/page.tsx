import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/api";
import { validateConnectParams } from "@/features/desktop-connect/validation";
import { Button, buttonVariants } from "@/components/ui/button";
import { connectDesktopAction } from "./actions";

export const metadata: Metadata = {
  title: "Connect desktop",
};

interface ConnectPageProps {
  searchParams: Promise<{
    callback?: string;
    state?: string;
  }>;
}

export default async function DesktopConnectPage({ searchParams }: ConnectPageProps) {
  const auth = await requireUser();
  if ("response" in auth) {
    redirect("/login");
  }

  const { callback, state } = await searchParams;
  const validation = validateConnectParams(callback, state);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-sidebar p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-6 rounded-[10px] border border-border bg-background p-8 shadow-xs">
        <div className="space-y-2">
          <h1 className="font-serif text-[24px] leading-[30px] font-semibold text-foreground">
            Connect desktop
          </h1>
          {validation.valid ? (
            <p className="text-sm text-muted-foreground">
              Connect Sourcefold Desktop to{" "}
              <span className="font-medium text-foreground">{auth.user.email}</span>?
            </p>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              {validation.error}
            </p>
          )}
        </div>

        {validation.valid ? (
          <form action={connectDesktopAction} className="flex flex-col gap-4">
            <input type="hidden" name="callback" value={validation.callbackUrl} />
            <input type="hidden" name="state" value={validation.state} />

            <div className="flex items-center justify-end gap-3 pt-2">
              <Link href="/" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
              <Button type="submit" autoFocus>
                Connect
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex justify-end pt-2">
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              Back to home
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
