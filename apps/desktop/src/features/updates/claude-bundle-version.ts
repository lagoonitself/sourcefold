/**
 * Claude Desktop keeps its own copy of the Sourcefold extension (`Sourcefold-Claude.mcpb`), so an
 * app update doesn't reach Claude by itself. The bundle's version follows the app's, so we
 * remember which app version last opened the bundle in Claude's install window, and offer to
 * update Claude's copy when the app has moved on. Nothing is offered to people who never added it.
 */

const KEY = "sourcefold.claudeBundleVersion";

export function rememberClaudeBundleVersion(version: string | null): void {
  if (!version) return;
  try {
    localStorage.setItem(KEY, version);
  } catch {
    // Storage unavailable: the reminder just won't show.
  }
}

export function installedClaudeBundleVersion(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** True when Claude Desktop has an older Sourcefold extension than this app ships. */
export function claudeBundleOutdated(appVersion: string | null, installed: string | null): boolean {
  return Boolean(appVersion && installed && installed !== appVersion);
}
