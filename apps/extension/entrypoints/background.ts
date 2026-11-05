import { browser } from "wxt/browser";
import { detectSource } from "@sourcefold/core";
import { saveGrokipedia, ApiError } from "../lib/api";
import { getLastFolderId, clearLastFolderId } from "../lib/last-folder";
import { invalidateTargetCache } from "../lib/target";
import {
  accountFetch,
  accountStatus,
  resetAccountClients,
  resolveAccountTarget,
  signIn,
  signOut,
} from "../lib/account";
import { serveAccountChannel } from "../lib/account-channel";
import { permissionBannerText } from "../lib/link-queue/copy";
import { createExtensionLinkQueue, listenForLinkQueue } from "../lib/link-queue/start";
import { readLinkQueueState } from "../lib/link-queue/state";
import type { LinkQueueState } from "../lib/link-queue/types";
import { clearShelfIndex, findShelfLink, refreshShelfIndex, SHELF_INDEX_KEY } from "../lib/shelf";

const SUCCESS_COLOR = "#1F5E4E";
const ERROR_COLOR = "#B42318";
const PERMISSION_COLOR = "#B54708";
const SHELF_INK_COLOR = "#1C2533";
const BADGE_CLEAR_ALARM = "sourcefold-clear-badge";
const LINK_QUEUE_ALARM = "sourcefold-link-queue";

interface Badge {
  text: string;
  color: string;
}

let permissionBadgeOn = false;
/** The badge the existing code last put on the toolbar icon for every tab, or null. */
let shownBadge: Badge | null = null;

// Tabs whose tab-specific badge we have written. Each one mirrors the badge above (or the shelf
// note dot on the active tab), so the existing badge wins on every tab.
const badgedTabs = new Set<number>();
const SHELF_NOTE_BADGE: Badge = { text: "•", color: SHELF_INK_COLOR };

async function showPermissionBadge(state: NonNullable<LinkQueueState["permission"]>) {
  permissionBadgeOn = true;
  const text = state.count > 9 ? "9+" : String(state.count);
  await browser.action.setBadgeBackgroundColor({ color: PERMISSION_COLOR });
  await browser.action.setBadgeText({ text });
  await browser.action.setTitle({ title: permissionBannerText(state.count, state.hosts) });
  shownBadge = { text, color: PERMISSION_COLOR };
  void applyShelfBadges();
}

async function clearPermissionBadge() {
  if (!permissionBadgeOn) return;
  permissionBadgeOn = false;
  await browser.action.setBadgeText({ text: "" });
  await browser.action.setTitle({ title: "Sourcefold" });
  shownBadge = null;
  void applyShelfBadges();
}

async function showSuccessBadge() {
  await browser.action.setBadgeBackgroundColor({ color: SUCCESS_COLOR });
  await browser.action.setBadgeText({ text: "✓" });
  await browser.action.setTitle({ title: "Sourcefold" });
  await browser.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 3000 });
  shownBadge = { text: "✓", color: SUCCESS_COLOR };
  void applyShelfBadges();
}

async function showErrorBadge(title: string) {
  await browser.action.setBadgeBackgroundColor({ color: ERROR_COLOR });
  await browser.action.setBadgeText({ text: "!" });
  await browser.action.setTitle({ title });
  await browser.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 8000 });
  shownBadge = { text: "!", color: ERROR_COLOR };
  void applyShelfBadges();
}

async function paintTab(tabId: number, badge: Badge | null) {
  badgedTabs.add(tabId);
  await browser.action.setBadgeBackgroundColor({ tabId, color: badge?.color ?? SUCCESS_COLOR });
  await browser.action.setBadgeText({ tabId, text: badge?.text ?? "" });
}

/**
 * Shows the shelf note dot on the active tab: a dot when its page is on the shelf with a note.
 * Reads the cache only. If an existing badge is showing, every tab we have written shows that
 * badge instead, so the shelf never hides it.
 */
async function applyShelfBadges(tabId?: number, url?: string): Promise<void> {
  if (shownBadge) {
    for (const id of [...badgedTabs]) {
      await paintTab(id, shownBadge).catch(() => badgedTabs.delete(id));
    }
    return;
  }

  if (tabId === undefined) {
    const [active] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = active?.id;
    url = active?.url;
  } else if (url === undefined) {
    url = (await browser.tabs.get(tabId).catch(() => undefined))?.url;
  }
  if (tabId === undefined) return;

  const link = url ? await findShelfLink(url).catch(() => undefined) : undefined;
  const hasNote = Boolean(link?.note.trim());

  for (const id of [...badgedTabs]) {
    if (id !== tabId) await paintTab(id, null).catch(() => badgedTabs.delete(id));
  }
  await paintTab(tabId, hasNote ? SHELF_NOTE_BADGE : null).catch(() => badgedTabs.delete(tabId));
}

export default defineBackground(() => {
  // The popup and options page save and sign in through here (lib/account-channel.ts).
  serveAccountChannel({
    resolveTarget: (forceRefresh) => resolveAccountTarget(forceRefresh),
    fetch: accountFetch,
    status: accountStatus,
    signIn: async () => {
      const status = await signIn();
      await showSuccessBadge().catch(() => {});
      return status;
    },
    signOut: async () => {
      await signOut();
      await clearShelfIndex().catch(() => {});
    },
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("supabaseConfig" in changes) resetAccountClients();
    else if ("connectionMode" in changes) invalidateTargetCache();
    if ("connectionMode" in changes) void clearShelfIndex().catch(() => {});
    if (SHELF_INDEX_KEY in changes) void applyShelfBadges();
  });

  const linkQueue = createExtensionLinkQueue({
    onState: async (state) => {
      if (state.permission && state.permission.count > 0)
        await showPermissionBadge(state.permission);
      else await clearPermissionBadge();
    },
  });
  listenForLinkQueue(linkQueue);
  void browser.alarms.create(LINK_QUEUE_ALARM, { periodInMinutes: 1 });
  void linkQueue.run();

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === BADGE_CLEAR_ALARM) {
      const state = await readLinkQueueState().catch(() => null);
      if (state?.permission && state.permission.count > 0) {
        await showPermissionBadge(state.permission);
        return;
      }
      permissionBadgeOn = false;
      shownBadge = null;
      await browser.action.setBadgeText({ text: "" });
      await browser.action.setTitle({ title: "Sourcefold" });
      void applyShelfBadges();
      return;
    }
    if (alarm.name === LINK_QUEUE_ALARM) await linkQueue.run();
  });

  // The shelf badge: looked up from the cache on every tab change. The network is only used by
  // refreshShelfIndex, which runs at most every five minutes.
  browser.tabs.onActivated.addListener(({ tabId }) => {
    void applyShelfBadges(tabId);
    void refreshShelfIndex().catch(() => {});
  });
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && tab.active) void applyShelfBadges(tabId, changeInfo.url);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    badgedTabs.delete(tabId);
  });

  browser.runtime.onStartup.addListener(() => {
    void linkQueue.run();
    void applyShelfBadges();
    void refreshShelfIndex().catch(() => {});
  });

  browser.runtime.onInstalled.addListener(async () => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: "save-link",
      title: "Save link to Sourcefold",
      contexts: ["link"],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === "save-link" && info.linkUrl) {
      const source = detectSource(info.linkUrl);

      if (source === "grokipedia") {
        const lastFolderId = await getLastFolderId();
        if (!lastFolderId) {
          await showErrorBadge("Choose a group in the popup first");
          return;
        }

        const target = await resolveAccountTarget();
        if (target.type === "signed-out" || target.type === "error") {
          await showErrorBadge(target.displayLabel);
          return;
        }

        try {
          await saveGrokipedia(info.linkUrl, lastFolderId);
          await showSuccessBadge();
        } catch (err: unknown) {
          const isFolderMissing =
            err instanceof ApiError &&
            (err.code === "invalid_folder" ||
              err.status === 404 ||
              (err.status === 400 && err.message.toLowerCase().includes("group")));

          if (isFolderMissing) {
            await clearLastFolderId();
            await showErrorBadge("Choose a group in the popup first");
            return;
          }

          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to save link.";
          await showErrorBadge(message);
        }
      } else {
        await showErrorBadge("Open the page first, then save it from the popup.");
      }
    }
  });

  void applyShelfBadges();
});
