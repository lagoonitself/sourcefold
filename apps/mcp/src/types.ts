// Shapes the web API and the desktop bridge answer with. Only the fields the tools read are typed;
// the web app may send more.

export type {
  AuthorType,
  Card,
  CardInput,
  CardKind,
  CardPatch,
  Highlight,
  HighlightCitation,
  HighlightInput,
  OutlineSection,
  OutlineSectionInput,
  Triage,
} from "@sourcefold/core";

import type { AuthorType, Triage } from "@sourcefold/core";

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  archived_at?: string | null;
  /** What `GET /api/folders` sends for a project. */
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
  item_count?: number | null;
}

export interface Item {
  id: string;
  folder_id: string;
  kind: string;
  title: string;
  source_url: string | null;
  canonical_url?: string | null;
  status: string;
  error?: string | null;
  meta: Record<string, unknown> | null;
  note?: string | null;
  position?: number;
  created_at: string;
  updated_at?: string;
  triage?: Triage | null;
  tags?: string[];
  summary?: string | null;
  author?: string | null;
  author_type?: AuthorType | null;
}

/** `GET /api/agent/status` on the desktop app. */
export interface DesktopStatus {
  version: string;
  mode: "signed_in" | "offline" | "signed_out";
  web_url: string | null;
  email: string | null;
}

/** The desktop's search index answer (`apps/desktop/src/features/search/search-api.ts`). */
export interface PassageHit {
  item_id: string;
  project_id: string;
  folder_id: string;
  title: string;
  kind: string;
  url: string | null;
  /** Headings above the passage, joined with " › ". Empty when there is none. */
  heading: string;
  /** Matched words are wrapped as `\u0002word\u0003`. */
  snippet: string;
  passage_start: string;
  seconds: number | null;
  matched: "keyword" | "meaning" | "both";
  score: number;
}

export interface NoteHit {
  item_id: string;
  project_id: string;
  folder_id: string;
  title: string;
  kind: string;
  url: string | null;
  source: "highlight" | "note";
  snippet: string;
  passage_start: string;
  seconds: number | null;
  matched: "keyword" | "meaning" | "both";
  score: number;
}

export interface SearchResponse {
  passages: PassageHit[];
  notes: NoteHit[];
  meaning: "used" | "off";
  took_ms: number;
}

export interface DesktopSearchRequest {
  query: string;
  scope: "project" | "all";
  project_id: string | null;
  limit?: number;
}

/** What `show_in_app` asks the desktop app to open. */
export type ShowTarget =
  { group_id: string } | { source_id: string } | { source_id: string; highlight_id: string };

/** `substack::fetch` in the desktop app. */
export interface SubstackFetchResult {
  status: number;
  url: string;
  text: string;
  retry_after: number | null;
  cookie_sent: boolean;
}
