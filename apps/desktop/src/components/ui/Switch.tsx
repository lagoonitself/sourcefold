import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center select-none",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        id={id}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="h-5 w-[34px] rounded-full bg-border-strong transition-colors duration-150 ease-out peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
      />
      <span
        aria-hidden="true"
        className="absolute left-0.5 top-0.5 size-4 rounded-full bg-background shadow-xs transition-transform duration-150 ease-spring peer-checked:translate-x-3.5"
      />
    </label>
  );
}
