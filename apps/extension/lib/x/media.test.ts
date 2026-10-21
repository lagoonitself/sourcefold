import type { XMedia, XPostCapture } from "@sourcefold/core";
import { describe, expect, it, vi } from "vitest";
import { enrichXPostsMedia } from "./media";

// Mock @sourcefold/core's fetchXPostMedia while keeping real xStatusId and other exports
vi.mock("@sourcefold/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sourcefold/core")>();
  return {
    ...actual,
    fetchXPostMedia: vi.fn(),
  };
});

import { fetchXPostMedia } from "@sourcefold/core";

const mockFetchXPostMedia = vi.mocked(fetchXPostMedia);

function createSamplePost(id: string, initialMedia?: XMedia[]): XPostCapture {
  return {
    postUrl: `https://x.com/alice/status/${id}`,
    authorName: "Alice",
    handle: "alice",
    authorUrl: "https://x.com/alice",
    postedAt: "2026-10-21T10:00:00Z",
    text: `Post ${id}`,
    media: initialMedia ?? [],
  };
}

describe("enrichXPostsMedia", () => {
  it("returns an empty array for empty input", async () => {
    const result = await enrichXPostsMedia([]);
    expect(result).toEqual([]);
  });

  it("does not mutate the original input array or objects", async () => {
    const originalPost = createSamplePost("101", [
      { type: "photo", url: "https://pbs.twimg.com/media/orig.jpg", alt: null },
    ]);
    const input = [originalPost];

    mockFetchXPostMedia.mockResolvedValueOnce([
      { type: "photo", url: "https://pbs.twimg.com/media/enriched.jpg?name=orig", alt: "Enriched" },
    ]);

    const result = await enrichXPostsMedia(input);

    expect(result).not.toBe(input);
    expect(result[0]).not.toBe(originalPost);
    expect(originalPost.media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/orig.jpg", alt: null },
    ]);
    expect(result[0]?.media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/enriched.jpg?name=orig", alt: "Enriched" },
    ]);
  });

  it("replaces media with non-null result from fetchXPostMedia", async () => {
    const post = createSamplePost("201", [{ type: "video", durationSeconds: null }]);

    mockFetchXPostMedia.mockResolvedValueOnce([{ type: "video", durationSeconds: 42 }]);

    const result = await enrichXPostsMedia([post]);
    expect(result[0]?.media).toEqual([{ type: "video", durationSeconds: 42 }]);
  });

  it("keeps page media when fetchXPostMedia returns null", async () => {
    const post = createSamplePost("301", [
      { type: "photo", url: "https://pbs.twimg.com/media/page.jpg?name=orig", alt: "Page" },
    ]);

    mockFetchXPostMedia.mockResolvedValueOnce(null);

    const result = await enrichXPostsMedia([post]);
    expect(result[0]?.media).toEqual(post.media);
  });

  it("keeps page media when fetchXPostMedia throws an error", async () => {
    const post = createSamplePost("401", [
      { type: "photo", url: "https://pbs.twimg.com/media/page.jpg?name=orig", alt: null },
    ]);

    mockFetchXPostMedia.mockRejectedValueOnce(new Error("Network failure"));

    const result = await enrichXPostsMedia([post]);
    expect(result[0]?.media).toEqual(post.media);
  });

  it("keeps page media when post timeout occurs", async () => {
    const post = createSamplePost("501", [
      { type: "photo", url: "https://pbs.twimg.com/media/page.jpg?name=orig", alt: null },
    ]);

    mockFetchXPostMedia.mockImplementationOnce(
      (_fetch, _id, signal) =>
        new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new Error("Aborted by timeout"));
          });
        }),
    );

    const result = await enrichXPostsMedia([post], { postTimeoutMs: 50 });
    expect(result[0]?.media).toEqual(post.media);
  });

  it("respects overall budget and keeps original media for unfinished posts", async () => {
    const post1 = createSamplePost("601", [
      { type: "photo", url: "https://pbs.twimg.com/media/1.jpg", alt: null },
    ]);
    const post2 = createSamplePost("602", [
      { type: "photo", url: "https://pbs.twimg.com/media/2.jpg", alt: null },
    ]);

    mockFetchXPostMedia.mockImplementation((_fetch, id, signal) => {
      if (id === "601") {
        return Promise.resolve([
          { type: "photo", url: "https://pbs.twimg.com/media/1-enriched.jpg?name=orig", alt: null },
        ]);
      }
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new Error("Overall budget abort"));
        });
      });
    });

    const result = await enrichXPostsMedia([post1, post2], {
      concurrency: 1,
      overallTimeoutMs: 80,
      postTimeoutMs: 500,
    });

    expect(result[0]?.media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/1-enriched.jpg?name=orig", alt: null },
    ]);
    expect(result[1]?.media).toEqual(post2.media);
  });

  it("limits concurrency to at most 4 posts simultaneously", async () => {
    const posts = [
      createSamplePost("701"),
      createSamplePost("702"),
      createSamplePost("703"),
      createSamplePost("704"),
      createSamplePost("705"),
      createSamplePost("706"),
    ];

    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;

    mockFetchXPostMedia.mockImplementation(async () => {
      currentConcurrent++;
      if (currentConcurrent > maxObservedConcurrent) {
        maxObservedConcurrent = currentConcurrent;
      }
      await new Promise((r) => setTimeout(r, 20));
      currentConcurrent--;
      return [];
    });

    await enrichXPostsMedia(posts, { concurrency: 4 });
    expect(maxObservedConcurrent).toBeLessThanOrEqual(4);
  });

  it("skips posts without valid statusId and retains original media", async () => {
    const invalidPost: XPostCapture = {
      postUrl: "https://x.com/invalid",
      authorName: "Bob",
      handle: "bob",
      authorUrl: "https://x.com/bob",
      postedAt: null,
      text: "No status id",
      media: [{ type: "photo", url: "https://pbs.twimg.com/media/keep.jpg", alt: null }],
    };

    mockFetchXPostMedia.mockClear();
    const result = await enrichXPostsMedia([invalidPost]);

    expect(mockFetchXPostMedia).not.toHaveBeenCalled();
    expect(result[0]?.media).toEqual(invalidPost.media);
  });
});
