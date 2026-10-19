import * as React from "react";
import { Plus, X } from "lucide-react";
import { RESEARCH_LIMITS, sameTag } from "@sourcefold/core";
import { cn } from "@/lib/utils";
import { tagSuggestions, type TagSuggestion } from "./research-logic";
import type { ProjectTagData } from "./use-project-info";

export interface TagEditorProps {
  /** The tags to show as chips. */
  tags: readonly string[];
  /** Outline sections and project tags to suggest. */
  data: Pick<ProjectTagData, "sections" | "projectTags">;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  /** Esc in the empty field. */
  onEscape?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

/**
 * Tag chips with a field to add more. The field suggests the project's outline sections first,
 * then tags already used in the project. Enter adds what you typed (or the suggestion you moved
 * to with the arrow keys); a click adds a suggestion.
 */
export function TagEditor({
  tags,
  data,
  onAdd,
  onRemove,
  onEscape,
  autoFocus,
  placeholder = "Add a tag",
  className,
  inputRef,
}: TagEditorProps) {
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const listId = React.useId();

  const suggestions = React.useMemo(
    () =>
      tagSuggestions({
        sections: data.sections,
        projectTags: data.projectTags,
        current: tags,
        query,
      }),
    [data.sections, data.projectTags, tags, query],
  );

  const typed = query.replace(/\s+/g, " ").trim();
  const exact = typed ? (suggestions.find((s) => sameTag(s.tag, typed)) ?? null) : null;
  const alreadyHas = typed ? tags.some((t) => sameTag(t, typed)) : false;
  const canCreate = typed !== "" && !exact && !alreadyHas;
  const rows: Array<TagSuggestion | { tag: string; kind: "new" }> = canCreate
    ? [...suggestions, { tag: typed.slice(0, RESEARCH_LIMITS.tagLength), kind: "new" }]
    : suggestions;
  const open = focused && rows.length > 0;

  const choose = (tag: string) => {
    onAdd(tag);
    setQuery("");
    setActive(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (rows.length === 0) return;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      setActive((cur) => (down ? (cur + 1) % rows.length : cur <= 0 ? rows.length - 1 : cur - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (active >= 0 && rows[active]) choose(rows[active].tag);
      else if (typed) choose(exact?.tag ?? typed);
    } else if (event.key === "Escape") {
      if (query) {
        event.preventDefault();
        event.stopPropagation();
        setQuery("");
        setActive(-1);
      } else if (onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {tags.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex max-w-full items-center gap-1 rounded-[7px] bg-muted py-0.5 pl-2 pr-1 font-sans text-[12.5px] leading-[18px] text-foreground"
            >
              <span className="truncate">{tag}</span>
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remove tag ${tag}`}
                title={`Remove ${tag}`}
                className="inline-flex size-4 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          maxLength={RESEARCH_LIMITS.tagLength}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Add a tag"
          spellCheck={false}
          className="h-8 w-full rounded-[8px] border border-input bg-background px-2.5 font-sans text-[13px] text-foreground transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-muted-foreground/80 hover:border-border-strong focus-visible:border-foreground/40 focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_10%,transparent)] focus-visible:outline-none dark:bg-white/[0.03]"
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            className="mt-1 max-h-44 overflow-y-auto rounded-[10px] bg-popover p-1 text-popover-foreground shadow-float"
          >
            {rows.map((row, index) => (
              <li
                key={`${row.kind}:${row.tag}`}
                role="option"
                aria-selected={index === active}
                // Keep the field focused: the press must not blur it before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(row.tag)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 font-sans text-[13px] text-foreground",
                  index === active ? "bg-muted" : "hover:bg-muted",
                )}
              >
                {row.kind === "new" ? (
                  <>
                    <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">Add “{row.tag}”</span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{row.tag}</span>
                    {row.kind === "section" && (
                      <span className="shrink-0 text-[12px] text-muted-foreground">Section</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
