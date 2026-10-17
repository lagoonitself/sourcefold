import React, { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { RecentXItem } from "../../lib/api";

interface ThreadPickerProps {
  /** Loads the open project's recent X threads. */
  load: () => Promise<RecentXItem[]>;
  add: (item: RecentXItem) => Promise<{ message: string; isError: boolean }>;
  disabled?: boolean;
}

/** "Add to this thread": attach the open X post to a thread saved earlier in this project. */
export function ThreadPicker({ load, add, disabled }: ThreadPickerProps) {
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<RecentXItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || threads !== null || loading) return;
    setLoading(true);
    try {
      setThreads(await load());
    } catch (err: unknown) {
      setStatus({
        message: err instanceof Error ? err.message : "Couldn't load recent threads.",
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const onAdd = async (item: RecentXItem) => {
    if (addingId) return;
    setAddingId(item.id);
    setStatus(null);
    setStatus(await add(item));
    setAddingId(null);
  };

  return (
    <div className="threads">
      <button
        type="button"
        className="threads-toggle"
        aria-expanded={open}
        onClick={() => void toggle()}
      >
        <ChevronRight size={14} aria-hidden="true" className="threads-chevron" />
        Add to this thread
      </button>
      {open && (
        <div className="threads-list">
          {loading && <p className="threads-note">Loading threads…</p>}
          {!loading && threads?.length === 0 && (
            <p className="threads-note">No X threads saved in this project yet.</p>
          )}
          {!loading &&
            threads?.map((item) => (
              <button
                key={item.id}
                type="button"
                className="thread-row"
                onClick={() => void onAdd(item)}
                disabled={disabled || addingId !== null}
              >
                <span className="thread-row-title">{item.title}</span>
                <span className="thread-row-meta">
                  {addingId === item.id
                    ? "Adding…"
                    : item.post_count === 1
                      ? "1 post"
                      : `${item.post_count} posts`}
                </span>
              </button>
            ))}
          {status && (
            <p className={`result ${status.isError ? "result-error" : "result-success"}`}>
              {!status.isError && <Check size={14} aria-hidden="true" />}
              <span>{status.message}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
