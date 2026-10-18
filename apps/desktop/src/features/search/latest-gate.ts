/**
 * Hands out sequence numbers so only the newest request may update the screen. A slow answer to
 * "tur" must not replace the answer to "turbo" that already arrived.
 */
export interface LatestGate {
  /** Starts a request; every earlier one becomes stale. */
  next(): number;
  isLatest(seq: number): boolean;
  /** Makes every request so far stale without starting one. */
  cancel(): void;
}

export function createLatestGate(): LatestGate {
  let current = 0;
  return {
    next: () => ++current,
    isLatest: (seq) => seq === current,
    cancel: () => {
      current++;
    },
  };
}
