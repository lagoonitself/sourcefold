import { describe, expect, it } from "vitest";
import { canonicalizeUrl, detectSource, extractUrls, InvalidUrlError, xStatusId } from "./url";

describe("canonicalizeUrl", () => {
  it("throws InvalidUrlError on unparseable input", () => {
    expect(() => canonicalizeUrl("not-a-url")).toThrow(InvalidUrlError);
    expect(() => canonicalizeUrl("")).toThrow(InvalidUrlError);
    expect(() => canonicalizeUrl("   ")).toThrow(InvalidUrlError);
  });

  it("throws InvalidUrlError on non-http(s) protocols", () => {
    expect(() => canonicalizeUrl("ftp://example.com/file")).toThrow(InvalidUrlError);
    expect(() => canonicalizeUrl("javascript:alert(1)")).toThrow(InvalidUrlError);
    expect(() => canonicalizeUrl("mailto:user@example.com")).toThrow(InvalidUrlError);
    expect(() => canonicalizeUrl("file:///C:/path/to/file")).toThrow(InvalidUrlError);
  });

  it("trims surrounding whitespace", () => {
    expect(canonicalizeUrl("  https://example.com/path  ")).toBe("https://example.com/path");
  });

  it("forces https protocol from http", () => {
    expect(canonicalizeUrl("http://example.com/articles")).toBe("https://example.com/articles");
  });

  it("lowercases host", () => {
    expect(canonicalizeUrl("https://EXAMPLE.COM/Path")).toBe("https://example.com/Path");
  });

  it("drops leading www. from host", () => {
    expect(canonicalizeUrl("https://www.example.com/page")).toBe("https://example.com/page");
    expect(canonicalizeUrl("https://WWW.EXAMPLE.COM/page")).toBe("https://example.com/page");
  });

  it("preserves non-www subdomains", () => {
    expect(canonicalizeUrl("https://blog.example.com/page")).toBe("https://blog.example.com/page");
    expect(canonicalizeUrl("https://deep.nested.domain.com/path")).toBe(
      "https://deep.nested.domain.com/path",
    );
  });

  it("keeps query parameters that pick the page, drops tracking ones and hashes", () => {
    expect(canonicalizeUrl("https://example.com/page?ref=feed&sort=top#section-2")).toBe(
      "https://example.com/page?sort=top",
    );
    expect(
      canonicalizeUrl("https://example.com/article.php?id=5&utm_source=x&UTM_MEDIUM=y&fbclid=z"),
    ).toBe("https://example.com/article.php?id=5");
    expect(canonicalizeUrl("https://example.com/article.php?id=6")).toBe(
      "https://example.com/article.php?id=6",
    );
  });

  it("drops the query on Substack posts", () => {
    expect(canonicalizeUrl("https://name.substack.com/p/a-post?r=abc")).toBe(
      "https://name.substack.com/p/a-post",
    );
    expect(canonicalizeUrl("https://www.noahpinion.blog/p/a-post?r=abc")).toBe(
      "https://noahpinion.blog/p/a-post",
    );
  });

  it("gives every form of a YouTube video one address", () => {
    for (const link of [
      "https://youtu.be/dQw4w9WgXcQ?t=42",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m2s",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123",
    ]) {
      expect(canonicalizeUrl(link)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    }
  });

  it("canonicalizes Reddit, Hacker News, Bluesky and arXiv links", () => {
    expect(canonicalizeUrl("https://old.reddit.com/r/Cars/comments/1abc2d/some_title/")).toBe(
      "https://www.reddit.com/r/cars/comments/1abc2d",
    );
    expect(canonicalizeUrl("https://news.ycombinator.com/item?id=41234567&p=2")).toBe(
      "https://news.ycombinator.com/item?id=41234567",
    );
    expect(canonicalizeUrl("https://bsky.app/profile/Jay.bsky.team/post/3l6oveex3ii2l")).toBe(
      "https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l",
    );
    expect(canonicalizeUrl("https://arxiv.org/pdf/2401.01234v2.pdf")).toBe(
      "https://arxiv.org/abs/2401.01234",
    );
  });

  it("removes trailing slashes from path", () => {
    expect(canonicalizeUrl("https://example.com/articles/topic/")).toBe(
      "https://example.com/articles/topic",
    );
    expect(canonicalizeUrl("https://example.com/articles/topic///")).toBe(
      "https://example.com/articles/topic",
    );
  });

  it("renders bare host without trailing slash", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(canonicalizeUrl("https://example.com")).toBe("https://example.com");
    expect(canonicalizeUrl("https://www.example.com/")).toBe("https://example.com");
  });

  it("preserves path case for generic URLs", () => {
    expect(canonicalizeUrl("https://example.com/Path/To/Resource")).toBe(
      "https://example.com/Path/To/Resource",
    );
  });

  it("canonicalizes Twitter and X hosts to x.com", () => {
    expect(canonicalizeUrl("https://twitter.com/")).toBe("https://x.com");
    expect(canonicalizeUrl("https://mobile.twitter.com/")).toBe("https://x.com");
    expect(canonicalizeUrl("https://x.com/")).toBe("https://x.com");
    expect(canonicalizeUrl("https://mobile.x.com/")).toBe("https://x.com");
    expect(canonicalizeUrl("https://www.twitter.com/")).toBe("https://x.com");
  });

  it("canonicalizes X status URLs: lowercases handle and drops query string", () => {
    expect(canonicalizeUrl("https://twitter.com/Jack/status/20?s=20")).toBe(
      "https://x.com/jack/status/20",
    );
  });

  it("canonicalizes X status URLs: trims trailing path segments like photo/1", () => {
    expect(canonicalizeUrl("https://x.com/user/status/123/photo/1")).toBe(
      "https://x.com/user/status/123",
    );
    expect(canonicalizeUrl("https://mobile.twitter.com/User/status/456/analytics")).toBe(
      "https://x.com/user/status/456",
    );
  });

  it("canonicalizes X /i/web/status/<id> URLs to /i/status/<id>", () => {
    expect(canonicalizeUrl("https://twitter.com/i/web/status/1234567890")).toBe(
      "https://x.com/i/status/1234567890",
    );
    expect(canonicalizeUrl("https://x.com/i/web/status/98765/en")).toBe(
      "https://x.com/i/status/98765",
    );
  });

  it("canonicalizes X /i/status/<id> URLs", () => {
    expect(canonicalizeUrl("https://x.com/i/status/55555")).toBe("https://x.com/i/status/55555");
  });

  it("preserves non-status paths on X", () => {
    expect(canonicalizeUrl("https://twitter.com/Jack")).toBe("https://x.com/Jack");
    expect(canonicalizeUrl("https://x.com/settings/profile/")).toBe(
      "https://x.com/settings/profile",
    );
  });

  it("canonicalizes Grokipedia page URLs: decodes %20 and replaces spaces with underscores", () => {
    expect(canonicalizeUrl("https://www.grokipedia.com/page/Impact%20of%20AI/")).toBe(
      "https://grokipedia.com/page/Impact_of_AI",
    );
  });

  it("canonicalizes Grokipedia page URLs with literal spaces and special characters", () => {
    expect(canonicalizeUrl("https://grokipedia.com/page/Impact%20of%20AI%20%26%20Robotics")).toBe(
      "https://grokipedia.com/page/Impact_of_AI_&_Robotics",
    );
  });

  it("re-encodes %, #, and ? in Grokipedia titles while remaining idempotent", () => {
    const urls = [
      "https://grokipedia.com/page/C%23",
      "https://grokipedia.com/page/What_If%3F",
      "https://grokipedia.com/page/100%25_Pure",
    ];

    expect(canonicalizeUrl("https://grokipedia.com/page/C%23")).toBe(
      "https://grokipedia.com/page/C%23",
    );
    expect(canonicalizeUrl("https://grokipedia.com/page/What_If%3F")).toBe(
      "https://grokipedia.com/page/What_If%3F",
    );
    expect(canonicalizeUrl("https://grokipedia.com/page/100%25_Pure")).toBe(
      "https://grokipedia.com/page/100%25_Pure",
    );

    for (const u of urls) {
      expect(canonicalizeUrl(canonicalizeUrl(u))).toBe(canonicalizeUrl(u));
    }
  });

  it("preserves decoded unicode titles and replaces spaces with underscores idempotently", () => {
    const unicodeUrl = "https://grokipedia.com/page/Émile_Zola";
    expect(canonicalizeUrl(unicodeUrl)).toBe("https://grokipedia.com/page/Émile_Zola");
    expect(canonicalizeUrl(canonicalizeUrl(unicodeUrl))).toBe(
      "https://grokipedia.com/page/Émile_Zola",
    );

    const spaceUrl = "https://grokipedia.com/page/Artificial Intelligence";
    expect(canonicalizeUrl(spaceUrl)).toBe("https://grokipedia.com/page/Artificial_Intelligence");
    expect(canonicalizeUrl(canonicalizeUrl(spaceUrl))).toBe(
      "https://grokipedia.com/page/Artificial_Intelligence",
    );
  });

  it("falls back to raw title on Grokipedia if decodeURIComponent throws", () => {
    expect(canonicalizeUrl("https://grokipedia.com/page/Malformed%E0%A4%A")).toBe(
      "https://grokipedia.com/page/Malformed%E0%A4%A",
    );
  });

  it("keeps non-page Grokipedia paths as is", () => {
    expect(canonicalizeUrl("https://www.grokipedia.com/about/")).toBe(
      "https://grokipedia.com/about",
    );
    expect(canonicalizeUrl("https://grokipedia.com/")).toBe("https://grokipedia.com");
  });

  it("canonicalizes Substack post URLs", () => {
    expect(canonicalizeUrl("https://example.substack.com/p/my-post?utm_source=x#footnote")).toBe(
      "https://example.substack.com/p/my-post",
    );
  });
});

describe("detectSource", () => {
  it("detects Grokipedia page URLs", () => {
    expect(detectSource("https://grokipedia.com/page/Impact_of_AI")).toBe("grokipedia");
    expect(detectSource("https://www.grokipedia.com/page/Quantum_Computing")).toBe("grokipedia");
  });

  it("returns null for non-page Grokipedia URLs", () => {
    expect(detectSource("https://grokipedia.com/")).toBeNull();
    expect(detectSource("https://grokipedia.com/about")).toBeNull();
    expect(detectSource("https://grokipedia.com/page/")).toBeNull();
  });

  it("detects X status URLs across supported hosts", () => {
    expect(detectSource("https://x.com/jack/status/20")).toBe("x");
    expect(detectSource("https://twitter.com/jack/status/20?s=20")).toBe("x");
    expect(detectSource("https://mobile.twitter.com/user/status/123/photo/1")).toBe("x");
    expect(detectSource("https://mobile.x.com/user/status/123")).toBe("x");
    expect(detectSource("https://www.twitter.com/i/web/status/999")).toBe("x");
    expect(detectSource("https://x.com/i/status/999")).toBe("x");
  });

  it("returns null for non-status X URLs", () => {
    expect(detectSource("https://x.com/jack")).toBeNull();
    expect(detectSource("https://twitter.com/home")).toBeNull();
    expect(detectSource("https://x.com/")).toBeNull();
  });

  it("detects Substack post URLs", () => {
    expect(detectSource("https://newsletter.substack.com/p/first-post")).toBe("substack");
    expect(detectSource("https://my-team.substack.com/p/weekly-update?s=r")).toBe("substack");
  });

  it("returns null for custom-domain Substacks and non-post Substack URLs", () => {
    expect(detectSource("https://astralcodexten.com/p/my-post")).toBeNull();
    expect(detectSource("https://substack.com/p/post")).toBeNull();
    expect(detectSource("https://newsletter.substack.com/about")).toBeNull();
    expect(detectSource("https://newsletter.substack.com/")).toBeNull();
  });

  it("returns null for unknown sources", () => {
    expect(detectSource("https://medium.com/@user/story")).toBeNull();
    expect(detectSource("https://wikipedia.org/wiki/AI")).toBeNull();
  });

  it("never throws on invalid or empty input", () => {
    expect(detectSource("")).toBeNull();
    expect(detectSource("not a url")).toBeNull();
    expect(detectSource("ftp://example.com")).toBeNull();
  });
});

describe("xStatusId", () => {
  it("extracts status ID from standard X status URLs", () => {
    expect(xStatusId("https://x.com/jack/status/20")).toBe("20");
    expect(xStatusId("https://twitter.com/user/status/1234567890123456789")).toBe(
      "1234567890123456789",
    );
  });

  it("extracts status ID with query params and subpaths", () => {
    expect(xStatusId("https://twitter.com/Jack/status/20?s=20")).toBe("20");
    expect(xStatusId("https://x.com/user/status/99999/photo/1")).toBe("99999");
  });

  it("extracts status ID from /i/web/status/ URLs", () => {
    expect(xStatusId("https://twitter.com/i/web/status/88888")).toBe("88888");
    expect(xStatusId("https://x.com/i/status/77777")).toBe("77777");
  });

  it("returns null for non-status X URLs", () => {
    expect(xStatusId("https://x.com/jack")).toBeNull();
    expect(xStatusId("https://twitter.com/")).toBeNull();
  });

  it("returns null for non-X URLs with /status/", () => {
    expect(xStatusId("https://example.com/user/status/123")).toBeNull();
  });

  it("returns null for invalid inputs without throwing", () => {
    expect(xStatusId("")).toBeNull();
    expect(xStatusId("invalid")).toBeNull();
  });
});

describe("extractUrls", () => {
  it("preserves balanced parentheses in URLs and strips unbalanced closing parens", () => {
    const text1 = "See https://grokipedia.com/page/Transformer_(machine_learning) for details.";
    expect(extractUrls(text1)).toEqual([
      "https://grokipedia.com/page/Transformer_(machine_learning)",
    ]);

    const text2 = "(see https://grokipedia.com/page/Foo).";
    expect(extractUrls(text2)).toEqual(["https://grokipedia.com/page/Foo"]);
  });

  it("extracts URLs from a messy multi-line paste with duplicates and trailing punctuation", () => {
    const text = `
      Check these out:
      1. https://twitter.com/Jack/status/20?s=20.
      2. <https://x.com/jack/status/20>
      3. (See https://www.grokipedia.com/page/Impact%20of%20AI/!)
      4. Duplicate: https://grokipedia.com/page/Impact_of_AI;
      5. Substack: https://example.substack.com/p/my-post?utm_source=x#footnote, and https://example.substack.com/p/my-post
      6. Invalid: https://
    `;

    const extracted = extractUrls(text);

    // 1st original form kept for each canonical URL:
    // https://twitter.com/Jack/status/20?s=20. -> trimmed to https://twitter.com/Jack/status/20?s=20
    // <https://x.com/jack/status/20> -> canonical is same, so skipped
    // https://www.grokipedia.com/page/Impact%20of%20AI/! -> trimmed to https://www.grokipedia.com/page/Impact%20of%20AI/
    // https://grokipedia.com/page/Impact_of_AI; -> canonical is same, so skipped
    // https://example.substack.com/p/my-post?utm_source=x#footnote, -> trimmed to https://example.substack.com/p/my-post?utm_source=x#footnote
    // 2nd substack link has same canonical URL, so skipped
    // invalid https:// skipped

    expect(extracted).toEqual([
      "https://twitter.com/Jack/status/20?s=20",
      "https://www.grokipedia.com/page/Impact%20of%20AI/",
      "https://example.substack.com/p/my-post?utm_source=x#footnote",
    ]);
  });

  it("trims trailing .,;:!?)]}'\" and > characters", () => {
    const text = `
      "https://example.com/one"
      'https://example.com/two'
      (https://example.com/three)
      [https://example.com/four]
      {https://example.com/five}
      <https://example.com/six>
      https://example.com/seven!
      https://example.com/eight?
      https://example.com/nine:
      https://example.com/ten;
      https://example.com/eleven,
      https://example.com/twelve.
    `;

    const result = extractUrls(text);
    expect(result).toEqual([
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three",
      "https://example.com/four",
      "https://example.com/five",
      "https://example.com/six",
      "https://example.com/seven",
      "https://example.com/eight",
      "https://example.com/nine",
      "https://example.com/ten",
      "https://example.com/eleven",
      "https://example.com/twelve",
    ]);
  });

  it("preserves order and ignores invalid URLs", () => {
    const text = `
      https://example.com/first
      not-a-url
      https://example.com/second
      ftp://unsupported.com
      https://example.com/third
    `;

    expect(extractUrls(text)).toEqual([
      "https://example.com/first",
      "https://example.com/second",
      "https://example.com/third",
    ]);
  });

  it("returns empty array when no URLs found", () => {
    expect(extractUrls("plain text without any links")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
  });
});
