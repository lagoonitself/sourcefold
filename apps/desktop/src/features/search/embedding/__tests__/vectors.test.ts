import { describe, expect, it } from "vitest";
import { planBatches, planSortedBatches, truncateAndNormalize } from "../vectors";

describe("truncateAndNormalize", () => {
  it("keeps the first 256 values and scales them to length 1", () => {
    const full = new Float32Array(768).map((_, i) => (i < 256 ? 1 : 100));
    const out = truncateAndNormalize(full);
    expect(out).toHaveLength(256);
    const length = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0));
    expect(length).toBeCloseTo(1, 5);
    expect(out[0]).toBeCloseTo(1 / 16, 6); // 256 equal values: 1 / sqrt(256)
  });

  it("keeps the direction of the slice", () => {
    const out = truncateAndNormalize([3, 4, 99, 99], 2);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });

  it("leaves an all-zero slice at zero instead of making NaN", () => {
    const out = truncateAndNormalize([0, 0, 5], 2);
    expect(Array.from(out)).toEqual([0, 0]);
  });
});

describe("planBatches", () => {
  const padded = (counts: number[], batch: number[]) =>
    batch.length * Math.max(...batch.map((i) => Math.min(counts[i], 1024)));

  it("keeps every batch within the budget and every index once, in order", () => {
    const counts = [300, 500, 120, 700, 80, 900, 40, 40, 40, 1024, 2000];
    const batches = planBatches(counts, 2000, 1024);
    expect(batches.flat()).toEqual(counts.map((_, i) => i));
    for (const batch of batches) {
      if (batch.length > 1) expect(padded(counts, batch)).toBeLessThanOrEqual(2000);
    }
  });

  it("packs short inputs together", () => {
    expect(planBatches([100, 100, 100], 2000)).toEqual([[0, 1, 2]]);
    expect(planBatches([500, 500, 500, 500, 500], 2000)).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("counts the longest row for every row, because the batch is padded", () => {
    // Three rows padded to 900 is 2,700 tokens: too many.
    expect(planBatches([900, 100, 100], 2000)).toEqual([[0, 1], [2]]);
  });

  it("gives an input that is too big on its own a batch of its own", () => {
    expect(planBatches([100, 5000, 100], 2000, 10000)).toEqual([[0], [1], [2]]);
  });

  it("counts an input as at most the cut-off length", () => {
    expect(planBatches([5000, 5000], 2000, 1000)).toEqual([[0, 1]]);
  });

  it("returns nothing for nothing", () => {
    expect(planBatches([])).toEqual([]);
  });
});

describe("planSortedBatches", () => {
  it("puts similar lengths together and still covers every input once", () => {
    const counts = [900, 30, 800, 40, 35, 700];
    const batches = planSortedBatches(counts, 2000, 1024);
    expect(batches.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(batches[0]).toEqual([1, 4, 3]);
    for (const batch of batches) {
      const longest = Math.max(...batch.map((i) => Math.min(counts[i], 1024)));
      expect(batch.length * longest <= 2000 || batch.length === 1).toBe(true);
    }
  });

  it("returns nothing for no inputs", () => {
    expect(planSortedBatches([])).toEqual([]);
  });
});
