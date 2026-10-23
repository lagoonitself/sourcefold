import "server-only";
import type { Host } from "@sourcefold/client";
import { parseHtmlOnServer } from "@sourcefold/core/server";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";
import { webDriveAccess, webFetchUrl } from "@/lib/web-drive";

/** What the shared API code (packages/client) gets on the website. */
export const webHost: Host = {
  drive: webDriveAccess,
  scheduleDrivePush: (userId) => pushToDriveSoon(userId),
  fetchUrl: webFetchUrl,
  parseHtml: parseHtmlOnServer,
};
