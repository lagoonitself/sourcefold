export type GrokipediaErrorCode =
  | "invalid_url"
  | "not_grokipedia"
  | "duplicate"
  | "not_found"
  | "fetch_failed"
  | "parse_failed"
  | "invalid_folder"
  | "unknown";

export const GROKIPEDIA_ERROR_MESSAGES = {
  invalid_url: "That isn't a valid link.",
  not_grokipedia: "That isn't a Grokipedia article link.",
  duplicate: "Already saved in another folder.",
  not_found: "That Grokipedia article doesn't exist.",
  fetch_failed: "Couldn't reach Grokipedia. Check the link and try again.",
  parse_failed: "This page doesn't look like a Grokipedia article.",
  invalid_folder: "That folder no longer exists.",
  unknown: "An unexpected error occurred.",
} as const satisfies Record<GrokipediaErrorCode, string>;

export function formatDuplicateMessage(folderName: string): string {
  return `Already saved in "${folderName}".`;
}

export interface GrokipediaErrorPayload {
  code: GrokipediaErrorCode;
  message: string;
}

export interface GrokipediaDuplicateErrorPayload extends GrokipediaErrorPayload {
  code: "duplicate";
  item_id: string;
  folder_id: string;
  folder_name: string;
}
