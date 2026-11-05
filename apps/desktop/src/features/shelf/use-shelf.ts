import * as React from "react";
import { toast } from "sonner";
import {
  SHELF_LIMITS,
  shelfKey,
  type ShelfAddResult,
  type ShelfLink,
  type ShelfLinkInput,
  type ShelfLinkPatch,
} from "@sourcefold/core";
import { errorMessage, openUrl } from "@/lib/utils";
import {
  addShelfLinks,
  deleteShelfLink,
  listShelf,
  recordShelfOpen,
  updateShelfLink,
} from "./shelf-api";
import { chunkItems } from "./shelf-format";

/** How long a deleted link can be brought back with Undo before it is removed for good. */
const UNDO_MS = 6000;

export type ShelfStatus = "loading" | "ready" | "error";

export interface ShelfController {
  links: ShelfLink[];
  status: ShelfStatus;
  reload: () => Promise<void>;
  /** Adds links in batches. Null when a batch failed (the error is shown as a toast). */
  add: (
    inputs: ShelfLinkInput[],
    onProgress?: (done: number) => void,
  ) => Promise<ShelfAddResult | null>;
  /** Saves a change at once; the row shows it before the server answers. Null on failure. */
  update: (id: string, patch: ShelfLinkPatch) => Promise<ShelfLink | null>;
  togglePin: (link: ShelfLink) => void;
  /** Hides the link now and removes it after the Undo window, unless Undo is pressed. */
  remove: (link: ShelfLink) => void;
  /** Opens the link in the browser, then counts the open. */
  open: (link: ShelfLink) => Promise<void>;
}

function applyPatch(link: ShelfLink, patch: ShelfLinkPatch): ShelfLink {
  return {
    ...link,
    url: patch.url ?? link.url,
    key: patch.url !== undefined ? (shelfKey(patch.url) ?? link.key) : link.key,
    title: patch.title ?? link.title,
    note: patch.note ?? link.note,
    tags: patch.tags ?? link.tags,
    pinned: patch.pinned ?? link.pinned,
  };
}

/** Puts `incoming` into `current`: replaces links with the same id, adds the rest first. */
function mergeLinks(current: ShelfLink[], incoming: ShelfLink[]): ShelfLink[] {
  if (incoming.length === 0) return current;
  const ids = new Set(incoming.map((link) => link.id));
  return [...incoming, ...current.filter((link) => !ids.has(link.id))];
}

/**
 * The shelf's data for the app: loads it, and changes it optimistically. Mutations that fail
 * show a toast and put the old state back. Shared by the shelf view, the dialogs and the palette.
 */
export function useShelf(): ShelfController {
  const [links, setLinks] = React.useState<ShelfLink[]>([]);
  const [status, setStatus] = React.useState<ShelfStatus>("loading");
  // Mirrors `links` so an async step reads the latest list, not the one from its render.
  const linksRef = React.useRef<ShelfLink[]>([]);
  const pendingDeletesRef = React.useRef(
    new Map<string, { link: ShelfLink; timer: ReturnType<typeof setTimeout> }>(),
  );
  const requestRef = React.useRef(0);

  const commit = React.useCallback((next: ShelfLink[]) => {
    linksRef.current = next;
    setLinks(next);
  }, []);

  const reload = React.useCallback(
    async (quiet = false) => {
      const request = ++requestRef.current;
      try {
        const list = await listShelf();
        if (request !== requestRef.current) return;
        const pending = pendingDeletesRef.current;
        commit(list.filter((link) => !pending.has(link.id)));
        setStatus("ready");
      } catch (err) {
        if (request !== requestRef.current) return;
        setStatus("error");
        if (!quiet) toast.error(errorMessage(err, "Couldn't load your shelf. Try again."));
      }
    },
    [commit],
  );

  React.useEffect(() => {
    void reload();
    const handleRefresh = () => void reload(true);
    // Signing in or out swaps the data source, so show nothing from the old one while it loads.
    const handleAuthChanged = () => {
      commit([]);
      setStatus("loading");
      void reload();
    };
    window.addEventListener("sourcefold:refresh", handleRefresh);
    window.addEventListener("sourcefold:auth-changed", handleAuthChanged);
    return () => {
      window.removeEventListener("sourcefold:refresh", handleRefresh);
      window.removeEventListener("sourcefold:auth-changed", handleAuthChanged);
    };
  }, [reload, commit]);

  // A delete still waiting for its Undo is finished when the shelf goes away.
  React.useEffect(() => {
    const pending = pendingDeletesRef.current;
    return () => {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        void deleteShelfLink(id).catch(() => {});
      }
      pending.clear();
    };
  }, []);

  const add = React.useCallback(
    async (inputs: ShelfLinkInput[], onProgress?: (done: number) => void) => {
      const total: ShelfAddResult = { added: [], existing: [] };
      let done = 0;
      try {
        for (const batch of chunkItems(inputs, SHELF_LIMITS.batch)) {
          const result = await addShelfLinks(batch);
          total.added.push(...result.added);
          total.existing.push(...result.existing);
          commit(mergeLinks(linksRef.current, result.added));
          done += batch.length;
          onProgress?.(done);
        }
        return total;
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't add to your shelf. Try again."));
        return null;
      }
    },
    [commit],
  );

  const update = React.useCallback(
    async (id: string, patch: ShelfLinkPatch) => {
      const previous = linksRef.current.find((link) => link.id === id);
      if (!previous) return null;
      commit(linksRef.current.map((link) => (link.id === id ? applyPatch(link, patch) : link)));
      try {
        const saved = await updateShelfLink(id, patch);
        commit(linksRef.current.map((link) => (link.id === id ? saved : link)));
        return saved;
      } catch (err) {
        commit(linksRef.current.map((link) => (link.id === id ? previous : link)));
        toast.error(errorMessage(err, "Couldn't save that link. Try again."));
        return null;
      }
    },
    [commit],
  );

  const togglePin = React.useCallback(
    (link: ShelfLink) => {
      void update(link.id, { pinned: !link.pinned });
    },
    [update],
  );

  const finishDelete = React.useCallback(
    async (link: ShelfLink) => {
      if (!pendingDeletesRef.current.delete(link.id)) return;
      try {
        await deleteShelfLink(link.id);
      } catch (err) {
        // The server still has it: bring it back.
        commit(mergeLinks(linksRef.current, [link]));
        toast.error(errorMessage(err, "Couldn't delete that link. Try again."));
      }
    },
    [commit],
  );

  const remove = React.useCallback(
    (link: ShelfLink) => {
      commit(linksRef.current.filter((item) => item.id !== link.id));
      const timer = setTimeout(() => void finishDelete(link), UNDO_MS);
      pendingDeletesRef.current.set(link.id, { link, timer });
      toast(`Deleted "${link.title}"`, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            if (!pendingDeletesRef.current.delete(link.id)) return;
            clearTimeout(timer);
            commit(mergeLinks(linksRef.current, [link]));
          },
        },
      });
    },
    [commit, finishDelete],
  );

  const open = React.useCallback(
    async (link: ShelfLink) => {
      const previous = linksRef.current.find((item) => item.id === link.id) ?? link;
      commit(
        linksRef.current.map((item) =>
          item.id === link.id
            ? { ...item, open_count: item.open_count + 1, last_opened_at: new Date().toISOString() }
            : item,
        ),
      );
      try {
        await openUrl(link.url);
      } catch {
        commit(linksRef.current.map((item) => (item.id === link.id ? previous : item)));
        toast.error("Couldn't open that link in your browser. Try again.");
        return;
      }
      try {
        const saved = await recordShelfOpen(link.id);
        commit(linksRef.current.map((item) => (item.id === link.id ? saved : item)));
      } catch (err) {
        commit(linksRef.current.map((item) => (item.id === link.id ? previous : item)));
        toast.error(errorMessage(err, "Couldn't count that open. Try again."));
      }
    },
    [commit],
  );

  return React.useMemo(
    () => ({ links, status, reload: () => reload(), add, update, togglePin, remove, open }),
    [links, status, reload, add, update, togglePin, remove, open],
  );
}
