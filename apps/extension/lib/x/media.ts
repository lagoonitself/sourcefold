import {
  fetchXPostMedia,
  sourceFetchFromGlobalFetch,
  xStatusId,
  type SourceFetch,
  type XPostCapture,
} from "@sourcefold/core";

export interface EnrichXPostsMediaOptions {
  sourceFetch?: SourceFetch;
  postTimeoutMs?: number;
  overallTimeoutMs?: number;
  concurrency?: number;
}

const DEFAULT_POST_TIMEOUT_MS = 8000;
const DEFAULT_OVERALL_TIMEOUT_MS = 20000;
const DEFAULT_CONCURRENCY = 4;

/**
 * Enriches extracted X posts with higher quality media from X embed syndication / FxTwitter.
 * - At most 4 posts fetched concurrently.
 * - 8 second timeout per post.
 * - 20 second overall budget; incomplete posts retain page media.
 * - Non-null result replaces `media`; null, timeout, or error retains page media.
 * - Never throws, always returns new objects without mutating the input array or post objects.
 */
export async function enrichXPostsMedia(
  posts: XPostCapture[],
  options?: EnrichXPostsMediaOptions,
): Promise<XPostCapture[]> {
  try {
    if (!posts.length) {
      return [];
    }

    const postTimeoutMs = options?.postTimeoutMs ?? DEFAULT_POST_TIMEOUT_MS;
    const overallTimeoutMs = options?.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
    const maxConcurrency = Math.min(options?.concurrency ?? DEFAULT_CONCURRENCY, posts.length);
    const sourceFetch = options?.sourceFetch ?? sourceFetchFromGlobalFetch();

    // Create shallow copies of all posts so the input is never mutated
    const results: XPostCapture[] = posts.map((p) => ({ ...p }));

    const overallController = new AbortController();
    const overallTimer = setTimeout(() => {
      overallController.abort(new Error("Overall timeout"));
    }, overallTimeoutMs);

    let nextIndex = 0;

    async function worker(): Promise<void> {
      while (nextIndex < posts.length) {
        if (overallController.signal.aborted) {
          break;
        }

        const index = nextIndex++;
        const post = posts[index];
        if (!post) continue;

        const id = xStatusId(post.postUrl);
        if (!id || overallController.signal.aborted) {
          continue;
        }

        const postController = new AbortController();
        const postTimer = setTimeout(() => {
          postController.abort(new Error("Post timeout"));
        }, postTimeoutMs);

        const onOverallAbort = () => {
          postController.abort(overallController.signal.reason);
        };

        if (overallController.signal.aborted) {
          postController.abort(overallController.signal.reason);
        } else {
          overallController.signal.addEventListener("abort", onOverallAbort, { once: true });
        }

        try {
          const media = await fetchXPostMedia(sourceFetch, id, postController.signal);
          if (media !== null && !overallController.signal.aborted) {
            results[index] = { ...post, media };
          }
        } catch {
          // On fetch error, timeout, or abort, retain page media
        } finally {
          clearTimeout(postTimer);
          overallController.signal.removeEventListener("abort", onOverallAbort);
        }
      }
    }

    try {
      const workers = Array.from({ length: maxConcurrency }, () => worker());
      await Promise.all(workers);
    } finally {
      clearTimeout(overallTimer);
    }

    return results;
  } catch {
    // Failsafe: never throw, return copied posts
    return posts.map((p) => ({ ...p }));
  }
}
