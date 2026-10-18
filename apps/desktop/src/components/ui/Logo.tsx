import { cn } from "@/lib/utils";

const S_FOLD =
  "M 292 268 H 732 A 32 32 0 0 1 764 300 V 340 A 32 32 0 0 1 732 372 H 380 A 16 16 0 0 0 364 388 V 444 A 16 16 0 0 0 380 460 H 732 A 32 32 0 0 1 764 492 V 724 A 32 32 0 0 1 732 756 H 292 A 32 32 0 0 1 260 724 V 684 A 32 32 0 0 1 292 652 H 644 A 16 16 0 0 0 660 636 V 580 A 16 16 0 0 0 644 564 H 292 A 32 32 0 0 1 260 532 V 300 A 32 32 0 0 1 292 268 Z";

/** The Sourcefold mark: an ink tile with the folded S, its middle fold run over with the highlighter. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="100 100 824 824" className={cn("size-6 shrink-0", className)} aria-hidden="true">
      <defs>
        <clipPath id="sourcefold-logo-fold">
          <path d={S_FOLD} />
        </clipPath>
      </defs>
      <rect x="100" y="100" width="824" height="824" rx="200" fill="#15181E" />
      <rect
        x="100"
        y="100"
        width="824"
        height="824"
        rx="200"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.12"
        strokeWidth="16"
      />
      <path d={S_FOLD} fill="#FCFCFB" />
      <rect
        x="240"
        y="452"
        width="544"
        height="120"
        fill="#F5DC3C"
        clipPath="url(#sourcefold-logo-fold)"
      />
    </svg>
  );
}
