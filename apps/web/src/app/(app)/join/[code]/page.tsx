import type { Metadata } from "next";
import Link from "next/link";
import { InviteCard } from "@/features/sharing/invite-card";
import { extractInviteCode } from "@/features/sharing/helpers";

export const metadata: Metadata = {
  title: "Join a shared project",
};

interface JoinPageProps {
  params: Promise<{ code: string }>;
}

// Signed-out visitors are sent to /login?next=/join/<code> by the proxy and land back here.
export default async function JoinPage({ params }: JoinPageProps) {
  const { code: rawCode } = await params;
  let decoded = rawCode;
  try {
    decoded = decodeURIComponent(rawCode);
  } catch {
    // keep the raw text; it won't pass as a code
  }
  const code = extractInviteCode(decoded);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="flex w-full max-w-[420px] flex-col gap-5 rounded-[10px] border border-border bg-background p-8">
        <div className="space-y-2">
          <h1 className="font-serif text-[28px] leading-[34px] font-semibold text-foreground">
            Join a shared project
          </h1>
          <p className="text-sm text-muted-foreground">
            Everyone in the project sees the same groups and sources.
          </p>
        </div>
        {code ? (
          <InviteCard code={code} />
        ) : (
          <p className="text-sm text-destructive" role="alert">
            That link or code doesn&apos;t work. Ask for a new one.
          </p>
        )}
        <Link href="/" className="text-sm text-primary hover:underline">
          Back to my projects
        </Link>
      </div>
    </div>
  );
}
