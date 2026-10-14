"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

function SearchBoxContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQ = searchParams.get("q") ?? "";
  // Search stays inside the open project, and Escape returns to the open group.
  const folder = searchParams.get("folder");
  const folderQuery = folder ? `folder=${encodeURIComponent(folder)}` : "";
  const homeHref = folderQuery ? `/?${folderQuery}` : "/";

  const [value, setValue] = React.useState(currentQ);
  const prevQRef = React.useRef(currentQ);

  // Sync state if URL changes externally (e.g. browser back/forward or navigation)
  React.useEffect(() => {
    if (prevQRef.current !== currentQ) {
      prevQRef.current = currentQ;
      setValue(currentQ);
    }
  }, [currentQ]);

  // Debounced update to router when user types
  React.useEffect(() => {
    if (value === prevQRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      prevQRef.current = value;
      if (value) {
        router.replace(`/?q=${encodeURIComponent(value)}${folderQuery ? `&${folderQuery}` : ""}`);
      } else {
        router.replace(homeHref);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [value, router, folderQuery, homeHref]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setValue("");
      prevQRef.current = "";
      router.replace(homeHref);
    }
  };

  return (
    <div className="relative w-full max-w-[360px]">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={folder ? "Search this project" : "Search titles"}
        aria-label={folder ? "Search this project" : "Search titles"}
        className="h-[36px] w-full rounded-[6px] border border-input bg-background pl-8.5 pr-3 font-sans text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
    </div>
  );
}

export function SearchBox() {
  return (
    <React.Suspense
      fallback={
        <div className="relative w-full max-w-[360px]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="text"
            disabled
            placeholder="Search titles"
            aria-label="Search titles"
            className="h-[36px] w-full rounded-[6px] border border-input bg-background pl-8.5 pr-3 font-sans text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      }
    >
      <SearchBoxContent />
    </React.Suspense>
  );
}
