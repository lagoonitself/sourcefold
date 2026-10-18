// Pure helpers for the embedding worker: Matryoshka truncation and token-budget batching.

import { EMBEDDING_DIMS } from "../search-api";

/** Longest input the model sees; anything beyond is cut by the tokenizer. */
export const MAX_INPUT_TOKENS = 1024;
/** One GPU batch (rows times the longest row) stays under this, or kernels hit a size limit. */
export const BATCH_TOKEN_BUDGET = 2000;

/**
 * Takes the first `dims` values of a full-size embedding and L2-normalizes the slice again.
 * Without the second normalization, ranking degrades silently.
 */
export function truncateAndNormalize(
  row: ArrayLike<number>,
  dims: number = EMBEDDING_DIMS,
): Float32Array {
  const out = new Float32Array(dims);
  const n = Math.min(dims, row.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = row[i];
    out[i] = v;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (norm > 0 && Number.isFinite(norm)) {
    for (let i = 0; i < dims; i++) out[i] /= norm;
  }
  return out;
}

/**
 * Groups inputs, in order, into batches whose padded size (rows times the longest row) stays
 * within `budget` tokens. Each input counts as at most `maxTokens`, since the tokenizer cuts it
 * there. An input that is too big on its own gets a batch of its own. Returns indices into
 * `tokenCounts`; every index appears exactly once.
 */
export function planBatches(
  tokenCounts: readonly number[],
  budget: number = BATCH_TOKEN_BUDGET,
  maxTokens: number = MAX_INPUT_TOKENS,
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let longest = 0;
  for (let i = 0; i < tokenCounts.length; i++) {
    const tokens = Math.max(1, Math.min(tokenCounts[i], maxTokens));
    const nextLongest = Math.max(longest, tokens);
    if (current.length > 0 && (current.length + 1) * nextLongest > budget) {
      batches.push(current);
      current = [];
      longest = 0;
    }
    current.push(i);
    longest = Math.max(longest, tokens);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Like `planBatches`, but similar lengths share a batch, so short inputs aren't padded out to the
 * length of a long one. Indices still refer to `tokenCounts`; every index appears exactly once.
 */
export function planSortedBatches(
  tokenCounts: readonly number[],
  budget: number = BATCH_TOKEN_BUDGET,
  maxTokens: number = MAX_INPUT_TOKENS,
): number[][] {
  const order = tokenCounts
    .map((_, i) => i)
    .sort((a, b) => tokenCounts[a] - tokenCounts[b] || a - b);
  const sorted = order.map((i) => tokenCounts[i]);
  return planBatches(sorted, budget, maxTokens).map((batch) => batch.map((i) => order[i]));
}
