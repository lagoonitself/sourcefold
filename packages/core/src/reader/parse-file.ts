/**
 * Splits a Sourcefold file (docs/FILE-FORMAT.md) into the parts the reader shows:
 *
 *   ---
 *   front matter
 *   ---
 *
 *   # Title
 *   *subtitle*            (Substack only)
 *   > Saved from ...      (source line, not on notes)
 *   body
 *   ## My summary        (written from the database; never part of the body)
 *   ## My highlights     (written from the database; never part of the body)
 *   ## My note
 *   the user's note
 *
 * Text without front matter (a note kept as plain body) is returned as the body unchanged.
 */

export interface ParsedReaderFile {
  frontMatter: Record<string, string>;
  hasFrontMatter: boolean;
  title: string | null;
  subtitle: string | null;
  sourceLine: string | null;
  body: string;
  note: string | null;
}

const FRONT_MATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/;
const KEY_LINE = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*)|[ \t]*)$/;
const LIST_ITEM = /^[ \t]+-[ \t]+(.*)$/;
const NOTE_HEADING = "\n## My note\n";
const HIGHLIGHTS_HEADING = "\n## My highlights\n";
const SUMMARY_HEADING = "\n## My summary\n";
const SOURCE_LINE = /^>\s?Saved from /;

/** Decodes one YAML scalar as buildFrontMatter writes it: plain, "double quoted" or 'single'. */
export function parseYamlScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    // buildFrontMatter escapes with JSON rules (\\ \" \n \t \uXXXX), so JSON can read it back.
    const end = closingDoubleQuote(value);
    if (end !== -1) {
      try {
        return JSON.parse(value.slice(0, end + 1)) as string;
      } catch {
        return value.slice(1, end);
      }
    }
    return value.slice(1);
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function closingDoubleQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === "\\") i++;
    else if (value[i] === '"') return i;
  }
  return -1;
}

/** Reads `key: value` lines (and `key:` followed by `  - item` lines, joined with ", "). */
function parseFrontMatterBlock(block: string): Record<string, string> | null {
  const fields: Record<string, string> = {};
  let listKey: string | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (listKey !== null && listItems.length > 0) fields[listKey] = listItems.join(", ");
    listKey = null;
    listItems = [];
  };

  for (const line of block.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const item = LIST_ITEM.exec(line);
    if (item && listKey !== null) {
      listItems.push(parseYamlScalar(item[1] ?? ""));
      continue;
    }

    const key = KEY_LINE.exec(line);
    if (!key) return null;
    flushList();
    const value = key[2];
    if (value === undefined || value.trim() === "") {
      listKey = key[1] ?? null;
    } else {
      fields[key[1] ?? ""] = parseYamlScalar(value);
    }
  }
  flushList();
  return fields;
}

export function parseReaderFile(text: string): ParsedReaderFile {
  const normalized = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");

  let frontMatter: Record<string, string> = {};
  let hasFrontMatter = false;
  let rest = normalized;

  const match = FRONT_MATTER.exec(normalized);
  if (match) {
    // A leading "---" rule in a plain note must not be mistaken for front matter.
    const fields = parseFrontMatterBlock(match[1] ?? "");
    if (fields) {
      frontMatter = fields;
      hasFrontMatter = true;
      rest = normalized.slice(match[0].length);
    }
  }

  const lines = rest.split("\n");
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && (lines[i] ?? "").trim() === "") i++;
  };
  skipBlank();

  let title: string | null = null;
  let subtitle: string | null = null;
  let sourceLine: string | null = null;

  if (hasFrontMatter) {
    if (/^# /.test(lines[i] ?? "")) {
      title = (lines[i] ?? "").slice(2).trim();
      i++;
      skipBlank();
    }

    // *subtitle* only counts as one when the file says so: the front matter has a subtitle, or
    // the source line follows. Otherwise it is the first line of the body.
    const italic = /^\*(?!\*)(.+)\*$/.exec((lines[i] ?? "").trim());
    if (italic) {
      let next = i + 1;
      while (next < lines.length && (lines[next] ?? "").trim() === "") next++;
      const sourceFollows = SOURCE_LINE.test(lines[next] ?? "");
      if (sourceFollows || frontMatter.subtitle === italic[1]) {
        subtitle = italic[1] ?? null;
        i = next;
      }
    }

    if (SOURCE_LINE.test(lines[i] ?? "")) {
      sourceLine = (lines[i] ?? "").replace(/^>\s?/, "").trim();
      i++;
    }
  }

  // Split the body from the trailing "## My note" section, like bodyFromDriveFile does.
  const padded = `\n${lines.slice(i).join("\n").trimEnd()}\n`;
  const noteStart = padded.lastIndexOf(NOTE_HEADING);
  let bodyText = padded;
  let note: string | null = null;
  if (noteStart !== -1) {
    bodyText = padded.slice(0, noteStart);
    note = padded.slice(noteStart + NOTE_HEADING.length).trim() || null;
  }

  // The highlights section sits between the body and the note. It is cut off here so it is never
  // shown as text and highlight offsets only count the body.
  const highlightsStart = bodyText.lastIndexOf(HIGHLIGHTS_HEADING);
  if (highlightsStart !== -1) bodyText = bodyText.slice(0, highlightsStart);

  // The summary sits between the body and the highlights, cut off the same way.
  const summaryStart = bodyText.lastIndexOf(SUMMARY_HEADING);
  if (summaryStart !== -1) bodyText = bodyText.slice(0, summaryStart);

  return {
    frontMatter,
    hasFrontMatter,
    title,
    subtitle,
    sourceLine,
    body: bodyText.replace(/^\n+/, "").trimEnd(),
    note,
  };
}
