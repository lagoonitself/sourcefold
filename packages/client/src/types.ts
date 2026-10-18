import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceFetch } from "@sourcefold/core";
import type { Database } from "./database.types";

export type { Database } from "./database.types";

export interface ClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

export type SourcefoldSupabase = SupabaseClient<Database>;

export interface LocalApiDeps {
  /** Signed in; RLS applies. */
  supabase: SourcefoldSupabase;
  /** A Google access token with `drive.file`, from the `google-access-token` Edge Function. */
  getDriveAccessToken(): Promise<string>;
  /** Fetches source pages (desktop: Rust `web_fetch`; extension: background fetch). */
  sourceFetch: SourceFetch;
  /** Fetches images to copy into Drive (browser CORS would block a plain fetch). */
  binaryFetch(url: string): Promise<{ bytes: Uint8Array; contentType: string | null }>;
  /** Called after anything that changes items or folders. */
  onItemsChanged?(): void;
}

export interface LocalApi {
  /** Answers exactly what the website's `/api/...` route answers today. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** Error codes the Edge Function and Drive code use. */
export type DriveErrorCode = "drive_reconnect" | "drive_client_mismatch";
