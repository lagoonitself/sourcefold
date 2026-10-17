import * as React from "react";
import { parseReaderFile } from "./parse-file";
import { renderMarkdown } from "./render-markdown";
import type { ReaderContent } from "./types";

/** The file's text split into parts and rendered; null text gives an empty result at no cost. */
export function useReaderContent(text: string | null): ReaderContent {
  const parsed = React.useMemo(() => (text === null ? null : parseReaderFile(text)), [text]);
  const body = parsed?.body ?? "";
  const note = parsed?.note ?? null;
  const bodyHtml = React.useMemo(() => (body.trim() ? renderMarkdown(body) : ""), [body]);
  const noteHtml = React.useMemo(() => (note ? renderMarkdown(note) : ""), [note]);
  return React.useMemo(() => ({ parsed, bodyHtml, noteHtml }), [parsed, bodyHtml, noteHtml]);
}
