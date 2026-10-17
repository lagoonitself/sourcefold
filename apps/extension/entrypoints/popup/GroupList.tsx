import React, { useEffect, useRef, useState } from "react";
import { Check, Folder, FolderOpen, Plus, Search } from "lucide-react";
import type { FolderTreeItem } from "../../lib/folder-tree";

export interface VisibleGroup {
  item: FolderTreeItem;
  /** Indent level inside the project: 0 for a top-level group. */
  level: number;
  /** Parent group names, shown while filtering because the tree indent is gone then. */
  hint?: string;
}

interface GroupListProps {
  groups: VisibleGroup[];
  selectedId: string;
  savedIds: Set<string>;
  showFilter: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  filterRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (groupId: string) => void;
  onActivate: (groupId: string) => void;
  onCreate: (name: string, insideSelected: boolean) => Promise<boolean>;
  selectedName?: string;
  disabled?: boolean;
  emptyProject: boolean;
}

/** The open project's groups. Click picks one; double-click or Enter saves there. */
export function GroupList({
  groups,
  selectedId,
  savedIds,
  showFilter,
  query,
  onQueryChange,
  filterRef,
  onSelect,
  onActivate,
  onCreate,
  selectedName,
  disabled,
  emptyProject,
}: GroupListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [inside, setInside] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    if (emptyProject) setCreating(true);
  }, [emptyProject]);

  const cancel = () => {
    setCreating(false);
    setName("");
    setInside(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const ok = await onCreate(trimmed, inside && Boolean(selectedId));
    setBusy(false);
    if (ok) cancel();
  };

  return (
    <div className="groups">
      {showFilter && (
        <div className="groups-filter">
          <Search size={14} aria-hidden="true" />
          <input
            ref={filterRef}
            type="text"
            value={query}
            placeholder="Find a group"
            aria-label="Find a group"
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      )}

      {emptyProject ? (
        <p className="groups-empty">
          This project has no groups yet. Create a group, for example “Interviews”, then save pages
          to it.
        </p>
      ) : (
        <div ref={listRef} className="groups-list" role="listbox" aria-label="Groups">
          {groups.length === 0 ? (
            <p className="groups-empty">No groups match “{query.trim()}”.</p>
          ) : (
            groups.map(({ item, level, hint }) => {
              const selected = item.id === selectedId;
              const saved = savedIds.has(item.id);
              const Icon = selected ? FolderOpen : Folder;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  className={`group-row${selected ? " is-selected" : ""}`}
                  style={{ paddingLeft: 10 + level * 16 }}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onActivate(item.id)}
                  disabled={disabled}
                  title={hint ? `${hint} / ${item.name}` : item.name}
                >
                  <Icon size={15} aria-hidden="true" className="group-row-icon" />
                  <span className="group-row-name">
                    {hint && <span className="group-row-hint">{hint} / </span>}
                    {item.name}
                  </span>
                  {saved && (
                    <span className="group-row-saved">
                      <Check size={12} aria-hidden="true" />
                      Saved
                    </span>
                  )}
                  {typeof item.itemCount === "number" && (
                    <span className="group-row-count">{item.itemCount}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      {creating ? (
        <div className="group-create">
          <div className="inline-create">
            <input
              type="text"
              className="input-field input-sm"
              placeholder="Group name"
              aria-label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void submit();
                } else if (e.key === "Escape" && !emptyProject) {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                }
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            {!emptyProject && (
              <button type="button" className="btn-ghost btn-sm" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>
          {selectedName && !emptyProject && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={inside}
                onChange={(e) => setInside(e.target.checked)}
              />
              <span>Inside {selectedName}</span>
            </label>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="group-new"
          onClick={() => setCreating(true)}
          disabled={disabled}
        >
          <Plus size={14} aria-hidden="true" />
          New group
        </button>
      )}
    </div>
  );
}
