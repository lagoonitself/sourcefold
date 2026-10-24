import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { getProjectItems } from "@/lib/api";
import type { Folder, Item } from "@/lib/types";
import { errorMessage } from "@/lib/utils";
import { canHaveTldr } from "./tldr-engine";
import { listTldrs } from "./tldr-api";
import { getTldrPrefs, updateTldrPrefs } from "./tldr-prefs";
import {
  AI_CHANGED_EVENT,
  PICK_GROUP_EVENT,
  setGroupsChangedHandler,
  tldrEngine,
} from "./tldr-store";

/** Above this many sources, "Write TL;DRs for this group" asks first (it uses the plan). */
const CONFIRM_OVER = 25;
/** The open project is checked for new saves (from the extension, Claude) at most this often. */
const RESCAN_MS = 60_000;

/** The group and every group under it. */
export function subtreeIds(folders: readonly Folder[], groupId: string): Set<string> {
  const ids = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && ids.has(f.parent_id) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

function projectOf(folders: readonly Folder[], folderId: string): string | null {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(folderId);
  for (let depth = 0; current && depth < 1000; depth++) {
    if (!current.parent_id) return current.id;
    current = byId.get(current.parent_id);
  }
  return null;
}

export interface TldrProviderProps {
  projectId: string | null;
  folders: Folder[];
}

/**
 * Keeps the TL;DR writer fed: loads the open project's TL;DRs, queues new saves, restores and
 * runs picked groups, and asks before a big group.
 */
export function TldrProvider({ projectId, folders }: TldrProviderProps) {
  const foldersRef = React.useRef(folders);
  foldersRef.current = folders;
  const projectRef = React.useRef(projectId);
  projectRef.current = projectId;
  const projectItemsRef = React.useRef<Item[]>([]);
  const lastScanRef = React.useRef(0);
  const [confirm, setConfirm] = React.useState<{
    groupId: string;
    name: string;
    items: Item[];
  } | null>(null);

  // Picked groups are kept across restarts; the engine only knows the open project's.
  React.useEffect(() => {
    setGroupsChangedHandler((active) => {
      const all = foldersRef.current;
      const project = projectRef.current;
      const kept = getTldrPrefs().pickedGroups.filter(
        (id) => !project || projectOf(all, id) !== project,
      );
      updateTldrPrefs({ pickedGroups: [...new Set([...kept, ...active])] });
    });
    return () => setGroupsChangedHandler(null);
  }, []);

  const scan = React.useCallback(async (force: boolean) => {
    const project = projectRef.current;
    if (!project) return;
    const now = Date.now();
    if (!force && now - lastScanRef.current < RESCAN_MS) return;
    lastScanRef.current = now;
    try {
      const [items, tldrs] = await Promise.all([
        getProjectItems(project),
        listTldrs({ projectId: project }),
      ]);
      if (projectRef.current !== project) return;
      projectItemsRef.current = items;
      tldrEngine.addTldrs(tldrs);

      const prefs = getTldrPrefs();
      if (prefs.auto) tldrEngine.observeNewSaves(items, prefs.startedAt);

      // Picked groups of this project that aren't running yet (after a restart).
      const all = foldersRef.current;
      for (const groupId of prefs.pickedGroups) {
        if (projectOf(all, groupId) !== project) continue;
        if (tldrEngine.groupRemaining(groupId) !== null) continue;
        const ids = subtreeIds(all, groupId);
        tldrEngine.pickGroup(
          groupId,
          items.filter((i) => ids.has(i.folder_id)),
        );
      }
    } catch (err) {
      console.warn("Couldn't load TL;DRs", err);
    }
  }, []);

  React.useEffect(() => {
    void tldrEngine.refreshAi();
  }, []);

  React.useEffect(() => {
    if (!projectId) return;
    void scan(true);
  }, [projectId, scan]);

  React.useEffect(() => {
    const onRefresh = () => void scan(false);
    const onFocus = () => void scan(false);
    const onAuth = () => {
      tldrEngine.reset();
      void tldrEngine.refreshAi();
      void scan(true);
    };
    const onAi = () => void tldrEngine.refreshAi();
    window.addEventListener("sourcefold:refresh", onRefresh);
    window.addEventListener("focus", onFocus);
    window.addEventListener("sourcefold:auth-changed", onAuth);
    window.addEventListener(AI_CHANGED_EVENT, onAi);
    return () => {
      window.removeEventListener("sourcefold:refresh", onRefresh);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("sourcefold:auth-changed", onAuth);
      window.removeEventListener(AI_CHANGED_EVENT, onAi);
    };
  }, [scan]);

  const start = React.useCallback((groupId: string, items: Item[]) => {
    tldrEngine.pickGroup(groupId, items);
    const n = items.length;
    toast.success(n === 1 ? "Writing 1 TL;DR" : `Writing ${n} TL;DRs`);
  }, []);

  // "Write TL;DRs for this group" from a menu or the palette.
  React.useEffect(() => {
    const onPick = async (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId: string }>).detail?.groupId;
      if (!groupId) return;
      const all = foldersRef.current;
      const project = projectOf(all, groupId);
      if (!project) return;
      try {
        const [items, tldrs] = await Promise.all([
          getProjectItems(project),
          listTldrs({ projectId: project }),
        ]);
        tldrEngine.addTldrs(tldrs);
        const ids = subtreeIds(all, groupId);
        const missing = items.filter(
          (i) => ids.has(i.folder_id) && canHaveTldr(i) && !tldrEngine.tldrs.has(i.id),
        );
        if (missing.length === 0) {
          toast.info("Every source in this group has a TL;DR.");
          return;
        }
        const name = all.find((f) => f.id === groupId)?.name ?? "this group";
        if (missing.length > CONFIRM_OVER) setConfirm({ groupId, name, items: missing });
        else start(groupId, missing);
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't load this group's sources."));
      }
    };
    window.addEventListener(PICK_GROUP_EVENT, onPick);
    return () => window.removeEventListener(PICK_GROUP_EVENT, onPick);
  }, [start]);

  return (
    <Dialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Write {confirm?.items.length} TL;DRs?</DialogTitle>
          <DialogDescription>
            {confirm?.name} has {confirm?.items.length} sources without a TL;DR. Sources that have
            their own summary cost nothing; the rest each use part of your plan or credits. You can
            stop any time from the group&apos;s menu.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (confirm) start(confirm.groupId, confirm.items);
              setConfirm(null);
            }}
          >
            Write TL;DRs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
