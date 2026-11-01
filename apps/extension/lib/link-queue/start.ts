import { browser } from "wxt/browser";
import { resolveAccountTarget } from "../account";
import { capturePage } from "../capture-page";
import { isDesktopReachable } from "../target";
import {
  closeLeftoverQueueTab,
  closeQueueTab,
  openQueueTab,
  tabNeedsSignIn,
  waitForQueueTab,
} from "./browser-tab";
import { isLinkQueueMessage } from "./messages";
import { claimBrowserRow, listLinkQueue, patchLinkQueue } from "./queue-api";
import { saveQueuePage } from "./save-page";
import { extensionWorkerId, readLinkQueueState, writeLinkQueueState } from "./state";
import type { LinkQueueState } from "./types";
import { createLinkQueueController, type LinkQueueController } from "./worker";

const TIMEOUT_MS = 45_000;
const PACE_MS = 3_000;
const POLL_MS = 1_500;

export function createExtensionLinkQueue(options?: {
  onState?: (state: LinkQueueState) => Promise<void> | void;
}): LinkQueueController {
  void closeLeftoverQueueTab().catch(() => {});
  return createLinkQueueController({
    signedIn: async () => (await resolveAccountTarget()).type === "account",
    desktopReachable: () => isDesktopReachable(),
    workerId: extensionWorkerId,
    api: {
      claim: claimBrowserRow,
      patch: patchLinkQueue,
      listOpen: () => listLinkQueue("open"),
      listRecent: () => listLinkQueue("recent"),
    },
    permissionsContains: (origins) => browser.permissions.contains({ origins }),
    openTab: openQueueTab,
    closeTab: closeQueueTab,
    waitForLoad: waitForQueueTab,
    capture: capturePage,
    needsSignIn: tabNeedsSignIn,
    save: (url, folderId, captured) => saveQueuePage(url, folderId, captured),
    readState: readLinkQueueState,
    writeState: async (state) => {
      await writeLinkQueueState(state);
      await options?.onState?.(state);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs: TIMEOUT_MS,
    paceMs: PACE_MS,
    pollMs: POLL_MS,
  });
}

export function listenForLinkQueue(controller: LinkQueueController): void {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isLinkQueueMessage(message)) return;
    if (message.op === "retry") void controller.retryFailed();
    else void controller.run();
    sendResponse({ ok: true });
  });
}
