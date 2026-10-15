import { describe, expect, it } from "vitest";
import { InvalidUrlError } from "../url";
import {
  discoverSubstackPosts,
  substackPublicationRoot,
  type SubstackFetch,
  type SubstackFetchResponse,
} from "./discover";
import { createRateLimitedFetch } from "./fetcher";
import { classifySubstackLink, normalizeSubstackPostUrl } from "./links";

function archivePost(n: number, date: string, audience = "everyone") {
  return {
    canonical_url: `https://pub.example.com/p/post-${n}?utm=x`,
    slug: `post-${n}`,
    title: `Post ${n}`,
    post_date: `${date}T10:00:00.000Z`,
    audience,
  };
}

function fakeFetch(routes: Record<string, SubstackFetchResponse | (() => SubstackFetchResponse)>) {
  const calls: string[] = [];
  const fetch: SubstackFetch = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return { status: 404, url, text: "" };
    return typeof route === "function" ? route() : route;
  };
  return { fetch, calls };
}

const api = (offset: number) =>
  `https://pub.example.com/api/v1/archive?sort=new&offset=${offset}&limit=50`;

describe("substackPublicationRoot", () => {
  it("accepts bare hosts, archive pages and post links", () => {
    expect(substackPublicationRoot("name.substack.com")).toBe("https://name.substack.com");
    expect(substackPublicationRoot("https://name.substack.com/archive?sort=new")).toBe(
      "https://name.substack.com",
    );
    expect(substackPublicationRoot("https://www.custom.com/p/hello")).toBe(
      "https://www.custom.com",
    );
    expect(substackPublicationRoot("https://open.substack.com/pub/name/p/x")).toBe(
      "https://name.substack.com",
    );
  });

  it("rejects substack.com profile links", () => {
    expect(() => substackPublicationRoot("https://substack.com/@someone")).toThrow(InvalidUrlError);
  });
});

describe("discoverSubstackPosts", () => {
  it("pages through the archive API until an empty page", async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => archivePost(i, "2026-09-01"));
    const { fetch, calls } = fakeFetch({
      [api(0)]: { status: 200, url: api(0), text: JSON.stringify(firstPage) },
      [api(50)]: {
        status: 200,
        url: api(50),
        text: JSON.stringify([archivePost(50, "2026-08-01", "only_paid")]),
      },
      [api(51)]: { status: 200, url: api(51), text: "[]" },
    });
    const posts = await discoverSubstackPosts("pub.example.com", fetch);
    expect(calls).toEqual([api(0), api(50), api(51)]);
    expect(posts).toHaveLength(51);
    expect(posts[0]).toEqual({
      url: "https://pub.example.com/p/post-0",
      title: "Post 0",
      published: "2026-09-01",
      access: "free",
    });
    expect(posts[50]?.access).toBe("paid");
  });

  it("filters by date, exclusive on both ends", async () => {
    const page = [
      archivePost(1, "2026-09-03"),
      archivePost(2, "2026-09-02"),
      archivePost(3, "2026-09-01"),
    ];
    const { fetch } = fakeFetch({
      [api(0)]: { status: 200, url: api(0), text: JSON.stringify(page) },
      [api(3)]: { status: 200, url: api(3), text: "[]" },
    });
    const posts = await discoverSubstackPosts("https://pub.example.com", fetch, {
      after: "2026-09-01",
      before: "2026-09-03",
    });
    expect(posts.map((p) => p.title)).toEqual(["Post 2"]);
  });

  it("falls back to the sitemap when the API fails, keeping only this publication's posts", async () => {
    const sitemap = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://pub.example.com/p/older</loc><lastmod>2026-01-02</lastmod></url>
      <url><loc>https://pub.example.com/about</loc></url>
      <url><loc>https://elsewhere.com/p/not-ours</loc></url>
      <url><loc>https://pub.example.com/p/newer?a=1&amp;b=2</loc><lastmod>2026-03-04T00:00:00Z</lastmod></url>
    </urlset>`;
    const { fetch } = fakeFetch({
      [api(0)]: { status: 403, url: api(0), text: "" },
      "https://pub.example.com/sitemap.xml": { status: 200, url: "", text: sitemap },
    });
    const posts = await discoverSubstackPosts("pub.example.com", fetch);
    expect(posts).toEqual([
      {
        url: "https://pub.example.com/p/newer",
        title: null,
        published: "2026-03-04",
        access: null,
      },
      {
        url: "https://pub.example.com/p/older",
        title: null,
        published: "2026-01-02",
        access: null,
      },
    ]);
  });

  it("fails as a whole when neither source works", async () => {
    const { fetch } = fakeFetch({});
    await expect(discoverSubstackPosts("pub.example.com", fetch)).rejects.toThrow(
      "Couldn't list the posts of pub.example.com",
    );
  });
});

describe("createRateLimitedFetch", () => {
  it("waits for Retry-After on 429 and then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const raw: SubstackFetch = async (url) =>
      ++n === 1 ? { status: 429, url, text: "", retryAfter: 3 } : { status: 200, url, text: "ok" };
    const fetch = createRateLimitedFetch(raw, {
      ratePerSecond: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await fetch("https://x/");
    expect(res.text).toBe("ok");
    expect(sleeps).toContain(3000);
  });

  it("gives up with a readable error", async () => {
    const raw: SubstackFetch = async (url) => ({ status: 429, url, text: "" });
    const fetch = createRateLimitedFetch(raw, { maxRetries: 2, sleep: async () => {} });
    await expect(fetch("https://x/")).rejects.toThrow("Substack is limiting requests");
  });
});

describe("classifySubstackLink", () => {
  it("tells posts from publications", () => {
    expect(classifySubstackLink("https://name.substack.com/p/hello")).toBe("post");
    expect(classifySubstackLink("https://www.custom.com/p/hello?utm=1")).toBe("post");
    expect(classifySubstackLink("https://open.substack.com/pub/name/p/hello")).toBe("post");
    expect(classifySubstackLink("https://name.substack.com")).toBe("publication");
    expect(classifySubstackLink("https://name.substack.com/archive")).toBe("publication");
    expect(classifySubstackLink("https://substack.com/@name")).toBeNull();
    expect(classifySubstackLink("https://grokipedia.com/page/X")).toBeNull();
  });

  it("normalizes open.substack.com links", () => {
    expect(normalizeSubstackPostUrl("https://open.substack.com/pub/Name/p/hello?r=2")).toBe(
      "https://name.substack.com/p/hello",
    );
  });
});
