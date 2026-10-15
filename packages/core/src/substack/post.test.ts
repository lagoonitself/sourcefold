import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { extractSubstack } from "./extract";
import { parseSubstackPreloads } from "./preloads";

interface PageOptions {
  audience?: string;
  bodyHtml?: string;
  title?: string;
  pagePaywall?: boolean;
}

// Mirrors a real post page: the data sits in window._preloads as a JSON string literal.
function postPage({
  audience = "everyone",
  bodyHtml = "<p>Hello world.</p>",
  title = "The Slow AI Case",
  pagePaywall = false,
}: PageOptions = {}): string {
  const preloads = {
    canonicalUrl: "https://letters.example.com/p/slow-ai",
    post: {
      title,
      subtitle: "Why it takes longer than markets expect.",
      body_html: bodyHtml,
      canonical_url: "https://letters.example.com/p/slow-ai",
      post_date: "2026-09-01T12:00:00.000Z",
      audience,
      type: "newsletter",
      publishedBylines: [
        { name: "Alice Morgan", handle: "alicemorgan" },
        { name: "Bo Chen", handle: "bochen" },
      ],
    },
    pub: { name: "Example Letters", base_url: "https://letters.example.com" },
  };
  const literal = JSON.stringify(JSON.stringify(preloads)).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><title>x</title></head><body>
<div class="post">${pagePaywall ? '<div class="paywall">Subscribe</div>' : ""}</div>
<script>window._preloads        = JSON.parse(${literal})</script>
</body></html>`;
}

function extract(html: string) {
  const { document } = parseHTML(html);
  return extractSubstack(
    document as unknown as Document,
    "https://letters.example.com/p/slow-ai?r=1",
  );
}

describe("parseSubstackPreloads", () => {
  it("decodes the JSON string literal", () => {
    const parsed = parseSubstackPreloads(postPage({ bodyHtml: '<p>Quote "x" \\ y</p>' }));
    expect(parsed?.post?.title).toBe("The Slow AI Case");
    expect(parsed?.post?.bodyHtml).toBe('<p>Quote "x" \\ y</p>');
    expect(parsed?.pub?.name).toBe("Example Letters");
  });

  it("returns null without preloads", () => {
    expect(parseSubstackPreloads("<html><body>nothing</body></html>")).toBeNull();
  });
});

describe("extractSubstack with preloads", () => {
  it("reads metadata from the post data", () => {
    const result = extract(postPage());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const { markdown, ...meta } = result.capture;
    expect(meta).toEqual({
      url: "https://letters.example.com/p/slow-ai",
      title: "The Slow AI Case",
      subtitle: "Why it takes longer than markets expect.",
      author: "Alice Morgan, Bo Chen",
      authorUrl: "https://substack.com/@alicemorgan",
      publication: "Example Letters",
      publicationUrl: "https://letters.example.com/",
      published: "2026-09-01T12:00:00.000Z",
      access: "free",
    });
    expect(markdown).toBe("Hello world.\n");
  });

  it("keeps images as Markdown images with their captions, using the original upload", () => {
    const attrs = JSON.stringify({
      src: "https://substack-post-media.s3.amazonaws.com/public/images/abc_1630x1630.jpeg",
      alt: "Chart [GDP]",
    }).replace(/"/g, "&quot;");
    const body = [
      "<p>Intro.</p>",
      `<div class="captioned-image-container"><figure><a class="image-link image2" href="https://substackcdn.com/image/fetch/x"><div class="image2-inset"><picture><source srcset="https://substackcdn.com/a.webp 424w"><img src="https://substackcdn.com/image/fetch/w_1456/a.jpeg" width="724" data-attrs="${attrs}"></picture></div></a><figcaption class="image-caption">Source: <a href="https://fred.stlouisfed.org/">FRED</a></figcaption></figure></div>`,
      '<p><img src="https://example.com/plain(1).png" alt="Plain"></p>',
      '<p><img src="https://example.com/pixel.gif" width="1" height="1"></p>',
      "<p>Outro.</p>",
    ].join("");
    const result = extract(postPage({ bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe(
      [
        "Intro.",
        "![Chart \\[GDP\\]](https://substack-post-media.s3.amazonaws.com/public/images/abc_1630x1630.jpeg)",
        "*Source: [FRED](https://fred.stlouisfed.org/)*",
        "![Plain](https://example.com/plain%281%29.png)",
        "Outro.",
      ].join("\n\n") + "\n",
    );
  });

  it("keeps every image of a gallery", () => {
    const attrs = JSON.stringify({
      gallery: {
        images: [{ src: "https://cdn.example/1.png" }, { src: "https://cdn.example/2.png" }],
        caption: "Two views",
      },
    }).replace(/"/g, "&quot;");
    const body = `<p>a</p><div class="image-gallery-embed" data-attrs="${attrs}"></div><p>b</p>`;
    const result = extract(postPage({ bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe(
      "a\n\n![](https://cdn.example/1.png)\n\n![](https://cdn.example/2.png)\n\n*Two views*\n\nb\n",
    );
  });

  it("drops widgets and the repeated title, and keeps embeds as links", () => {
    const body = [
      "<h1>The Slow AI Case</h1>",
      "<p>Intro.</p>",
      '<div class="captioned-image-container"><figure><a class="image-link" href="x"><picture><img src="https://substackcdn.com/a.png"></picture></a><figcaption class="image-caption">A chart</figcaption></figure></div>',
      '<div class="subscription-widget-wrap"><p>Subscribe now</p><button>Go</button></div>',
      '<p class="button-wrapper"><a class="button" href="https://x/subscribe">Share</a></p>',
      `<div class="youtube-wrap" data-attrs='{"videoId":"abc123"}'><iframe src="x"></iframe></div>`,
      "<p>Outro.</p>",
    ].join("");
    const result = extract(postPage({ bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe(
      "Intro.\n\n![](https://substackcdn.com/a.png)\n\n*A chart*\n\n[YouTube video](https://www.youtube.com/watch?v=abc123)\n\nOutro.\n",
    );
  });

  it("shifts headings so the body starts at ## when the post uses h1", () => {
    const body = "<h1>Part one</h1><p>a</p><h2>Detail</h2><p>b</p>";
    const result = extract(postPage({ bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe("## Part one\n\na\n\n### Detail\n\nb\n");
  });

  it("leaves h2 and lower alone", () => {
    const result = extract(postPage({ bodyHtml: "<h3>Part</h3><p>a</p>" }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe("### Part\n\na\n");
  });

  it("turns Substack footnotes into GFM footnotes", () => {
    const body =
      '<p>Claim<a class="footnote-anchor" data-component-name="FootnoteAnchorToDOM" id="footnote-anchor-1" href="#footnote-1">1</a>.</p>' +
      '<div class="footnote" data-component-name="FootnoteToDOM"><a id="footnote-1" href="#footnote-anchor-1" class="footnote-number">1</a><div class="footnote-content"><p>Source one.</p><p>More.</p></div></div>';
    const result = extract(postPage({ bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe("Claim[^1].\n\n[^1]: Source one. More.\n");
  });

  it("collapses blank lines", () => {
    const result = extract(postPage({ bodyHtml: "<p>a</p><p>&nbsp;</p><p></p><p>b</p>" }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).not.toMatch(/\n{3,}/);
  });

  it("reports a locked paid post as paywalled", () => {
    expect(extract(postPage({ audience: "only_paid", bodyHtml: "" }))).toEqual({
      status: "paywalled",
      url: "https://letters.example.com/p/slow-ai",
      title: "The Slow AI Case",
    });
  });

  it("reports a paid preview that stops at the paywall as paywalled", () => {
    const body =
      '<p>Free preview text.</p><div class="paywall-jump" data-component-name="PaywallToDOM"></div>';
    expect(extract(postPage({ audience: "only_paid", bodyHtml: body })).status).toBe("paywalled");
  });

  it("saves an unlocked paid post (subscriber cookie) with access paid", () => {
    const body =
      '<p>Free preview text.</p><div class="paywall-jump" data-component-name="PaywallToDOM"></div><p>The paid part of the article, long enough to count as real text.</p>';
    const result = extract(postPage({ audience: "only_paid", bodyHtml: body }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.access).toBe("paid");
    expect(result.capture.markdown).toContain("The paid part of the article");
  });

  it("gives a free post with no text a short body instead of failing", () => {
    const result = extract(postPage({ bodyHtml: "" }));
    if (result.status !== "ok") throw new Error(result.status);
    expect(result.capture.markdown).toBe(
      "This post has no text. Listen or watch it on Substack.\n",
    );
  });
});
