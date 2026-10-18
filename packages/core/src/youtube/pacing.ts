import { detectLinkKind, parseYouTubeLink } from "../source-links";

// Pacing for saving many YouTube videos in a row. YouTube publishes no limit: it answers a burst
// from one connection with 429s, a "not a bot" check or a captcha page, and lifts it after a
// pause. So Add links (and the MCP server's add_links) leaves a few seconds between videos (each
// is three requests), and when YouTube pushes back it waits and tries the same video again
// instead of failing every row left.

/** The pause between two YouTube videos, picked at random in this range. */
export const YOUTUBE_GAP_MS: readonly [number, number] = [2_000, 5_000];

/** How long to wait after each rate limit before trying the same video again. */
export const YOUTUBE_RATE_LIMIT_WAITS_MS: readonly number[] = [60_000, 180_000];

export function isYouTubeVideoLink(url: string): boolean {
  return detectLinkKind(url) === "youtube" && parseYouTubeLink(url)?.type === "video";
}

export function youTubeGapMs(random: () => number = Math.random): number {
  const [min, max] = YOUTUBE_GAP_MS;
  return Math.round(min + random() * (max - min));
}

/** "45 s", "1 min", "2 min 30 s". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * Waits `ms`, calling `onTick` with the whole seconds left once a second. Resolves `false` as soon
 * as `shouldStop()` turns true, `true` when the wait ran out.
 */
export function waitUnlessStopped(
  ms: number,
  shouldStop: () => boolean,
  onTick?: (secondsLeft: number) => void,
): Promise<boolean> {
  const end = Date.now() + ms;
  let lastSecond = -1;
  return new Promise((resolve) => {
    const step = () => {
      if (shouldStop()) return resolve(false);
      const left = end - Date.now();
      if (left <= 0) return resolve(true);
      const second = Math.ceil(left / 1000);
      if (onTick && second !== lastSecond) {
        lastSecond = second;
        onTick(second);
      }
      setTimeout(step, Math.min(250, left));
    };
    step();
  });
}
