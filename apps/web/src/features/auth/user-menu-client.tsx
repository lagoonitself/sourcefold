"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserMenuClientProps {
  email: string;
}

export function UserMenuClient({ email }: UserMenuClientProps) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const initial = email.charAt(0).toUpperCase();

  return (
    <>
      <form ref={formRef} method="post" action="/auth/sign-out" className="hidden" />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-10 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 select-none data-popup-open:bg-muted"
          aria-label={`User menu for ${email}`}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {initial}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">{email}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-(--anchor-width) min-w-44">
          <DropdownMenuItem onClick={() => router.push("/settings")}>Settings</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              formRef.current?.submit();
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
