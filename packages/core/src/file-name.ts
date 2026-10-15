const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Implements "Names" rules 1–6 from docs/FILE-FORMAT.md:
 * 1. Start from the title or folder name.
 * 2. Replace `:` with ` -`, and replace `/ \ | ` with `-`.
 * 3. Remove `< > " ? *` and control characters.
 * 4. Collapse runs of whitespace to one space; trim spaces and dots from both ends.
 * 5. Cut to 100 characters at the last word break and trim again.
 * 6. Empty result: `Untitled`. A Windows reserved name (`CON`, `PRN`, `AUX`, `NUL`,
 *    `COM1`–`COM9`, `LPT1`–`LPT9`, any case): append ` (file)`.
 */
export function safeName(name: string): string {
  if (typeof name !== "string") {
    return "Untitled";
  }

  // 2. Replace `:` with ` -`, and replace `/ \ | ` with `-`
  let s = name.replace(/:/g, " -").replace(/[/\\|]/g, "-");

  // 3. Remove `< > " ? *` and control characters (C0 and C1)
  s = s.replace(/[<>"?*]|[\u0000-\u001f\u007f-\u009f]/g, "");

  // 4. Collapse runs of whitespace to one space; trim spaces and dots from both ends
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^[ .]+|[ .]+$/g, "");

  // 5. Cut to 100 characters at the last word break and trim again
  const chars = Array.from(s);
  if (chars.length > 100) {
    if (chars[100] === " ") {
      s = chars
        .slice(0, 100)
        .join("")
        .replace(/^[ .]+|[ .]+$/g, "");
    } else {
      const truncated = chars.slice(0, 100).join("");
      const lastSpace = truncated.lastIndexOf(" ");
      if (lastSpace > 0) {
        s = truncated.slice(0, lastSpace).replace(/^[ .]+|[ .]+$/g, "");
      } else {
        s = truncated.replace(/^[ .]+|[ .]+$/g, "");
      }
    }
  }

  // 6. Empty result: `Untitled`. A Windows reserved name: append ` (file)`
  if (!s) {
    return "Untitled";
  }

  if (WINDOWS_RESERVED.test(s)) {
    return `${s} (file)`;
  }

  return s;
}

export interface UniqueNameEntry {
  id: string;
  name: string;
  createdAt: string | Date | number;
}

/**
 * Implements "Names" rule 7 from docs/FILE-FORMAT.md:
 * Two items in one folder with the same name (compared case-insensitively):
 * the older one keeps the plain name, later ones get ` (2)`, ` (3)` in creation order.
 * Ordered by createdAt ascending, then id ascending for tie-breaks.
 */
export function uniqueNames(entries: UniqueNameEntry[]): Map<string, string> {
  const result = new Map<string, string>();

  // Group by case-insensitive name
  const groups = new Map<string, UniqueNameEntry[]>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const group = groups.get(key);
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      const single = group[0]!;
      result.set(single.id, single.name);
      continue;
    }

    // Sort by createdAt (oldest first), then by id ascending
    const sorted = [...group].sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      const validA = !Number.isNaN(timeA);
      const validB = !Number.isNaN(timeB);

      if (validA && validB && timeA !== timeB) {
        return timeA - timeB;
      }
      if (validA && !validB) return -1;
      if (!validA && validB) return 1;

      return a.id.localeCompare(b.id);
    });

    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i]!;
      if (i === 0) {
        result.set(entry.id, entry.name);
      } else {
        result.set(entry.id, `${entry.name} (${i + 1})`);
      }
    }
  }

  return result;
}
