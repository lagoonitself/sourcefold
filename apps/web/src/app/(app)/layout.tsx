import { Suspense } from "react";
import Link from "next/link";
import { FolderSidebar } from "@/features/folders/folder-sidebar";
import { UserMenu } from "@/features/auth/user-menu";
import { TopBar } from "@/features/shell/top-bar";
import { SidebarSkeleton } from "@/features/shell/sidebar-skeleton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 shrink-0 items-center px-4">
          <Link
            href="/"
            className="font-sans text-[15px] font-semibold text-foreground tracking-tight"
          >
            Sourcefold
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<SidebarSkeleton />}>
            <FolderSidebar />
          </Suspense>
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </div>
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
