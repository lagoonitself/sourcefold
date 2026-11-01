// Each server context owns its own ids, so separate users never share prefix matches.

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const FULL_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REMEMBERED_IDS = 50_000;

export interface ShortIdStore {
  rememberId(id: string): void;
  rememberIds(text: string): void;
  resolveId(input: string): string;
  clear(): void;
}

/** Creates an id-prefix cache scoped to one ToolContext. */
export function createShortIdStore(): ShortIdStore {
  const remembered = new Set<string>();

  const rememberId = (id: string) => {
    const normalized = id.trim().toLowerCase();
    if (!normalized || remembered.has(normalized)) return;
    while (remembered.size >= MAX_REMEMBERED_IDS) {
      const oldest = remembered.values().next().value;
      if (!oldest) break;
      remembered.delete(oldest);
    }
    remembered.add(normalized);
  };

  return {
    rememberId,
    rememberIds(text) {
      const matches = text.match(UUID_REGEX);
      if (!matches) return;
      for (const match of matches) rememberId(match);
    },
    resolveId(input) {
      const trimmed = input.trim();
      if (FULL_UUID_REGEX.test(trimmed)) return trimmed.toLowerCase();

      const lower = trimmed.toLowerCase();
      if (!isUuidPrefix(lower)) return input;
      const matches = [...remembered].filter((id) => id.startsWith(lower));
      if (matches.length === 1) return matches[0]!;
      if (matches.length === 0) {
        throw new Error(
          `No source or group id starting "${trimmed}" has been shown yet. Use the full id from list_sources or get_project_tree.`,
        );
      }
      throw new Error(
        `"${trimmed}" matches ${matches.length} ids. Use more characters or the full id.`,
      );
    },
    clear: () => remembered.clear(),
  };
}

/** Checks whether a string is a valid prefix (>= 6 chars) of standard UUID format. */
function isUuidPrefix(s: string): boolean {
  if (s.length < 6 || s.length >= 36) return false;
  for (let i = 0; i < s.length; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      if (s[i] !== "-") return false;
    } else {
      const c = s.charCodeAt(i);
      const isHex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102);
      if (!isHex) return false;
    }
  }
  return true;
}
