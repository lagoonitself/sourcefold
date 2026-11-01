import { findYouTubeVideos } from "../sources/source-client";
import { waitUnlessStopped, youTubeGapMs } from "../sources/youtube-pacing";
import { findPublicationPosts } from "../substack/substack-client";
import { claimDesktopQueue, patchLinkQueue } from "./api";
import { saveQueuedLink } from "./save-queued-link";
import type { DrainHooks, DrainProgress } from "./types";
import { desktopWorkerId } from "./worker-id";

export function createDesktopDrainHooks(
  signal: AbortSignal,
  stopped: () => boolean,
  onProgress: (progress: DrainProgress) => void,
): DrainHooks {
  return {
    worker: desktopWorkerId(),
    stopped,
    signal,
    claim: (body) => claimDesktopQueue(body),
    patch: (id, body) => patchLinkQueue(id, body),
    save: (url, folderId, saveSignal) => saveQueuedLink(url, folderId, saveSignal),
    listYouTube: async (url, listSignal) => {
      const list = await findYouTubeVideos(url, { signal: listSignal });
      return {
        title: list.title,
        truncated: list.truncated,
        videos: list.videos.map((video) => ({ url: video.url, title: video.title })),
      };
    },
    listPosts: async (url, listSignal) => {
      const posts = await findPublicationPosts(url, { signal: listSignal });
      return { posts: posts.map((post) => ({ url: post.url, title: post.title })) };
    },
    onProgress,
    wait: (ms, shouldStop, onTick) => waitUnlessStopped(ms, shouldStop, onTick),
    youTubeGapMs: () => youTubeGapMs(),
  };
}
