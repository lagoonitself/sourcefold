import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchRequest, SourceFetchResponse } from "../source-fetch";
import { fetchXPostMedia, formatXMediaLine, normalizeXMedia } from "./media";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function makeFakeFetch(
  handler: (req: SourceFetchRequest) => Promise<SourceFetchResponse> | SourceFetchResponse,
): SourceFetch {
  return async (req: SourceFetchRequest) => handler(req);
}

describe("fetchXPostMedia with fixtures", () => {
  const photoAlt =
    "Secretary Marco Rubio and Uzbekistan Foreign Minister Bakhtiyor Saidov smile at the camera against a background of American and Uzbekistan flags. They are both wearing suits and ties. They appear to be shaking hands while also holding up a folder. There is an arrangement of flowers on the table in front of them.";

  it("parses syndication-photo.json correctly", async () => {
    const fetch = makeFakeFetch((req) => {
      expect(req.url).toContain("cdn.syndication.twimg.com/tweet-result");
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("syndication-photo.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112553116390269175");
    expect(result).toEqual([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/HVFL3R8XsAAwP91.jpg?name=orig",
        alt: photoAlt,
      },
    ]);
  });

  it("parses syndication-gif.json correctly", async () => {
    const fetch = makeFakeFetch((req) => {
      expect(req.url).toContain("cdn.syndication.twimg.com/tweet-result");
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("syndication-gif.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2108294185946374194");
    expect(result).toEqual([
      {
        type: "gif",
        url: "https://video.twimg.com/tweet_video/HUIqYhbaIAAvpV2.mp4",
        alt: null,
      },
    ]);
  });

  it("parses syndication-video.json correctly", async () => {
    const fetch = makeFakeFetch((req) => {
      expect(req.url).toContain("cdn.syndication.twimg.com/tweet-result");
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("syndication-video.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112628310702272570");
    expect(result).toEqual([
      {
        type: "video",
        durationSeconds: 24.666,
      },
    ]);
  });

  it("parses syndication-text.json correctly", async () => {
    const fetch = makeFakeFetch((req) => {
      expect(req.url).toContain("cdn.syndication.twimg.com/tweet-result");
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("syndication-text.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "20");
    expect(result).toEqual([]);
  });

  it("parses fxtwitter-photo.json correctly via fallback", async () => {
    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        const res: SourceFetchResponse = {
          status: 404,
          url: req.url,
          headers: {},
          text: "Not Found",
        };
        return res;
      }
      expect(req.url).toBe("https://api.fxtwitter.com/2/status/2112553116390269175");
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-photo.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112553116390269175");
    expect(result).toEqual([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/HVFL3R8XsAAwP91.jpg?name=orig",
        alt: photoAlt,
      },
    ]);
  });

  it("parses fxtwitter-gif.json correctly via fallback", async () => {
    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        const res: SourceFetchResponse = {
          status: 404,
          url: req.url,
          headers: {},
          text: "Not Found",
        };
        return res;
      }
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-gif.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2108294185946374194");
    expect(result).toEqual([
      {
        type: "gif",
        url: "https://video.twimg.com/tweet_video/HUIqYhbaIAAvpV2.mp4",
        alt: null,
      },
    ]);
  });

  it("parses fxtwitter-video.json correctly via fallback", async () => {
    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        const res: SourceFetchResponse = {
          status: 404,
          url: req.url,
          headers: {},
          text: "Not Found",
        };
        return res;
      }
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-video.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112628310702272570");
    expect(result).toEqual([
      {
        type: "video",
        durationSeconds: 24.666,
      },
    ]);
  });

  it("parses fxtwitter-text.json correctly via fallback", async () => {
    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        const res: SourceFetchResponse = {
          status: 404,
          url: req.url,
          headers: {},
          text: "Not Found",
        };
        return res;
      }
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-text.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "20");
    expect(result).toEqual([]);
  });
});

describe("fetchXPostMedia fallback behavior", () => {
  it("falls back to FxTwitter when syndication returns missing HTML", async () => {
    let syndicationCalled = false;
    let fxTwitterCalled = false;

    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        syndicationCalled = true;
        const res: SourceFetchResponse = {
          status: 200,
          url: req.url,
          headers: { "content-type": "text/html" },
          text: readFixture("syndication-missing.html"),
        };
        return res;
      }
      fxTwitterCalled = true;
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-photo.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112553116390269175");
    expect(syndicationCalled).toBe(true);
    expect(fxTwitterCalled).toBe(true);
    expect(result).toHaveLength(1);
    expect(result![0]!.type).toBe("photo");
  });

  it("falls back to FxTwitter when syndication throws", async () => {
    let fxTwitterCalled = false;

    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        throw new Error("Network offline");
      }
      fxTwitterCalled = true;
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-photo.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "2112553116390269175");
    expect(fxTwitterCalled).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("returns null when both syndication and FxTwitter fail", async () => {
    const fetch = makeFakeFetch((req) => {
      if (req.url.includes("cdn.syndication.twimg.com")) {
        const res: SourceFetchResponse = {
          status: 200,
          url: req.url,
          headers: { "content-type": "text/html" },
          text: readFixture("syndication-missing.html"),
        };
        return res;
      }
      const res: SourceFetchResponse = {
        status: 400,
        url: req.url,
        headers: { "content-type": "application/json" },
        text: readFixture("fxtwitter-missing.json"),
      };
      return res;
    });

    const result = await fetchXPostMedia(fetch, "9999999999999999999");
    expect(result).toBeNull();
  });

  it("returns null when both fetch attempts throw", async () => {
    const fetch = makeFakeFetch(() => {
      throw new Error("Fatal fetch error");
    });

    const result = await fetchXPostMedia(fetch, "12345");
    expect(result).toBeNull();
  });

  it("returns null and makes no fetch for bad statusId", async () => {
    let called = false;
    const fetch = makeFakeFetch(() => {
      called = true;
      throw new Error("Should not be called");
    });

    expect(await fetchXPostMedia(fetch, "")).toBeNull();
    expect(await fetchXPostMedia(fetch, "not-digits")).toBeNull();
    expect(await fetchXPostMedia(fetch, "-123")).toBeNull();
    expect(await fetchXPostMedia(fetch, "12345678901234567890123456")).toBeNull(); // 26 digits
    expect(called).toBe(false);
  });

  it("calculates token formula correctly for id 2112553116390269175", async () => {
    let capturedUrl = "";
    const fetch = makeFakeFetch((req) => {
      capturedUrl = req.url;
      const res: SourceFetchResponse = {
        status: 200,
        url: req.url,
        headers: {},
        text: readFixture("syndication-photo.json"),
      };
      return res;
    });

    await fetchXPostMedia(fetch, "2112553116390269175");
    expect(capturedUrl).toContain("token=54cs4mp964f");
  });
});

describe("normalizeXMedia", () => {
  it("returns empty array for non-array inputs", () => {
    expect(normalizeXMedia(null)).toEqual([]);
    expect(normalizeXMedia(undefined)).toEqual([]);
    expect(normalizeXMedia({})).toEqual([]);
    expect(normalizeXMedia("not an array")).toEqual([]);
    expect(normalizeXMedia(123)).toEqual([]);
  });

  it("drops non-object or null elements and unknown types", () => {
    const raw = [null, undefined, 42, "photo", [], { type: "unknown", url: "https://example.com" }];
    expect(normalizeXMedia(raw)).toEqual([]);
  });

  it("caps normalized media at 10 items", () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      type: "photo",
      url: `https://pbs.twimg.com/media/img${i}.jpg`,
      alt: null,
    }));
    const result = normalizeXMedia(items);
    expect(result).toHaveLength(10);
    expect(result[9]).toEqual({
      type: "photo",
      url: "https://pbs.twimg.com/media/img9.jpg?name=orig",
      alt: null,
    });
  });

  describe("photo validation", () => {
    it("accepts valid photo URLs on pbs.twimg.com/media/", () => {
      const valid = [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/HVFL3R8XsAAwP91.jpg?name=orig",
          alt: "A rocket launching",
        },
      ];
      expect(normalizeXMedia(valid)).toEqual([
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/HVFL3R8XsAAwP91.jpg?name=orig",
          alt: "A rocket launching",
        },
      ]);
    });

    it("drops hostile photo URLs", () => {
      const hostile = [
        { type: "photo", url: "https://pbs.twimg.com.evil.com/media/x", alt: null },
        { type: "photo", url: "http://pbs.twimg.com/media/x", alt: null },
        { type: "photo", url: "javascript:alert(1)", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/profile_images/x", alt: null },
        { type: "photo", url: "https://pbs.twimg.com:8080/media/x", alt: null },
        { type: "photo", url: "not-a-url", alt: null },
        { type: "photo", url: 12345, alt: null },
      ];
      expect(normalizeXMedia(hostile)).toEqual([]);
    });

    it("drops injection URLs attempting markdown link breakout", () => {
      const malicious = [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/a)![x](https://evil.example/y.png",
          alt: null,
        },
      ];
      expect(normalizeXMedia(malicious)).toEqual([]);
    });

    it("drops URLs with a space or ')' in the path", () => {
      const bad = [
        { type: "photo", url: "https://pbs.twimg.com/media/a b.jpg", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/a)b.jpg", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/a)b", alt: null },
      ];
      expect(normalizeXMedia(bad)).toEqual([]);
    });

    it("rebuilds photo URL taking extension from format query param when path has no extension", () => {
      const input = [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/AbC_1-x?format=png&name=small",
          alt: null,
        },
      ];
      expect(normalizeXMedia(input)).toEqual([
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/AbC_1-x.png?name=orig",
          alt: null,
        },
      ]);
    });

    it("lowercases extension and rebuilds photo URL", () => {
      const input = [
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/AbC.JPG",
          alt: null,
        },
      ];
      expect(normalizeXMedia(input)).toEqual([
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/AbC.jpg?name=orig",
          alt: null,
        },
      ]);
    });

    it("drops photo URLs with non-empty port", () => {
      const bad = [{ type: "photo", url: "https://pbs.twimg.com:8443/media/a.jpg", alt: null }];
      expect(normalizeXMedia(bad)).toEqual([]);
    });

    it("defaults to jpg when no extension in path and format query param is absent or invalid", () => {
      const input = [
        { type: "photo", url: "https://pbs.twimg.com/media/AbC_1-x", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/AbC_2-y?format=exe", alt: null },
      ];
      expect(normalizeXMedia(input)).toEqual([
        { type: "photo", url: "https://pbs.twimg.com/media/AbC_1-x.jpg?name=orig", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/AbC_2-y.jpg?name=orig", alt: null },
      ]);
    });

    it("drops photo with invalid extension in path", () => {
      const input = [{ type: "photo", url: "https://pbs.twimg.com/media/AbC_1-x.exe", alt: null }];
      expect(normalizeXMedia(input)).toEqual([]);
    });

    it("normalizes alt text: trims, cuts to 1000 characters, empty becomes null", () => {
      const items = [
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg", alt: "   " },
        { type: "photo", url: "https://pbs.twimg.com/media/b.jpg", alt: "" },
        { type: "photo", url: "https://pbs.twimg.com/media/c.jpg", alt: "  trimmed alt  " },
        { type: "photo", url: "https://pbs.twimg.com/media/d.jpg", alt: "x".repeat(1050) },
        { type: "photo", url: "https://pbs.twimg.com/media/e.jpg", alt: 123 },
      ];
      const result = normalizeXMedia(items);
      expect(result).toEqual([
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg?name=orig", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/b.jpg?name=orig", alt: null },
        { type: "photo", url: "https://pbs.twimg.com/media/c.jpg?name=orig", alt: "trimmed alt" },
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/d.jpg?name=orig",
          alt: "x".repeat(1000),
        },
        { type: "photo", url: "https://pbs.twimg.com/media/e.jpg?name=orig", alt: null },
      ]);
    });
  });

  describe("gif validation", () => {
    it("accepts valid gif URLs on video.twimg.com/tweet_video/*.mp4", () => {
      const valid = [
        {
          type: "gif",
          url: "https://video.twimg.com/tweet_video/HUIqYhbaIAAvpV2.mp4",
          alt: "Reaction gif",
        },
      ];
      expect(normalizeXMedia(valid)).toEqual([
        {
          type: "gif",
          url: "https://video.twimg.com/tweet_video/HUIqYhbaIAAvpV2.mp4",
          alt: "Reaction gif",
        },
      ]);
    });

    it("rebuilds gif URL without query parameter", () => {
      const input = [
        {
          type: "gif",
          url: "https://video.twimg.com/tweet_video/X1.mp4?tag=1",
          alt: null,
        },
      ];
      expect(normalizeXMedia(input)).toEqual([
        {
          type: "gif",
          url: "https://video.twimg.com/tweet_video/X1.mp4",
          alt: null,
        },
      ]);
    });

    it("drops invalid or hostile gif URLs", () => {
      const invalid = [
        { type: "gif", url: "https://video.twimg.com.evil.com/tweet_video/a.mp4", alt: null },
        { type: "gif", url: "http://video.twimg.com/tweet_video/a.mp4", alt: null },
        { type: "gif", url: "https://video.twimg.com/media/a.mp4", alt: null },
        { type: "gif", url: "https://video.twimg.com/tweet_video/a.webm", alt: null },
        { type: "gif", url: "https://video.twimg.com/tweet_video/a/b.mp4", alt: null },
        { type: "gif", url: "https://video.twimg.com/tweet_video/a b.mp4", alt: null },
        { type: "gif", url: "https://video.twimg.com/tweet_video/a)b.mp4", alt: null },
        { type: "gif", url: "https://video.twimg.com:8443/tweet_video/X1.mp4", alt: null },
      ];
      expect(normalizeXMedia(invalid)).toEqual([]);
    });
  });

  describe("video validation", () => {
    it("accepts valid finite duration 0..86400 and ignores any url field", () => {
      const valid = [
        { type: "video", durationSeconds: 24.666, url: "https://video.twimg.com/vid.mp4" },
        { type: "video", durationSeconds: 0 },
        { type: "video", durationSeconds: 86400 },
      ];
      expect(normalizeXMedia(valid)).toEqual([
        { type: "video", durationSeconds: 24.666 },
        { type: "video", durationSeconds: 0 },
        { type: "video", durationSeconds: 86400 },
      ]);
    });

    it("sets durationSeconds to null for invalid durations", () => {
      const invalid = [
        { type: "video", durationSeconds: -1 },
        { type: "video", durationSeconds: 86401 },
        { type: "video", durationSeconds: Number.NaN },
        { type: "video", durationSeconds: Number.POSITIVE_INFINITY },
        { type: "video", durationSeconds: "30" },
        { type: "video", durationSeconds: null },
      ];
      expect(normalizeXMedia(invalid)).toEqual([
        { type: "video", durationSeconds: null },
        { type: "video", durationSeconds: null },
        { type: "video", durationSeconds: null },
        { type: "video", durationSeconds: null },
        { type: "video", durationSeconds: null },
        { type: "video", durationSeconds: null },
      ]);
    });
  });
});

describe("formatXMediaLine", () => {
  const postUrl = "https://x.com/user/status/123";

  it("formats photo with default Image alt when alt is null or whitespace", () => {
    expect(
      formatXMediaLine(
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg", alt: null },
        postUrl,
      ),
    ).toBe("![Image](https://pbs.twimg.com/media/a.jpg)");

    expect(
      formatXMediaLine(
        { type: "photo", url: "https://pbs.twimg.com/media/a.jpg", alt: "   " },
        postUrl,
      ),
    ).toBe("![Image](https://pbs.twimg.com/media/a.jpg)");
  });

  it("formats photo alt text with whitespace collapse, trimming, and escaping", () => {
    expect(
      formatXMediaLine(
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/AAA111.jpg?name=orig",
          alt: "  A cat [sleeping]\n on a \\ sofa ",
        },
        postUrl,
      ),
    ).toBe(
      "![A cat \\[sleeping\\] on a \\\\ sofa](https://pbs.twimg.com/media/AAA111.jpg?name=orig)",
    );
  });

  it("cuts alt text to 300 code points before escaping", () => {
    const longAlt = "a".repeat(350);
    const line = formatXMediaLine(
      { type: "photo", url: "https://pbs.twimg.com/media/a.jpg", alt: longAlt },
      postUrl,
    );
    expect(line).toBe(`![${"a".repeat(300)}](https://pbs.twimg.com/media/a.jpg)`);
  });

  it("formats gif with default GIF alt when alt is null", () => {
    expect(
      formatXMediaLine(
        { type: "gif", url: "https://video.twimg.com/tweet_video/CCC333.mp4", alt: null },
        postUrl,
      ),
    ).toBe("![GIF](https://video.twimg.com/tweet_video/CCC333.mp4)");
  });

  it("formats video with null duration as [Video on X](postUrl)", () => {
    expect(formatXMediaLine({ type: "video", durationSeconds: null }, postUrl)).toBe(
      `[Video on X](${postUrl})`,
    );
  });

  it("formats video durations under an hour as m:ss with rounding", () => {
    expect(formatXMediaLine({ type: "video", durationSeconds: 0 }, postUrl)).toBe(
      `[Video (0:00) on X](${postUrl})`,
    );
    expect(formatXMediaLine({ type: "video", durationSeconds: 7 }, postUrl)).toBe(
      `[Video (0:07) on X](${postUrl})`,
    );
    expect(formatXMediaLine({ type: "video", durationSeconds: 59.6 }, postUrl)).toBe(
      `[Video (1:00) on X](${postUrl})`,
    );
  });

  it("formats video durations an hour or longer as h:mm:ss with rounding", () => {
    expect(formatXMediaLine({ type: "video", durationSeconds: 3600 }, postUrl)).toBe(
      `[Video (1:00:00) on X](${postUrl})`,
    );
    expect(formatXMediaLine({ type: "video", durationSeconds: 3725.4 }, postUrl)).toBe(
      `[Video (1:02:05) on X](${postUrl})`,
    );
  });
});
