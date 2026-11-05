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

export interface StoredContent {
  sha256: string;
  bytes: number;
}

/** Where article text and uploaded images live (Cloudflare R2, through the content Worker). */
export interface ContentStore {
  /** The text, or null when the store has none. */
  getText(itemId: string): Promise<string | null>;
  putText(itemId: string, body: string): Promise<StoredContent>;
  /** The uploaded image, or null when the store has none. */
  getFile(itemId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  putFile(itemId: string, bytes: Uint8Array, mimeType: string): Promise<StoredContent>;
}

export interface Host {
  drive: DriveAccess;
  /** The content store; null when no Worker is configured (Drive stays the store). */
  content: ContentStore | null;
  /**
   * Moves new text to R2 and, if the Drive backup is on, to Drive, a few seconds from now; never
   * two pushes at once.
   */
  scheduleDrivePush(userId: string): void;
  fetchUrl: FetchUrl;
  /** Parses an HTML page (website: linkedom; desktop and extension: DOMParser). */
  parseHtml(html: string): Document;
}
