import { afterEach, describe, expect, it, vi } from "vitest";
import {
  YOUTUBE_GAP_MS,
  formatWait,
  isYouTubeVideoLink,
  waitUnlessStopped,
  youTubeGapMs,
} from "../youtube-pacing";

describe("youtube pacing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("paces only single videos", () => {
    expect(isYouTubeVideoLink("https://www.youtube.com/watch?v=XuoqKYxDHVc")).toBe(true);
    expect(isYouTubeVideoLink("https://youtu.be/XuoqKYxDHVc")).toBe(true);
    expect(isYouTubeVideoLink("https://www.youtube.com/playlist?list=PLabc123")).toBe(false);
    expect(isYouTubeVideoLink("https://example.com/watch?v=XuoqKYxDHVc")).toBe(false);
  });

  it("picks a gap inside the range", () => {
    expect(youTubeGapMs(() => 0)).toBe(YOUTUBE_GAP_MS[0]);
    expect(youTubeGapMs(() => 1)).toBe(YOUTUBE_GAP_MS[1]);
  });

  it("formats waits", () => {
    expect(formatWait(45)).toBe("45 s");
    expect(formatWait(60)).toBe("1 min");
    expect(formatWait(150)).toBe("2 min 30 s");
  });

  it("counts down and finishes", async () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const done = waitUnlessStopped(
      3_000,
      () => false,
      (s) => ticks.push(s),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(done).resolves.toBe(true);
    expect(ticks).toEqual([3, 2, 1]);
  });

  it("stops early when asked", async () => {
    vi.useFakeTimers();
    let stop = false;
    const done = waitUnlessStopped(60_000, () => stop);
    await vi.advanceTimersByTimeAsync(1_000);
    stop = true;
    await vi.advanceTimersByTimeAsync(250);
    await expect(done).resolves.toBe(false);
  });
});
