export type FrontMatterValue = string | number | boolean | null | undefined | string[];

const KEYWORD_TYPES = new Set(["true", "false", "yes", "no", "null", "~", "on", "off", "y", "n"]);

const DISALLOWED_START_CHARS = /^[-?:,[\]{}#&*!|>'\"%@`]/;
const NUMBER_REGEX =
  /^[+-]?(?:0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

function shouldQuoteString(str: string): boolean {
  if (str === "") {
    return true;
  }

  // 1. contains ": " or " #"
  if (str.includes(": ") || str.includes(" #")) {
    return true;
  }

  // 2. starts with any of -?:,[]{}#&*!|>'\"%@ or a backtick
  if (DISALLOWED_START_CHARS.test(str)) {
    return true;
  }

  // 3. has leading/trailing spaces
  if (str.startsWith(" ") || str.endsWith(" ")) {
    return true;
  }

  // 4. contains a newline, tab, or Unicode line separator
  if (
    str.includes("\n") ||
    str.includes("\r") ||
    str.includes("\t") ||
    str.includes("\u2028") ||
    str.includes("\u2029")
  ) {
    return true;
  }

  // 5. ends with ":"
  if (str.endsWith(":")) {
    return true;
  }

  // 6. would be read as another type (true, false, yes, no, null, ~, or a number like 12, 1.5, 1e3), case-insensitive
  const lower = str.toLowerCase();
  if (KEYWORD_TYPES.has(lower)) {
    return true;
  }

  if (NUMBER_REGEX.test(str)) {
    return true;
  }

  return false;
}

function escapeAndQuoteString(str: string): string {
  const escaped = str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `"${escaped}"`;
}

function formatStringValue(value: string): string {
  if (shouldQuoteString(value)) {
    return escapeAndQuoteString(value);
  }
  return value;
}

export function buildFrontMatter(fields: Record<string, FrontMatterValue>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    // Skip null, undefined, empty strings and empty arrays
    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${formatStringValue(item)}`);
      }
      continue;
    }

    if (typeof value === "number") {
      lines.push(`${key}: ${value}`);
      continue;
    }

    if (typeof value === "boolean") {
      lines.push(`${key}: ${value ? "true" : "false"}`);
      continue;
    }

    if (typeof value === "string") {
      lines.push(`${key}: ${formatStringValue(value)}`);
      continue;
    }
  }

  const content = lines.length > 0 ? lines.join("\n") + "\n" : "";
  return `---\n${content}---\n`;
}

export function formatDate(value: Date | string): string {
  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(`Invalid date: "${value}"`);
    }
    date = new Date(trimmed);
  } else {
    throw new Error("Invalid date input");
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${String(value)}"`);
  }

  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
