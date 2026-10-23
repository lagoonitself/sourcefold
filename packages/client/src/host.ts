// What the shared API code needs from whoever runs it. The website provides it from its server
// code (apps/web/src/lib/web-host.ts); the desktop app and the extension provide it from the
// `google-access-token` Edge Function and their own fetch. Contract: docs/dev/handoff-no-website.md.

export interface DriveAccess {
  /** A Google access token with `drive.file` for this user. */
  getAccessToken(userId: string): Promise<string>;
  /** Forgets a cached token after Drive refused it. */
  clearAccessToken(userId: string): void;
  /** Whether this user has connected Google Drive (a refresh token is on file). */
  isConnected(userId: string): Promise<boolean>;
}

/**
 * Fetches a link a person gave us (a source page, an image inside a post). The website refuses
 * private addresses (`publicFetch`); the desktop app and the extension run on the person's own
 * computer and fetch without the browser's CORS limits.
 */
export type FetchUrl = (url: string, init?: RequestInit) => Promise<Response>;

export interface Host {
  drive: DriveAccess;
  /** Pushes changes to Drive a few seconds from now; never two pushes at once. */
  scheduleDrivePush(userId: string): void;
  fetchUrl: FetchUrl;
  /** Parses an HTML page (website: linkedom; desktop and extension: DOMParser). */
  parseHtml(html: string): Document;
}
