// Short-id cache and resolution for MCP tools.
// Allows models to refer to sources and groups by short (>=6 hex chars) prefixes.

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const FULL_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REMEMBERED_IDS = 50_000;

const remembered = new Set<string>();

/** Adds a single full id to the short-id cache. */
export function rememberId(id: string): void {
  const normalized = id.trim().toLowerCase();
  if (!normalized) return;
  if (remembered.has(normalized)) return;
  while (remembered.size >= MAX_REMEMBERED_IDS) {
    const oldest = remembered.values().next().value;
    if (!oldest) break;
    remembered.delete(oldest);
  }
  remembered.add(normalized);
}

/** Finds every UUID in the text and adds it to the short-id cache. */
export function rememberIds(text: string): void {
  const matches = text.match(UUID_REGEX);
  if (!matches) return;
  for (const match of matches) {
    rememberId(match);
  }
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

/** Resolves an input id: full UUIDs as-is, short prefixes to remembered ids, others unchanged. */
export function resolveId(input: string): string {
  const trimmed = input.trim();
  if (FULL_UUID_REGEX.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const lower = trimmed.toLowerCase();
  if (isUuidPrefix(lower)) {
    const matches: string[] = [];
    for (const id of remembered) {
      if (id.startsWith(lower)) {
        matches.push(id);
      }
    }
    if (matches.length === 1) {
      return matches[0]!;
    }
    if (matches.length === 0) {
      throw new Error(
        `No source or group id starting "${trimmed}" has been shown yet. Use the full id from list_sources or get_project_tree.`,
      );
    }
    throw new Error(
      `"${trimmed}" matches ${matches.length} ids. Use more characters or the full id.`,
    );
  }

  return input;
}

/** Clears remembered ids (for testing). */
export function clearRememberedIds(): void {
  remembered.clear();
}
