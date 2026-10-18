// Lives in packages/core/src/youtube/pacing.ts so the MCP server paces videos the same way.
export {
  YOUTUBE_GAP_MS,
  YOUTUBE_RATE_LIMIT_WAITS_MS,
  formatWait,
  isYouTubeVideoLink,
  waitUnlessStopped,
  youTubeGapMs,
} from "@sourcefold/core/capture";
