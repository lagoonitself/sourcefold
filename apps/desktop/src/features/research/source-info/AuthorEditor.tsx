import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  AUTHOR_TYPES,
  AUTHOR_TYPE_HINTS,
  AUTHOR_TYPE_LABELS,
  RESEARCH_LIMITS,
  effectiveAuthorType,
  guessAuthorType,
  type AuthorType,
} from "@sourcefold/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { cn } from "@/lib/utils";
import { capturedAuthor, type ResearchItem } from "./research-logic";

/**
 * Who wrote it: the author (the captured byline shows as the placeholder) and the author type.
 * Without a stored type the menu shows the app's guess, marked "(guess)".
 */
export function AuthorEditor({
  item,
  onAuthor,
  onAuthorType,
  className,
}: {
  item: ResearchItem;
  onAuthor: (author: string | null) => void;
  onAuthorType: (type: AuthorType | null) => void;
  className?: string;
}) {
  const stored = (item.author ?? "").trim();
  const [draft, setDraft] = React.useState(stored);
  const editingRef = React.useRef(false);

  // Follow changes made elsewhere (the list, Claude) unless the field is being typed in.
  React.useEffect(() => {
    if (!editingRef.current) setDraft(stored);
  }, [stored]);

  const commit = () => {
    editingRef.current = false;
    const next = draft.trim();
    if (next !== stored) onAuthor(next ? next : null);
  };

  const { type, guessed } = effectiveAuthorType(item);
  const placeholder = capturedAuthor(item) ?? "Add the author";
  const hasGuess = guessAuthorType({ ...item, author_type: null }) !== null;

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <input
        value={draft}
        maxLength={RESEARCH_LIMITS.author}
        aria-label="Author"
        placeholder={placeholder}
        onFocus={() => {
          editingRef.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            editingRef.current = false;
            setDraft(stored);
            event.currentTarget.blur();
          }
        }}
        className="h-8 min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2.5 font-sans text-[13px] text-foreground transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none dark:bg-white/[0.03]"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={
              type
                ? `Author type: ${AUTHOR_TYPE_LABELS[type]}${guessed ? " (guess)" : ""}`
                : "Author type"
            }
            title="Author type"
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 font-sans text-[13px] font-medium shadow-[inset_0_0_0_1px_var(--border-strong)] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {type ? (
              <>
                <span className={guessed ? "text-muted-foreground" : "text-foreground"}>
                  {AUTHOR_TYPE_LABELS[type]}
                </span>
                {guessed && <span className="font-normal text-muted-foreground">(guess)</span>}
              </>
            ) : (
              <span className="text-muted-foreground">Author type</span>
            )}
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {AUTHOR_TYPES.map((value) => {
            const isStored = !guessed && type === value;
            return (
              <DropdownMenuItem
                key={value}
                onClick={() => onAuthorType(isStored ? null : value)}
                className="items-start"
              >
                <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                  {isStored && <Check className="size-3.5 !text-foreground" aria-hidden="true" />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {AUTHOR_TYPE_LABELS[value]}
                    {guessed && type === value && (
                      <span className="ml-1.5 font-normal text-muted-foreground">(guess)</span>
                    )}
                  </span>
                  <span className="text-[12px] leading-4 text-muted-foreground">
                    {AUTHOR_TYPE_HINTS[value]}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })}
          {!guessed && type && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onAuthorType(null)}>
                <span className="size-3.5" aria-hidden="true" />
                <span>{hasGuess ? "Clear, use the guess" : "Clear"}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
