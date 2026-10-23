import { browser } from "wxt/browser";
import { isLocalUrl } from "./settings";
import type { ResolvedTarget } from "./target";

/** The host (with port) of a web app address, for messages shown to the user. */
export function hostOf(urlStr: string): string {
  try {
    return new URL(urlStr).host;
  } catch {
    return urlStr;
  }
}

/**
 * Checks whether the extension has permission to access the given URL origin.
 * Loopback origins (localhost, 127.0.0.1) are already declared in host_permissions
 * and always return true.
 */
export async function hasHostPermission(urlStr: string): Promise<boolean> {
  if (isLocalUrl(urlStr)) {
    return true;
  }

  try {
    const parsed = new URL(urlStr);
    const origin = parsed.origin;

    const perms =
      (globalThis as any)?.browser?.permissions || (globalThis as any)?.chrome?.permissions;

    if (!perms?.contains) {
      return true;
    }

    return await perms.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/**
 * Prompts the user to grant permission to access the given URL origin.
 * Must be called from a user gesture (e.g. click handler).
 */
export async function requestHostPermission(urlStr: string): Promise<boolean> {
  if (isLocalUrl(urlStr)) {
    return true;
  }

  try {
    const parsed = new URL(urlStr);
    const origin = parsed.origin;

    const perms =
      (globalThis as any)?.browser?.permissions || (globalThis as any)?.chrome?.permissions;

    if (!perms?.request) {
      return true;
    }

    const granted = await perms.request({ origins: [`${origin}/*`] });
    return Boolean(granted);
  } catch {
    return false;
  }
}

/**
 * Saving to a web app needs host access that only the popup can request (it needs a click).
 * Returns the message to show when that access is missing, or null when saving can proceed.
 */
export async function missingHostPermissionMessage(target: ResolvedTarget): Promise<string | null> {
  if (target.type !== "desktop-web" && target.type !== "web") {
    return null;
  }
  if (await hasHostPermission(target.webUrl)) {
    return null;
  }
  return `Open the popup and click "Allow access to ${hostOf(target.webUrl)}" to save from here.`;
}
