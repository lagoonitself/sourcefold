import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { FetchUrl } from "./host";

export type { Database } from "./database.types";

export interface ClientConfig {
  supabaseUrl: string;
  /** The project's publishable key (`sb_publishable_…`); public by design. */
  supabasePublishableKey: string;
}

export type SourcefoldSupabase = SupabaseClient<Database>;

export interface LocalApiDeps {
  /** Signed in; RLS applies. */
  supabase: SourcefoldSupabase;
  /** Fetches links people give us (desktop: Rust `web_fetch`; extension: background fetch). */
  fetchUrl: FetchUrl;
  /** Parses an HTML page; `DOMParser` in a webview or an extension. */
  parseHtml(html: string): Document;
  /** Called after anything that changes items or folders. */
  onItemsChanged?(): void;
  /**
   * The signed-in user, for a client made with supabase-js's `accessToken` option (the extension
   * borrowing the desktop app's token), whose `auth` can't be used. Default: the client's session.
   */
  currentUserId?(): Promise<string | null>;
}

export interface LocalApi {
  /** Answers exactly what the website's `/api/...` route answers. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

export type LinkQueueNeeds = "desktop" | "browser";
export type LinkQueueStatus =
  "waiting" | "working" | "saved" | "duplicate" | "unavailable" | "failed" | "cancelled";

export interface LinkQueueRow {
  id: string;
  folder_id: string;
  url: string;
  kind: string | null;
  needs: LinkQueueNeeds;
  status: LinkQueueStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  message: string | null;
  title: string | null;
  item_id: string | null;
  added_by: string;
  created_at: string;
  updated_at: string;
}

/** Error codes the Edge Function and Drive code use. */
export type DriveErrorCode = "drive_reconnect" | "drive_client_mismatch";
