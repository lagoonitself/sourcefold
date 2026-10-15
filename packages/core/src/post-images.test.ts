import { describe, expect, it } from "vitest";
import { markdownImageUrls, postImageFileNames, postImagesFolderName } from "./post-images";

describe("markdownImageUrls", () => {
  it("finds web image links once, in order, and skips plain links and local images", () => {
    const md = [
      "![Chart \\[GDP\\]](https://cdn.example/a.png)",
      "[not an image](https://example.com/page)",
      "![](https://cdn.example/b.jpeg)",
      "![again](https://cdn.example/a.png)",
      "![local](Title_files/c.png)",
    ].join("\n\n");
    expect(markdownImageUrls(md)).toEqual([
      "https://cdn.example/a.png",
      "https://cdn.example/b.jpeg",
    ]);
  });
});

describe("postImageFileNames", () => {
  it("uses the name the image has on the web, unwrapping Substack's CDN", () => {
    expect(
      postImageFileNames([
        "https://substack-post-media.s3.amazonaws.com/public/images/9a0a_1630x1630.jpeg",
        "https://substackcdn.com/image/fetch/w_1456,c_limit/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd46a_1320x450.png",
      ]),
    ).toEqual(["9a0a_1630x1630.jpeg", "d46a_1320x450.png"]);
  });

  it("numbers clashes and names images that have no usable name", () => {
    expect(
      postImageFileNames([
        "https://a.example/x/chart.PNG",
        "https://b.example/y/chart.png",
        "https://c.example/",
        "https://d.example/photo?id=1",
      ]),
    ).toEqual(["chart.png", "chart (2).png", "image-3.jpg", "photo.jpg"]);
  });
});

describe("postImagesFolderName", () => {
  it("sits next to the post's file", () => {
    expect(postImagesFolderName("Why AI Matters.md")).toBe("Why AI Matters_files");
    expect(postImagesFolderName("Why AI Matters (2).md")).toBe("Why AI Matters (2)_files");
  });
});
