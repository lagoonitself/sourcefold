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

const SUCCESS_COLOR = "#1F5E4E";
const ERROR_COLOR = "#B42318";
const PERMISSION_COLOR = "#B54708";
const BADGE_CLEAR_ALARM = "sourcefold-clear-badge";
const LINK_QUEUE_ALARM = "sourcefold-link-queue";

let permissionBadgeOn = false;

async function showPermissionBadge(state: NonNullable<LinkQueueState["permission"]>) {
  permissionBadgeOn = true;
  const text = state.count > 9 ? "9+" : String(state.count);
  await browser.action.setBadgeBackgroundColor({ color: PERMISSION_COLOR });
  await browser.action.setBadgeText({ text });
  await browser.action.setTitle({ title: permissionBannerText(state.count, state.hosts) });
}

async function clearPermissionBadge() {
  if (!permissionBadgeOn) return;
  permissionBadgeOn = false;
  await browser.action.setBadgeText({ text: "" });
  await browser.action.setTitle({ title: "Sourcefold" });
}

async function showSuccessBadge() {
  await browser.action.setBadgeBackgroundColor({ color: SUCCESS_COLOR });
  await browser.action.setBadgeText({ text: "\u2713" });
  await browser.action.setTitle({ title: "Sourcefold" });
  await browser.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 3000 });
}

async function showErrorBadge(title: string) {
  await browser.action.setBadgeBackgroundColor({ color: ERROR_COLOR });
  await browser.action.setBadgeText({ text: "!" });
  await browser.action.setTitle({ title });
  await browser.alarms.create(BADGE_CLEAR_ALARM, { when: Date.now() + 8000 });
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
    signOut,
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("supabaseConfig" in changes) resetAccountClients();
    else if ("connectionMode" in changes) invalidateTargetCache();
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
      await browser.action.setBadgeText({ text: "" });
      await browser.action.setTitle({ title: "Sourcefold" });
      return;
    }
    if (alarm.name === LINK_QUEUE_ALARM) await linkQueue.run();
  });

  browser.runtime.onStartup.addListener(() => {
    void linkQueue.run();
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
});
