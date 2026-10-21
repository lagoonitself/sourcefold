import { describe, expect, it } from "vitest";
import { renderMarkdown, safeImageUrl } from "./render-markdown";

describe("renderMarkdown MP4 videos and images", () => {
  it("renders ![GIF](https://video.twimg.com/tweet_video/AB1.mp4) as video tag with autoplay loop muted playsinline and no img", () => {
    const html = renderMarkdown("![GIF](https://video.twimg.com/tweet_video/AB1.mp4)");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.mp4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });

  it("renders uppercase .MP4 as video tag too", () => {
    const html = renderMarkdown("![GIF](https://video.twimg.com/tweet_video/AB1.MP4)");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.MP4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });

  it("drops javascript: or data: URLs ending in .mp4 rendering neither video nor img", () => {
    const jsHtml = renderMarkdown("![GIF](javascript:alert(1).mp4)");
    expect(jsHtml).not.toContain("<video");
    expect(jsHtml).not.toContain("<img");

    const dataHtml = renderMarkdown("![GIF](data:video/mp4;base64,AAAA.mp4)");
    expect(dataHtml).not.toContain("<video");
    expect(dataHtml).not.toContain("<img");
  });

  it("still renders a normal .png image with img tag unchanged", () => {
    const html = renderMarkdown("![chart](https://example.com/pic.png)");
    expect(html).toContain(
      '<img src="https://example.com/pic.png" alt="chart" loading="lazy" decoding="async" referrerpolicy="no-referrer">',
    );
    expect(html).not.toContain("<video");
  });

  it("renders a GIF inside a blockquote as a video", () => {
    const html = renderMarkdown("> ![GIF](https://video.twimg.com/tweet_video/AB1.mp4)");
    expect(html).toContain("<blockquote>");
    expect(html).toContain(
      '<video src="https://video.twimg.com/tweet_video/AB1.mp4" autoplay loop muted playsinline></video>',
    );
    expect(html).not.toContain("<img");
  });

  it("recognizes safe image URLs", () => {
    expect(safeImageUrl("https://video.twimg.com/tweet_video/AB1.mp4")).toBe(
      "https://video.twimg.com/tweet_video/AB1.mp4",
    );
    expect(safeImageUrl("javascript:alert(1).mp4")).toBeNull();
    expect(safeImageUrl("data:video/mp4;base64,AAAA.mp4")).toBeNull();
  });
});
