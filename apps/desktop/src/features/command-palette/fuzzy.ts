export interface FuzzyMatchResult {
  match: boolean;
  score: number;
}

/**
 * Fuzzy score a pattern against a target string.
 * Higher score means a better match.
 * Gives bonuses for exact matches, word starts, and consecutive matching characters.
 */
export function fuzzyMatch(pattern: string, target: string): FuzzyMatchResult {
  if (!pattern) return { match: true, score: 0 };
  if (!target) return { match: false, score: 0 };

  const p = pattern.trim().toLowerCase();
  const t = target.toLowerCase();

  if (p.length === 0) return { match: true, score: 0 };
  if (p.length > t.length) return { match: false, score: 0 };

  // Exact full match
  if (p === t) {
    return { match: true, score: 10000 };
  }

  // Exact substring match
  const subIdx = t.indexOf(p);
  if (subIdx !== -1) {
    const isWordStart = subIdx === 0 || /[\s\-_/.]/.test(t[subIdx - 1]);
    const score = 2000 - subIdx * 10 + (isWordStart ? 500 : 0) + (p.length / t.length) * 100;
    return { match: true, score };
  }

  // Subsequence match
  let pIdx = 0;
  let tIdx = 0;
  let score = 0;
  let consecutive = 0;

  while (pIdx < p.length && tIdx < t.length) {
    if (p[pIdx] === t[tIdx]) {
      score += 10 + consecutive * 10;
      consecutive++;

      // Word boundary bonus
      if (tIdx === 0 || /[\s\-_/.]/.test(t[tIdx - 1])) {
        score += 30;
      }
      pIdx++;
    } else {
      consecutive = 0;
    }
    tIdx++;
  }

  const match = pIdx === p.length;
  if (!match) return { match: false, score: 0 };

  // Penalize length gap
  score -= (t.length - p.length) * 2;
  return { match: true, score: Math.max(score, 1) };
}

export function filterFuzzy<T>(items: T[], pattern: string, getText: (item: T) => string): T[] {
  if (!pattern.trim()) return items;

  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const text = getText(item);
    const result = fuzzyMatch(pattern, text);
    if (result.match) {
      scored.push({ item, score: result.score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
