import type { SubstackFetch } from "./discover";

// Substack answers bursts with 429. Like sbstck-dl, space requests out and honour Retry-After.

export interface RateLimitOptions {
  ratePerSecond?: number;
  maxRetries?: number;
  /** Replaceable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class SubstackRateLimitError extends Error {
  constructor() {
    super("Substack is limiting requests. Wait a minute and try again.");
    this.name = "SubstackRateLimitError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createRateLimitedFetch(
  raw: SubstackFetch,
  { ratePerSecond = 2, maxRetries = 5, sleep = defaultSleep }: RateLimitOptions = {},
): SubstackFetch {
  const interval = 1000 / ratePerSecond;
  let nextSlot = 0;

  async function waitTurn(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + interval;
    if (slot > now) await sleep(slot - now);
  }

  return async (url) => {
    for (let attempt = 0; ; attempt++) {
      await waitTurn();
      let res;
      try {
        res = await raw(url);
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        await sleep(Math.min(1000 * 2 ** attempt, 30_000));
        continue;
      }
      if (res.status !== 429 && res.status !== 503) return res;
      if (attempt >= maxRetries) throw new SubstackRateLimitError();
      const waitSeconds = Math.min(Math.max(res.retryAfter ?? 10, 1), 60);
      await sleep(waitSeconds * 1000);
    }
  };
}
