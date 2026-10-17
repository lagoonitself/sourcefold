import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import type { ProjectSection } from "../../lib/folder-tree";

interface ProjectMenuProps {
  sections: ProjectSection[];
  currentId: string;
  disabled?: boolean;
  onSelect: (projectId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
}

const FILTER_FROM = 7;

/** The open project, with a menu to switch to another one or start a new one. */
export function ProjectMenu({
  sections,
  currentId,
  disabled,
  onSelect,
  onCreate,
}: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const current = sections.find((s) => s.project.id === currentId);
  const q = query.trim().toLowerCase();
  const visible = q ? sections.filter((s) => s.project.name.toLowerCase().includes(q)) : sections;
  const showFilter = sections.length >= FILTER_FROM;

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    setCreating(false);
    setNewName("");
    if (refocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const index = Math.max(
      0,
      visible.findIndex((s) => s.project.id === currentId),
    );
    setHighlighted(index);
    requestAnimationFrame(() => {
      if (firstFieldRef.current) firstFieldRef.current.focus();
      else listRef.current?.focus();
    });
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
    // Runs when the menu opens, not on every filter change.
  }, [open]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  const choose = (projectId: string) => {
    onSelect(projectId);
    close();
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const ok = await onCreate(name);
    setBusy(false);
    if (ok) close();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (creating) {
        setCreating(false);
        setNewName("");
      } else {
        close();
      }
      return;
    }
    if (creating) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void submitNew();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted((i) => (visible.length ? (i + step + visible.length) % visible.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const section = visible[highlighted];
      if (section) choose(section.project.id);
    }
  };

  return (
    <div className="project-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="project-trigger"
        onClick={() => (open ? close() : setOpen(true))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch project"
      >
        <span className="project-trigger-name">{current?.project.name ?? "Choose a project"}</span>
        <ChevronsUpDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className="menu" onKeyDown={onMenuKeyDown}>
          {showFilter && !creating && (
            <div className="menu-filter">
              <Search size={14} aria-hidden="true" />
              <input
                ref={firstFieldRef}
                type="text"
                value={query}
                placeholder="Find a project"
                aria-label="Find a project"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setHighlighted(0);
                }}
              />
            </div>
          )}

          {!creating && (
            <div
              ref={listRef}
              className="menu-list"
              role="listbox"
              aria-label="Projects"
              tabIndex={-1}
            >
              {visible.length === 0 ? (
                <p className="menu-empty">No projects match “{query.trim()}”.</p>
              ) : (
                visible.map((section, index) => {
                  const isCurrent = section.project.id === currentId;
                  return (
                    <button
                      key={section.project.id}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      data-index={index}
                      tabIndex={-1}
                      className={`menu-item${index === highlighted ? " is-highlighted" : ""}`}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => choose(section.project.id)}
                    >
                      <span className="menu-item-check">
                        {isCurrent && <Check size={14} aria-hidden="true" />}
                      </span>
                      <span className="menu-item-name">{section.project.name}</span>
                      <span className="menu-item-meta">
                        {section.groups.length === 1
                          ? "1 group"
                          : `${section.groups.length} groups`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          <div className="menu-footer">
            {creating ? (
              <div className="inline-create">
                <input
                  ref={firstFieldRef}
                  type="text"
                  className="input-field input-sm"
                  value={newName}
                  placeholder="Project name, for example the video title"
                  aria-label="Project name"
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={() => void submitNew()}
                  disabled={!newName.trim() || busy}
                >
                  {busy ? "Creating…" : "Create"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="menu-item menu-item-action"
                onClick={() => setCreating(true)}
              >
                <span className="menu-item-check">
                  <Plus size={14} aria-hidden="true" />
                </span>
                <span className="menu-item-name">New project</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
