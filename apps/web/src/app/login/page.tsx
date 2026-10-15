import type { Metadata } from "next";
import { SignInButton } from "@/features/auth/sign-in-button";

export const metadata: Metadata = {
  title: "Sign in",
};

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, next } = await searchParams;

  let errorMessage: string | null = null;
  if (error === "not_allowed") {
    errorMessage =
      "This Google account can't use this Sourcefold. Sign in with the allowed account.";
  } else if (error === "auth_failed") {
    errorMessage = "Sign-in didn't finish. Try again.";
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-sidebar p-4">
      <div className="flex w-full max-w-[400px] flex-col gap-6 rounded-[10px] border border-border bg-background p-8">
        <div className="space-y-2">
          <h1 className="font-serif text-[28px] leading-[34px] font-semibold text-foreground">
            Sourcefold
          </h1>
          <p className="text-sm text-muted-foreground">
            Collect research sources as Markdown, organized in folders.
          </p>
        </div>
        <SignInButton next={next} />
        {errorMessage && (
          <p className="text-sm text-destructive" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </main>
  );
}
