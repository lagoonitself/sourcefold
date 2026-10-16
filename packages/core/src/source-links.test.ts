import { describe, expect, it } from "vitest";
import {
  blueskyPostUrl,
  canonicalSourceUrl,
  detectLinkKind,
  hackerNewsItemUrl,
  looksLikePdfUrl,
  meaningfulQuery,
  parseArxivLink,
  parseBlueskyLink,
  parseHackerNewsLink,
  parseRedditLink,
  parseYouTubeLink,
  redditPostUrl,
  youTubeTimestampUrl,
  youTubeVideoUrl,
} from "./source-links";

const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("parseYouTubeLink", () => {
  it("reads every video link form", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=42",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123&index=2",
      "  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ",
    ]) {
      expect(parseYouTubeLink(link)).toEqual({ type: "video", videoId: "dQw4w9WgXcQ", url: VIDEO });
    }
  });

  it("reads playlists and channels", () => {
    expect(parseYouTubeLink("https://www.youtube.com/playlist?list=PLabc123")).toEqual({
      type: "playlist",
      playlistId: "PLabc123",
      url: "https://www.youtube.com/playlist?list=PLabc123",
    });
    expect(parseYouTubeLink("https://www.youtube.com/@Veritasium/videos")).toEqual({
      type: "channel",
      url: "https://www.youtube.com/@veritasium",
    });
    expect(parseYouTubeLink("https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA")).toEqual({
      type: "channel",
      url: "https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA",
    });
    expect(parseYouTubeLink("https://www.youtube.com/user/name/videos")?.type).toBe("channel");
    expect(parseYouTubeLink("https://www.youtube.com/c/name")?.type).toBe("channel");
  });

  it("rejects other links", () => {
    expect(parseYouTubeLink("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeLink("https://youtu.be/")).toBeNull();
    expect(parseYouTubeLink("https://www.youtube.com/feed/subscriptions")).toBeNull();
    expect(parseYouTubeLink("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeLink("not a link")).toBeNull();
  });

  it("builds video and timestamp addresses", () => {
    expect(youTubeVideoUrl("dQw4w9WgXcQ")).toBe(VIDEO);
    expect(youTubeTimestampUrl("dQw4w9WgXcQ", 62.7)).toBe("https://youtu.be/dQw4w9WgXcQ?t=62");
    expect(youTubeTimestampUrl("dQw4w9WgXcQ", -3)).toBe("https://youtu.be/dQw4w9WgXcQ?t=0");
  });
});

describe("parseRedditLink", () => {
  it("reads posts in a subreddit", () => {
    expect(parseRedditLink("https://old.reddit.com/r/Cars/comments/1abc2d/some_title/")).toEqual({
      type: "post",
      postId: "1abc2d",
      subreddit: "cars",
      url: "https://www.reddit.com/r/cars/comments/1abc2d",
    });
    expect(
      parseRedditLink("https://www.reddit.com/r/cars/comments/1abc2d/some_title/kx9z1yq/")?.url,
    ).toBe("https://www.reddit.com/r/cars/comments/1abc2d");
    expect(parseRedditLink("https://m.reddit.com/r/cars/comments/1ABC2D")?.url).toBe(
      "https://www.reddit.com/r/cars/comments/1abc2d",
    );
  });

  it("reads posts without a subreddit", () => {
    expect(parseRedditLink("https://redd.it/1abc2d")).toEqual({
      type: "post",
      postId: "1abc2d",
      subreddit: null,
      url: "https://www.reddit.com/comments/1abc2d",
    });
    expect(parseRedditLink("https://www.reddit.com/comments/1abc2d/x")?.url).toBe(
      "https://www.reddit.com/comments/1abc2d",
    );
  });

  it("reads share links", () => {
    expect(parseRedditLink("https://www.reddit.com/r/cars/s/AbC123xyz")).toEqual({
      type: "share",
      url: "https://www.reddit.com/r/cars/s/AbC123xyz",
    });
  });

  it("rejects subreddit pages and other hosts", () => {
    expect(parseRedditLink("https://www.reddit.com/r/cars")).toBeNull();
    expect(parseRedditLink("https://www.reddit.com/user/someone")).toBeNull();
    expect(parseRedditLink("https://example.com/r/cars/comments/1abc2d")).toBeNull();
  });

  it("builds post addresses", () => {
    expect(redditPostUrl("1abc2d", "cars")).toBe("https://www.reddit.com/r/cars/comments/1abc2d");
    expect(redditPostUrl("1abc2d", null)).toBe("https://www.reddit.com/comments/1abc2d");
  });
});

describe("parseHackerNewsLink", () => {
  it("reads item links and keeps only the id", () => {
    expect(parseHackerNewsLink("https://news.ycombinator.com/item?id=41234567&p=2")).toEqual({
      itemId: "41234567",
      url: "https://news.ycombinator.com/item?id=41234567",
    });
    expect(hackerNewsItemUrl("1")).toBe("https://news.ycombinator.com/item?id=1");
  });

  it("rejects other pages", () => {
    expect(parseHackerNewsLink("https://news.ycombinator.com/news")).toBeNull();
    expect(parseHackerNewsLink("https://news.ycombinator.com/item?id=abc")).toBeNull();
    expect(parseHackerNewsLink("https://example.com/item?id=1")).toBeNull();
  });
});

describe("parseBlueskyLink", () => {
  it("lowercases handles and keeps DIDs", () => {
    expect(parseBlueskyLink("https://bsky.app/profile/Jay.bsky.team/post/3l6oveex3ii2l")).toEqual({
      actor: "jay.bsky.team",
      rkey: "3l6oveex3ii2l",
      url: "https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l",
    });
    expect(
      parseBlueskyLink("https://bsky.app/profile/did:plc:Abc123/post/3l6oveex3ii2l")?.actor,
    ).toBe("did:plc:Abc123");
    expect(blueskyPostUrl("a.bsky.social", "xyz")).toBe(
      "https://bsky.app/profile/a.bsky.social/post/xyz",
    );
  });

  it("rejects profiles and other hosts", () => {
    expect(parseBlueskyLink("https://bsky.app/profile/jay.bsky.team")).toBeNull();
    expect(parseBlueskyLink("https://example.com/profile/a/post/b")).toBeNull();
  });
});

describe("parseArxivLink and looksLikePdfUrl", () => {
  it("reads new and old arXiv ids", () => {
    expect(parseArxivLink("https://arxiv.org/pdf/2401.01234v2.pdf")).toEqual({
      id: "2401.01234",
      version: "v2",
      url: "https://arxiv.org/abs/2401.01234",
    });
    expect(parseArxivLink("https://arxiv.org/abs/2401.01234")?.version).toBeNull();
    expect(parseArxivLink("https://arxiv.org/html/2401.01234v1")?.id).toBe("2401.01234");
    expect(parseArxivLink("https://export.arxiv.org/abs/hep-th/9901001v1")).toEqual({
      id: "hep-th/9901001",
      version: "v1",
      url: "https://arxiv.org/abs/hep-th/9901001",
    });
  });

  it("rejects other arXiv pages", () => {
    expect(parseArxivLink("https://arxiv.org/list/cs.AI/recent")).toBeNull();
    expect(parseArxivLink("https://example.com/abs/2401.01234")).toBeNull();
  });

  it("spots .pdf paths", () => {
    expect(looksLikePdfUrl("https://example.com/files/Report.PDF")).toBe(true);
    expect(looksLikePdfUrl("https://example.com/files/report.pdf?dl=1")).toBe(true);
    expect(looksLikePdfUrl("https://example.com/pdf/viewer")).toBe(false);
  });
});

describe("detectLinkKind", () => {
  it("routes each kind", () => {
    expect(detectLinkKind("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(detectLinkKind("https://www.youtube.com/@veritasium")).toBe("youtube");
    expect(detectLinkKind("https://www.reddit.com/r/cars/comments/1abc2d")).toBe("reddit");
    expect(detectLinkKind("https://news.ycombinator.com/item?id=1")).toBe("hackernews");
    expect(detectLinkKind("https://bsky.app/profile/a.bsky.social/post/3l6oveex3ii2l")).toBe(
      "bluesky",
    );
    expect(detectLinkKind("https://arxiv.org/abs/2401.01234")).toBe("pdf");
    expect(detectLinkKind("https://example.com/paper.pdf")).toBe("pdf");
    expect(detectLinkKind("https://www.britannica.com/technology/turbocharger")).toBe("web");
  });

  it("returns null for anything that isn't an http(s) link", () => {
    expect(detectLinkKind("ftp://example.com/file")).toBeNull();
    expect(detectLinkKind("hello")).toBeNull();
  });
});

describe("canonicalSourceUrl and meaningfulQuery", () => {
  it("returns null for ordinary pages", () => {
    expect(canonicalSourceUrl("https://example.com/page")).toBeNull();
    expect(canonicalSourceUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(VIDEO);
  });

  it("drops tracking parameters and keeps the rest in order", () => {
    const url = new URL("https://example.com/p?b=2&utm_source=x&a=1&fbclid=z&si=q&ref=feed");
    expect(meaningfulQuery(url)).toBe("?b=2&a=1");
    expect(meaningfulQuery(new URL("https://example.com/p?utm_medium=y"))).toBe("");
  });
});
