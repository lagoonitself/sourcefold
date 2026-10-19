import * as React from "react";
import { toast } from "sonner";
import {
  positionBetween,
  sortSections,
  type Card,
  type CardInput,
  type CardPatch,
  type OutlineSection,
} from "@sourcefold/core";
import {
  deleteCard,
  deleteOutlineSection,
  getCards,
  getOutlineSections,
  getProjectItems,
  mergeItems,
  putCard,
  putOutlineSection,
  updateCard,
} from "@/lib/api";
import { isSessionExpiredError } from "@/lib/remote-client";
import type { MergeResult } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import {
  applyCardPatch,
  EMPTY_PROJECT_DATA,
  releaseSectionCards,
  renameTagOnItems,
  revertPatch,
  type ProjectDataState,
} from "./project-data-model";

export interface ProjectData extends ProjectDataState {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Adds a card (shown at once). Resolves to the saved card, or null when the write failed. */
  createCard: (input: CardInput) => Promise<Card | null>;
  /** Changes a card (shown at once). Resolves true when saved. */
  patchCard: (id: string, patch: CardPatch) => Promise<boolean>;
  /** Deletes a card (gone at once). Resolves to the deleted card, or null when it failed. */
  removeCard: (id: string) => Promise<Card | null>;
  /** Puts a deleted card back (the Undo of `removeCard`). */
  restoreCard: (card: Card) => Promise<boolean>;
  /** Adds a section at the end. Resolves to it, or null when the write failed. */
  createSection: (title: string) => Promise<OutlineSection | null>;
  renameSection: (id: string, title: string) => Promise<boolean>;
  moveSection: (id: string, position: number) => Promise<boolean>;
  /** Deletes a section; its cards go back to the pile. Resolves to the section, or null. */
  removeSection: (id: string) => Promise<OutlineSection | null>;
  /** Keeps one copy and merges the others into it, then reloads. */
  mergeDuplicates: (keepId: string, ids: string[]) => Promise<MergeResult | null>;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface Stored {
  projectId: string | null;
  data: ProjectDataState;
  loaded: boolean;
  error: string | null;
}

/**
 * The open project's cards, outline sections and sources, loaded together. Writes show at once and
 * are put back (with a toast) when the write fails. Reloads on the app's refresh events; a reload
 * that finishes while a write is running is dropped, and the data reloads once the write is done.
 */
export function useProjectData(projectId: string | null): ProjectData {
  const [stored, setStored] = React.useState<Stored>({
    projectId: null,
    data: EMPTY_PROJECT_DATA,
    loaded: false,
    error: null,
  });
  const storedRef = React.useRef(stored);
  const projectIdRef = React.useRef(projectId);
  projectIdRef.current = projectId;
  const requestRef = React.useRef(0);
  // Writes in flight, and a counter that moves on every write, so a slow reload can be dropped.
  const pendingRef = React.useRef(0);
  const epochRef = React.useRef(0);
  const droppedRef = React.useRef(false);

  const commit = React.useCallback((next: Stored) => {
    storedRef.current = next;
    setStored(next);
  }, []);

  /** Changes the loaded data of the open project; ignored while another project is shown. */
  const change = React.useCallback(
    (fn: (data: ProjectDataState) => ProjectDataState) => {
      const current = storedRef.current;
      if (current.projectId !== projectIdRef.current) return;
      commit({ ...current, data: fn(current.data) });
    },
    [commit],
  );

  const refresh = React.useCallback(async () => {
    const requestId = ++requestRef.current;
    const epoch = epochRef.current;
    const id = projectId;
    if (!id) {
      commit({ projectId: null, data: EMPTY_PROJECT_DATA, loaded: true, error: null });
      return;
    }
    try {
      const [cards, sections, items] = await Promise.all([
        getCards({ projectId: id }),
        getOutlineSections(id),
        getProjectItems(id),
      ]);
      if (requestId !== requestRef.current) return;
      if (pendingRef.current > 0 || epoch !== epochRef.current) {
        droppedRef.current = true;
        // The first load has nothing to protect, so it still shows.
        if (storedRef.current.projectId === id) return;
      }
      commit({
        projectId: id,
        data: { cards, sections: sortSections(sections), items },
        loaded: true,
        error: null,
      });
    } catch (err) {
      if (requestId !== requestRef.current || isSessionExpiredError(err)) return;
      const message = errorMessage(err, "Couldn't load the project's cards.");
      const current = storedRef.current;
      commit({
        projectId: id,
        data: current.projectId === id ? current.data : EMPTY_PROJECT_DATA,
        loaded: true,
        error: message,
      });
    }
  }, [projectId, commit]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    const reload = () => void refresh();
    window.addEventListener("sourcefold:refresh", reload);
    window.addEventListener("sourcefold:auth-changed", reload);
    return () => {
      window.removeEventListener("sourcefold:refresh", reload);
      window.removeEventListener("sourcefold:auth-changed", reload);
    };
  }, [refresh]);

  /** Runs a write: counts it as pending, and reloads afterwards if a reload was dropped meanwhile. */
  const write = React.useCallback(
    async <T>(run: () => Promise<T>): Promise<T> => {
      pendingRef.current += 1;
      epochRef.current += 1;
      try {
        return await run();
      } finally {
        pendingRef.current -= 1;
        epochRef.current += 1;
        if (pendingRef.current === 0 && droppedRef.current) {
          droppedRef.current = false;
          void refresh();
        }
      }
    },
    [refresh],
  );

  const createCard = React.useCallback(
    async (input: CardInput): Promise<Card | null> => {
      const now = new Date().toISOString();
      const optimistic: Card = { ...input, created_at: now, updated_at: now };
      change((d) => ({ ...d, cards: [...d.cards, optimistic] }));
      try {
        const saved = await write(() => putCard(input));
        change((d) => ({ ...d, cards: d.cards.map((c) => (c.id === saved.id ? saved : c)) }));
        return saved;
      } catch (err) {
        change((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== input.id) }));
        toast.error(errorMessage(err, "Couldn't add the card."));
        return null;
      }
    },
    [change, write],
  );

  const patchCard = React.useCallback(
    async (id: string, patch: CardPatch): Promise<boolean> => {
      const before = storedRef.current.data.cards.find((c) => c.id === id);
      if (!before) return false;
      const back = revertPatch(before, patch);
      change((d) => ({ ...d, cards: applyCardPatch(d.cards, id, patch) }));
      try {
        const saved = await write(() => updateCard(id, patch));
        change((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? saved : c)) }));
        return true;
      } catch (err) {
        change((d) => ({ ...d, cards: applyCardPatch(d.cards, id, back) }));
        toast.error(errorMessage(err, "Couldn't save the change to the card."));
        return false;
      }
    },
    [change, write],
  );

  const removeCard = React.useCallback(
    async (id: string): Promise<Card | null> => {
      const before = storedRef.current.data.cards.find((c) => c.id === id);
      if (!before) return null;
      change((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
      try {
        await write(() => deleteCard(id));
        return before;
      } catch (err) {
        change((d) => ({ ...d, cards: [...d.cards, before] }));
        toast.error(errorMessage(err, "Couldn't delete the card."));
        return null;
      }
    },
    [change, write],
  );

  const restoreCard = React.useCallback(
    async (card: Card): Promise<boolean> => {
      const { created_at: _created, updated_at: _updated, ...input } = card;
      // Its section may be gone since; the card then waits in the pile.
      const sectionExists =
        card.section_id === null ||
        storedRef.current.data.sections.some((s) => s.id === card.section_id);
      const restored = await createCard({
        ...input,
        section_id: sectionExists ? card.section_id : null,
      });
      return restored !== null;
    },
    [createCard],
  );

  const createSection = React.useCallback(
    async (title: string): Promise<OutlineSection | null> => {
      const last = sortSections(storedRef.current.data.sections).at(-1);
      const now = new Date().toISOString();
      const section: OutlineSection = {
        id: newId(),
        project_id: projectIdRef.current ?? "",
        title,
        position: positionBetween(last?.position ?? null, null),
        created_at: now,
        updated_at: now,
      };
      change((d) => ({ ...d, sections: sortSections([...d.sections, section]) }));
      try {
        const { created_at: _c, updated_at: _u, ...input } = section;
        const saved = await write(() => putOutlineSection(input));
        change((d) => ({
          ...d,
          sections: sortSections(d.sections.map((s) => (s.id === saved.id ? saved : s))),
        }));
        return saved;
      } catch (err) {
        change((d) => ({ ...d, sections: d.sections.filter((s) => s.id !== section.id) }));
        toast.error(errorMessage(err, "Couldn't add the section."));
        return null;
      }
    },
    [change, write],
  );

  const writeSection = React.useCallback(
    async (
      id: string,
      patch: Partial<Pick<OutlineSection, "title" | "position">>,
      failure: string,
    ): Promise<boolean> => {
      const before = storedRef.current.data.sections.find((s) => s.id === id);
      if (!before) return false;
      const itemsBefore = storedRef.current.data.items;
      const renamed = patch.title !== undefined && patch.title !== before.title;
      change((d) => ({
        ...d,
        sections: sortSections(d.sections.map((s) => (s.id === id ? { ...s, ...patch } : s))),
        items: renamed ? renameTagOnItems(d.items, before.title, patch.title!) : d.items,
      }));
      try {
        const saved = await write(() =>
          putOutlineSection({
            id,
            project_id: before.project_id,
            title: patch.title ?? before.title,
            position: patch.position ?? before.position,
          }),
        );
        change((d) => ({
          ...d,
          sections: sortSections(d.sections.map((s) => (s.id === id ? saved : s))),
        }));
        return true;
      } catch (err) {
        change((d) => ({
          ...d,
          sections: sortSections(
            d.sections.map((s) =>
              s.id === id ? { ...s, title: before.title, position: before.position } : s,
            ),
          ),
          items: renamed ? itemsBefore : d.items,
        }));
        toast.error(errorMessage(err, failure));
        return false;
      }
    },
    [change, write],
  );

  const renameSection = React.useCallback(
    (id: string, title: string) => writeSection(id, { title }, "Couldn't rename the section."),
    [writeSection],
  );

  const moveSection = React.useCallback(
    (id: string, position: number) => writeSection(id, { position }, "Couldn't move the section."),
    [writeSection],
  );

  const removeSection = React.useCallback(
    async (id: string): Promise<OutlineSection | null> => {
      const before = storedRef.current.data.sections.find((s) => s.id === id);
      if (!before) return null;
      const released = new Set(
        storedRef.current.data.cards.filter((c) => c.section_id === id).map((c) => c.id),
      );
      change((d) => ({
        ...d,
        sections: d.sections.filter((s) => s.id !== id),
        cards: releaseSectionCards(d.cards, id),
      }));
      try {
        await write(() => deleteOutlineSection(id));
        return before;
      } catch (err) {
        change((d) => ({
          ...d,
          sections: sortSections([...d.sections, before]),
          cards: d.cards.map((c) => (released.has(c.id) ? { ...c, section_id: id } : c)),
        }));
        toast.error(errorMessage(err, "Couldn't delete the section."));
        return null;
      }
    },
    [change, write],
  );

  const mergeDuplicates = React.useCallback(
    async (keepId: string, ids: string[]): Promise<MergeResult | null> => {
      try {
        const result = await write(() => mergeItems(keepId, ids));
        await refresh();
        return result;
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't merge the copies. Nothing was changed."));
        return null;
      }
    },
    [refresh, write],
  );

  const current = stored.projectId === projectId;
  const data = current ? stored.data : EMPTY_PROJECT_DATA;
  return React.useMemo(
    () => ({
      cards: data.cards,
      sections: data.sections,
      items: data.items,
      loading: !current || !stored.loaded,
      error: current ? stored.error : null,
      refresh,
      createCard,
      patchCard,
      removeCard,
      restoreCard,
      createSection,
      renameSection,
      moveSection,
      removeSection,
      mergeDuplicates,
    }),
    [
      data,
      current,
      stored.loaded,
      stored.error,
      refresh,
      createCard,
      patchCard,
      removeCard,
      restoreCard,
      createSection,
      renameSection,
      moveSection,
      removeSection,
      mergeDuplicates,
    ],
  );
}
