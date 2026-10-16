import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchRequest } from "../source-fetch";
import { listYouTubeVideos } from "./list";

// Shapes trimmed from real youtube.com responses (2026-10).
function lockup(id: string, title: string, duration: string) {
  return {
    lockupViewModel: {
      contentId: id,
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      contentImage: {
        thumbnailViewModel: {
          overlays: [
            {
              thumbnailBottomOverlayViewModel: {
                badges: [{ thumbnailBadgeViewModel: { text: duration } }],
              },
            },
          ],
        },
      },
      metadata: { lockupMetadataViewModel: { title: { content: title } } },
    },
  };
}

const playlistLockup = (n: number) =>
  lockup(`video${String(n).padStart(6, "0")}`, `Video ${n}`, "1:50");

function continuationViewModel(token: string) {
  return {
    continuationItemViewModel: {
      continuationCommand: { innertubeCommand: { continuationCommand: { token } } },
    },
  };
}

function page(data: unknown): string {
  return `<html><script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaKEY","INNERTUBE_CLIENT_VERSION":"2.20261015.01.00"});</script><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

function playlistContents(items: unknown[], sectionToken: string) {
  return {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  { itemSectionRenderer: { contents: items } },
                  continuationViewModel(sectionToken),
                ],
              },
            },
          },
        },
      ],
    },
  };
}

function fakeFetch(route: (request: SourceFetchRequest) => unknown) {
  const requests: SourceFetchRequest[] = [];
  const fetch: SourceFetch = async (request) => {
    requests.push(request);
    const body = route(request);
    if (body === undefined) throw new Error(`unexpected request ${request.url}`);
    return {
      status: 200,
      url: request.url,
      headers: {},
      text: typeof body === "string" ? body : JSON.stringify(body),
    };
  };
  return { fetch, requests };
}

describe("listYouTubeVideos", () => {
  const firstPage = [playlistLockup(1), playlistLockup(2)];
  const playlistRoute = (request: SourceFetchRequest) => {
    if (request.url === "https://www.youtube.com/playlist?list=PLtest123") {
      return page({
        contents: playlistContents(firstPage, "SECTION-TOKEN"),
        metadata: { playlistMetadataRenderer: { title: "Engines" } },
      });
    }
    const body = JSON.parse(request.body ?? "{}");
    if (body.browseId === "VLPLtest123") {
      return {
        contents: playlistContents(
          [...firstPage, continuationViewModel("ITEM-TOKEN-1")],
          "SECTION-TOKEN",
        ),
      };
    }
    if (body.continuation === "ITEM-TOKEN-1") {
      return {
        contents: playlistContents(
          [...firstPage, continuationViewModel("ITEM-TOKEN-1")],
          "SECTION-TOKEN",
        ),
        onResponseReceivedActions: [
          {
            appendContinuationItemsAction: {
              continuationItems: [
                playlistLockup(3),
                {
                  playlistVideoRenderer: {
                    videoId: "video000004",
                    title: { runs: [{ text: "Video " }, { text: "4" }] },
                    lengthText: { simpleText: "1:02:03" },
                  },
                },
              ],
            },
          },
        ],
      };
    }
    return undefined;
  };

  it("lists a playlist, paging through browse by playlist id", async () => {
    const { fetch, requests } = fakeFetch(playlistRoute);
    const list = await listYouTubeVideos("https://www.youtube.com/playlist?list=PLtest123", {
      fetch,
    });

    expect(list.title).toBe("Engines");
    expect(list.truncated).toBe(false);
    expect(list.videos).toEqual([
      {
        videoId: "video000001",
        url: "https://www.youtube.com/watch?v=video000001",
        title: "Video 1",
        duration: "1:50",
      },
      {
        videoId: "video000002",
        url: "https://www.youtube.com/watch?v=video000002",
        title: "Video 2",
        duration: "1:50",
      },
      {
        videoId: "video000003",
        url: "https://www.youtube.com/watch?v=video000003",
        title: "Video 3",
        duration: "1:50",
      },
      {
        videoId: "video000004",
        url: "https://www.youtube.com/watch?v=video000004",
        title: "Video 4",
        duration: "1:02:03",
      },
    ]);
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.url)).toEqual([
      "https://www.youtube.com/youtubei/v1/browse?key=AIzaKEY",
      "https://www.youtube.com/youtubei/v1/browse?key=AIzaKEY",
    ]);
    expect(JSON.parse(posts[0]!.body!).context.client).toEqual({
      clientName: "WEB",
      clientVersion: "2.20261015.01.00",
      hl: "en",
    });
    // The section-level token is never followed.
    expect(posts.some((r) => r.body!.includes("SECTION-TOKEN"))).toBe(false);
  });

  it("stops at the limit and says the list was cut", async () => {
    const { fetch } = fakeFetch(playlistRoute);
    const list = await listYouTubeVideos("https://www.youtube.com/playlist?list=PLtest123", {
      fetch,
      limit: 3,
    });
    expect(list.videos.map((v) => v.videoId)).toEqual([
      "video000001",
      "video000002",
      "video000003",
    ]);
    expect(list.truncated).toBe(true);
  });

  it("lists a channel's videos tab and follows its continuation", async () => {
    const grid = (items: unknown[]) => ({
      twoColumnBrowseResultsRenderer: {
        tabs: [
          { tabRenderer: { title: "Home" } },
          { tabRenderer: { content: { richGridRenderer: { contents: items } } } },
        ],
      },
    });
    const { fetch, requests } = fakeFetch((request) => {
      if (request.url === "https://www.youtube.com/@engineering/videos") {
        return page({
          contents: grid([
            { richItemRenderer: { content: lockup("chanvideo01", "Newest", "10:00") } },
            // Shorts and playlists in the grid are skipped.
            {
              richItemRenderer: {
                content: {
                  lockupViewModel: {
                    contentId: "PLxyz",
                    contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
                  },
                },
              },
            },
            {
              continuationItemRenderer: {
                continuationEndpoint: { continuationCommand: { token: "CHANNEL-TOKEN" } },
              },
            },
          ]),
          metadata: { channelMetadataRenderer: { title: "Engineering Explained" } },
        });
      }
      if (JSON.parse(request.body ?? "{}").continuation === "CHANNEL-TOKEN") {
        return {
          onResponseReceivedActions: [
            {
              appendContinuationItemsAction: {
                continuationItems: [
                  { richItemRenderer: { content: lockup("chanvideo02", "Older", "4:05") } },
                  { richItemRenderer: { content: lockup("chanvideo01", "Newest", "10:00") } },
                ],
              },
            },
          ],
        };
      }
      return undefined;
    });

    const list = await listYouTubeVideos("https://www.youtube.com/@Engineering", { fetch });
    expect(list.title).toBe("Engineering Explained");
    expect(list.videos.map((v) => [v.videoId, v.title, v.duration])).toEqual([
      ["chanvideo01", "Newest", "10:00"],
      ["chanvideo02", "Older", "4:05"],
    ]);
    expect(list.truncated).toBe(false);
    expect(requests).toHaveLength(2);
  });

  it("rejects single videos and other links", async () => {
    const { fetch } = fakeFetch(() => undefined);
    await expect(
      listYouTubeVideos("https://youtu.be/dQw4w9WgXcQ", { fetch }),
    ).rejects.toMatchObject({
      code: "invalid_url",
    });
    await expect(listYouTubeVideos("https://example.com", { fetch })).rejects.toMatchObject({
      code: "invalid_url",
    });
  });

  it("explains a page it can't read", async () => {
    const { fetch } = fakeFetch(() => "<html>nothing here</html>");
    await expect(
      listYouTubeVideos("https://www.youtube.com/playlist?list=PLtest123", { fetch }),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });
});
