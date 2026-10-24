// A TL;DR of a saved source (docs/dev/PLAN-tldr.md). It is never written into the source's file:
// it lives in the database only (Supabase `item_tldrs`, SQLite `item_tldrs` offline).

/** Where a TL;DR came from: the article's own summary, or a model. */
export type TldrSource = "article" | "ai";

export const TLDR_SOURCES: readonly TldrSource[] = ["article", "ai"];

export interface Tldr {
  /** One sentence: what the source says. */
  gist: string;
  /** Key points, 0–6 (the article's own TL;DR may have none). */
  points: string[];
  /** The part most worth reading (a section name or a video time, with why), or null. */
  best_part: string | null;
}

export interface ItemTldr {
  item_id: string;
  tldr: Tldr;
  source: TldrSource;
  /** The model's name for "Written by …"; null for the article's own. */
  model: string | null;
  /** `tldrBodyHash` of the body it was made from, so a changed text can be noticed. */
  body_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemTldrInput {
  tldr: Tldr;
  source: TldrSource;
  model: string | null;
  body_hash: string | null;
}

export const TLDR_LIMITS = {
  gist: 600,
  point: 300,
  points: 6,
  bestPart: 300,
  model: 200,
  bodyHash: 128,
} as const;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Checks and tidies a TL;DR from anywhere (a model's answer, the database, a request body):
 * whitespace collapsed, lengths clipped, empty points dropped. Null when there is no gist.
 */
export function normalizeTldr(raw: unknown): Tldr | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const gist = typeof value.gist === "string" ? clip(value.gist, TLDR_LIMITS.gist) : "";
  if (!gist) return null;
  const points = Array.isArray(value.points)
    ? value.points
        .filter((p): p is string => typeof p === "string")
        .map((p) => clip(p.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""), TLDR_LIMITS.point))
        .filter(Boolean)
        .slice(0, TLDR_LIMITS.points)
    : [];
  const best =
    typeof value.best_part === "string" ? clip(value.best_part, TLDR_LIMITS.bestPart) : "";
  return { gist, points, best_part: best && !/^(null|none|n\/a)$/i.test(best) ? best : null };
}

export function isTldrSource(value: unknown): value is TldrSource {
  return value === "article" || value === "ai";
}

/**
 * A short fingerprint of a source's body (cyrb53, 53 bits, as hex). Not for security: it only
 * tells whether the text changed since the TL;DR was made.
 */
export function tldrBodyHash(body: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `c53-${value.toString(16)}-${body.length.toString(16)}`;
}

/** Source kinds that have text to summarize. Notes and images don't. */
export function kindHasTldr(kind: string): boolean {
  return kind !== "note" && kind !== "image";
}
