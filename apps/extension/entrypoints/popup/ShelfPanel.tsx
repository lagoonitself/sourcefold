import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { browser } from "wxt/browser";
import { parseShelfTagsText, SHELF_LIMITS, type ShelfLink } from "@sourcefold/core";
import { BookMarked, Check, LoaderCircle } from "lucide-react";
import {
  addToShelf,
  findShelfLink,
  refreshShelfIndex,
  shelfBlockReason,
  SHELF_INDEX_KEY,
  updateShelfLink,
} from "../../lib/shelf";

const SAVED_FLASH_MS = 2000;

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The shelf link for this page, from the cache. Re-reads when the cache changes. */
function useShelfLink(url: string): ShelfLink | null {
  const [link, setLink] = useState<ShelfLink | null>(null);

  useEffect(() => {
    let ignore = false;
    const read = () => {
      findShelfLink(url)
        .then((found) => {
          if (!ignore) setLink(found ?? null);
        })
        .catch(() => {});
    };
    read();
    // Opening the popup refreshes the cache in the background, at most every five minutes.
    void refreshShelfIndex().catch(() => {});

    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && SHELF_INDEX_KEY in changes) read();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      ignore = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [url]);

  return link;
}

interface ShelfTarget {
  url: string;
  title: string;
}

/**
 * The Save row: the given Save button, with Shelve next to it. Shelving adds the current tab and
 * never downloads the page, so it works for every web page, including ones Save can't use.
 */
export function ShelfSaveRow({ url, title, save }: ShelfTarget & { save?: ReactNode }) {
  const link = useShelfLink(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = shelfBlockReason(url);
  const onShelf = link !== null;

  const shelve = async () => {
    if (busy || onShelf || reason) return;
    setBusy(true);
    setError(null);
    try {
      await addToShelf({ url, title: title && title !== url ? title : undefined });
    } catch (err: unknown) {
      setError(errorText(err, "Couldn't add this page to your shelf. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? "Shelving…" : onShelf ? "Shelved" : "Shelve";
  const buttonTitle = reason ?? (onShelf ? "On your shelf" : "Add this page to your shelf");

  return (
    <>
      <div className={save ? "save-row" : "save-row save-row-solo"}>
        {save}
        <button
          type="button"
          className="btn-outline btn-shelve"
          onClick={() => void shelve()}
          disabled={busy || onShelf || reason !== null}
          title={buttonTitle}
        >
          {busy ? (
            <LoaderCircle size={16} className="spin" aria-hidden="true" />
          ) : (
            <BookMarked size={16} aria-hidden="true" />
          )}
          <span>{label}</span>
        </button>
      </div>
      {error && <p className="result result-error">{error}</p>}
    </>
  );
}

/** The note and tags of this page's shelf link. Shows nothing until the page is on the shelf. */
export function ShelfNote({ url }: { url: string }) {
  const link = useShelfLink(url);
  if (!link) return null;
  return <ShelfNoteForm key={link.id} link={link} />;
}

function ShelfNoteForm({ link }: { link: ShelfLink }) {
  const [note, setNote] = useState(link.note);
  const [tagsText, setTagsText] = useState(link.tags.join(", "));
  const [saved, setSaved] = useState<"note" | "tags" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const flash = (what: "note" | "tags") => {
    setSaved(what);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSaved(null), SAVED_FLASH_MS);
  };

  const saveNote = async () => {
    const next = note.trim();
    if (next === link.note.trim()) return;
    setError(null);
    try {
      await updateShelfLink(link.id, { note: next });
      flash("note");
    } catch (err: unknown) {
      setError(errorText(err, "Couldn't save the note. Try again."));
    }
  };

  const saveTags = async () => {
    const tags = parseShelfTagsText(tagsText);
    setTagsText(tags.join(", "));
    if (tags.join("\n") === link.tags.join("\n")) return;
    setError(null);
    try {
      await updateShelfLink(link.id, { tags });
      flash("tags");
    } catch (err: unknown) {
      setError(errorText(err, "Couldn't save the tags. Try again."));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void saveNote();
      void saveTags();
    }
  };

  return (
    <section className="shelf-panel" aria-label="On your shelf">
      <div className="shelf-panel-head">
        <span className="shelf-panel-title">On your shelf</span>
        {saved && (
          <span className="shelf-saved" role="status">
            <Check size={13} aria-hidden="true" />
            <span>Saved</span>
          </span>
        )}
      </div>
      <label className="shelf-field">
        <span className="label">Note</span>
        <textarea
          className="input-field shelf-note"
          rows={2}
          maxLength={SHELF_LIMITS.note}
          placeholder="What to remember about this site"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => void saveNote()}
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="shelf-field">
        <span className="label">Tags</span>
        <input
          type="text"
          className="input-field input-sm"
          placeholder="Comma separated, for example research, cars"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          onBlur={() => void saveTags()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveTags();
            }
          }}
        />
      </label>
      {error && <p className="result result-error">{error}</p>}
    </section>
  );
}
