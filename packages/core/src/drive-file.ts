const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const NOTE_HEADING = "\n## My note\n";

// Recovers the Markdown body from a file Sourcefold wrote to Drive: drops the front matter
// and the trailing "## My note" section, which are rebuilt from the database on every save.
export function bodyFromDriveFile(fileText: string): string {
  let body = fileText.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  body = body.replace(FRONT_MATTER, "");

  const noteStart = body.lastIndexOf(NOTE_HEADING);
  if (noteStart !== -1) {
    body = body.slice(0, noteStart);
  }

  return body.replace(/^\n+/, "").trimEnd() + "\n";
}
