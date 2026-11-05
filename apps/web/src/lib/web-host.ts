import "server-only";
import type { Host } from "@sourcefold/client";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";
import { webContentStore, webDriveAccess, webFetchUrl } from "@/lib/web-drive";

/** What the shared API code (packages/client) gets on the website. */
export const webHost: Host = {
  drive: webDriveAccess,
  // Read per use, not at import: the value comes from the environment.
  get content() {
    return webContentStore();
  },
  scheduleDrivePush: (userId) => pushToDriveSoon(userId),
  fetchUrl: webFetchUrl,
  parseHtml: parseHtmlOnServer,
};
