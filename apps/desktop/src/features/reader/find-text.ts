/**
 * Pure text logic for "find in this source" and for landing on a search hit
 * (docs/dev/handoff-search.md, "Reader"). Nothing here touches the DOM.
 *
 * The search index is built from Markdown, but the reader shows rendered text, so the two differ in
 * punctuation, footnote marks and (for YouTube) timestamps. Matching therefore works on words:
 * case, diacritics and punctuation are folded away, and every word keeps the offsets it had in the
 * original text so the caller can mark exactly that range.
 */

export interface TextRange {
  start: number;
  end: number;
}

/** One word of a text: `word` is the folded form, `start`/`end` are offsets in the original. */
export interface WordToken extends TextRange {
  word: string;
}

// A YouTube timestamp (0:47, 1:02:15) or a word, with inner apostrophes kept in the word.
const TOKEN_PATTERN =
  /(\d{1,2}:\d{2}(?::\d{2})?)(?![\p{L}\p{N}])|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function foldWord(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/['’]/g, "").toLowerCase();
}

/**
 * The words of `text` with their offsets. Timestamps ("0:47") and numeric footnote marks ("[76]")
 * are skipped: the index strips them from passages, the rendered text still has them.
 */
export function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  for (let m = TOKEN_PATTERN.exec(text); m; m = TOKEN_PATTERN.exec(text)) {
    if (m[1]) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (text[start - 1] === "[" && text[end] === "]" && /^\d+$/.test(m[0])) continue;
    const word = foldWord(m[0]);
    if (word) tokens.push({ word, start, end });
  }
  return tokens;
}

/**
 * Forms a word may reduce to when a plural, -ing or -ed ending is taken off, so "engines" finds
 * "engine" and "making" finds "make" (the index stems the same way). A word matches another when
 * the two share a form.
 */
export function stemForms(word: string): string[] {
  const forms = new Set<string>([word]);
  if (word.length > 3) {
    if (word.endsWith("ies")) forms.add(word.slice(0, -3) + "y");
    else if (/(?:ss|x|z|ch|sh)es$/.test(word)) forms.add(word.slice(0, -2));
    else if (word.endsWith("s") && !word.endsWith("ss")) forms.add(word.slice(0, -1));
  }
  const ending = word.endsWith("ing") ? 3 : word.endsWith("ed") ? 2 : 0;
  if (ending > 0 && word.length - ending >= 3) {
    const base = word.slice(0, -ending);
    forms.add(base);
    forms.add(base + "e");
    if (/([^aeiouls])\1$/.test(base)) forms.add(base.slice(0, -1));
  }
  return Array.from(forms);
}

export type QueryTerm =
  { kind: "word"; word: string; prefix: boolean } | { kind: "phrase"; words: string[] };

/**
 * Parses a search the way the index does: words, "exact phrases", and -excluded words (ignored
 * here, nothing is excluded from a page you are already reading). The last bare word matches as a
 * prefix because the index treats it that way while you type.
 */
export function parseFindQuery(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  let lastBare = -1;
  const pattern = /"([^"]*)"|(\S+)/g;
  for (let m = pattern.exec(query); m; m = pattern.exec(query)) {
    if (m[1] !== undefined) {
      const words = tokenize(m[1]).map((t) => t.word);
      if (words.length === 1) terms.push({ kind: "word", word: words[0], prefix: false });
      else if (words.length > 1) terms.push({ kind: "phrase", words });
      continue;
    }
    const raw = m[2];
    if (raw.startsWith("-") && raw.length > 1) continue;
    const words = tokenize(raw).map((t) => t.word);
    if (words.length === 0) continue;
    if (words.length === 1) {
      lastBare = terms.length;
      terms.push({ kind: "word", word: words[0], prefix: false });
    } else {
      terms.push({ kind: "phrase", words });
      lastBare = -1;
    }
  }
  const last = terms[lastBare];
  if (last && last.kind === "word") last.prefix = true;
  return terms;
}

function wordMatches(token: string, term: string, prefix: boolean): boolean {
  if (token === term) return true;
  if (prefix && token.startsWith(term)) return true;
  const termForms = stemForms(term);
  return stemForms(token).some((form) =>
    termForms.some((t) => form === t || (prefix && form.startsWith(t))),
  );
}

/** Every place the query's words and phrases occur in `text`, in order, without overlaps. */
export function findAllMatches(text: string, query: string): TextRange[] {
  const terms = parseFindQuery(query);
  if (terms.length === 0) return [];
  const tokens = tokenize(text);
  const found: TextRange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const term of terms) {
      if (term.kind === "word") {
        if (wordMatches(tokens[i].word, term.word, term.prefix)) {
          found.push({ start: tokens[i].start, end: tokens[i].end });
        }
      } else if (i + term.words.length <= tokens.length) {
        const last = term.words.length - 1;
        const same = term.words.every((w, k) => wordMatches(tokens[i + k].word, w, false));
        if (same) found.push({ start: tokens[i].start, end: tokens[i + last].end });
      }
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: TextRange[] = [];
  for (const range of found) {
    const prev = result[result.length - 1];
    if (prev && range.start < prev.end) continue;
    result.push(range);
  }
  return result;
}

/** How many words of a passage's start to try, longest first. */
export const PASSAGE_START_LENGTHS = [12, 8, 5];

export interface PassageLocation extends TextRange {
  /** "passage" when the opening words were found, "word" when only a query word was. */
  how: "passage" | "word";
}

/**
 * Where a search hit sits in the rendered text: its first 12 words, then 8, then 5 (a shorter start
 * is tried whole); failing that the first match of a query word.
 */
export function findPassage(
  text: string,
  passageStart: string,
  query: string,
): PassageLocation | null {
  const wanted = tokenize(passageStart).map((t) => t.word);
  const tokens = tokenize(text);
  const lengths = new Set<number>();
  for (const n of PASSAGE_START_LENGTHS) lengths.add(Math.min(n, wanted.length));
  for (const n of Array.from(lengths).sort((a, b) => b - a)) {
    if (n === 0) continue;
    const at = indexOfWords(tokens, wanted.slice(0, n));
    if (at !== -1) {
      return { start: tokens[at].start, end: tokens[at + n - 1].end, how: "passage" };
    }
  }
  const first = findAllMatches(text, query)[0];
  return first ? { ...first, how: "word" } : null;
}

function indexOfWords(tokens: WordToken[], words: string[]): number {
  if (words.length === 0) return -1;
  const last = tokens.length - words.length;
  outer: for (let i = 0; i <= last; i++) {
    if (tokens[i].word !== words[0]) continue;
    for (let k = 1; k < words.length; k++) {
      if (tokens[i + k].word !== words[k]) continue outer;
    }
    return i;
  }
  return -1;
}
