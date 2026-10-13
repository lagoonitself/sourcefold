import { Suspense } from "react";
import { SearchBox } from "@/features/search/search-box";
import { AddLinksButton } from "./add-links-button";
import { SaveToDriveButton } from "./save-to-drive-button";

export function TopBar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center">
        <Suspense fallback={<div className="h-9 w-[360px]" />}>
          <SearchBox />
        </Suspense>
      </div>
      <div className="flex items-center gap-2">
        <AddLinksButton />
        <SaveToDriveButton />
      </div>
    </header>
  );
}
