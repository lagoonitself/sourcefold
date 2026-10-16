import { describe, expect, it } from "vitest";
import { chooseSourceRoute, sourceKindLabel } from "./capture-route";

describe("chooseSourceRoute", () => {
  it("routes YouTube videos and lists", () => {
    expect(chooseSourceRoute("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "text/html")).toEqual({
      type: "youtube-video",
    });
    expect(chooseSourceRoute("https://www.youtube.com/@someone", "text/html").type).toBe("error");
  });
  it("routes fetchable sources", () => {
    expect(
      chooseSourceRoute("https://www.reddit.com/r/test/comments/abc123/title/", "text/html"),
    ).toEqual({ type: "fetch" });
    expect(chooseSourceRoute("https://news.ycombinator.com/item?id=1", "text/html")).toEqual({
      type: "fetch",
    });
  });
  it("detects PDF tabs by content type", () => {
    expect(chooseSourceRoute("https://example.com/download?id=3", "application/pdf")).toEqual({
      type: "pdf-tab",
    });
  });
  it("uses the live page for everything else", () => {
    expect(chooseSourceRoute("https://example.com/post", "text/html")).toEqual({ type: "web" });
    expect(chooseSourceRoute("chrome://extensions", "text/html").type).toBe("error");
  });
  it("labels kinds", () => {
    expect(sourceKindLabel("hackernews")).toBe("Hacker News thread");
  });
});
