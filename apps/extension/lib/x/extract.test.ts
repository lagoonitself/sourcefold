import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { convertPhotoUrl, extractMediaFromArticle, extractXThread } from "./extract";

function makeDoc(html: string): Document {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return document as unknown as Document;
}

describe("convertPhotoUrl", () => {
  it("converts standard photo url with format and name params", () => {
    expect(
      convertPhotoUrl("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_?format=jpg&name=900x900"),
    ).toBe("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.jpg?name=orig");
  });

  it("converts png photo url", () => {
    expect(
      convertPhotoUrl("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_?format=png&name=large"),
    ).toBe("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.png?name=orig");
  });

  it("defaults to jpg when format param is missing", () => {
    expect(convertPhotoUrl("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_?name=small")).toBe(
      "https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.jpg?name=orig",
    );
    expect(convertPhotoUrl("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_")).toBe(
      "https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.jpg?name=orig",
    );
  });

  it("preserves extension from path if format is not in query", () => {
    expect(convertPhotoUrl("https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.webp?name=360x360")).toBe(
      "https://pbs.twimg.com/media/GZb_z7pWoAAc0q_.webp?name=orig",
    );
  });

  it("rejects non-https, invalid host, or invalid path", () => {
    expect(convertPhotoUrl("http://pbs.twimg.com/media/xyz?format=jpg")).toBeNull();
    expect(convertPhotoUrl("https://pbs.twimg.com.evil.com/media/xyz?format=jpg")).toBeNull();
    expect(convertPhotoUrl("https://pbs.twimg.com/profile_images/xyz.jpg")).toBeNull();
    expect(convertPhotoUrl("not-a-url")).toBeNull();
  });
});

describe("extractMediaFromArticle", () => {
  it("extracts a photo grid of 2 with alt text", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/photo1?format=jpg&name=medium" alt="Sunset over mountains" />
        </div>
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/photo2?format=png&name=large" alt="Ocean waves" />
        </div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    const media = extractMediaFromArticle(article);

    expect(media).toEqual([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/photo1.jpg?name=orig",
        alt: "Sunset over mountains",
      },
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/photo2.png?name=orig",
        alt: "Ocean waves",
      },
    ]);
  });

  it("handles alt text edge cases: empty or 'Image' becomes null", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/photo1?format=jpg" alt="Image" />
        </div>
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/photo2?format=jpg" alt="" />
        </div>
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/photo3?format=jpg" alt="   " />
        </div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    const media = extractMediaFromArticle(article);

    expect(media).toEqual([
      { type: "photo", url: "https://pbs.twimg.com/media/photo1.jpg?name=orig", alt: null },
      { type: "photo", url: "https://pbs.twimg.com/media/photo2.jpg?name=orig", alt: null },
      { type: "photo", url: "https://pbs.twimg.com/media/photo3.jpg?name=orig", alt: null },
    ]);
  });

  it("extracts a GIF video and strips query parameters", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="videoPlayer">
          <div data-testid="videoComponent">
            <video src="https://video.twimg.com/tweet_video/GZcde123.mp4?tag=14"></video>
          </div>
        </div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    const media = extractMediaFromArticle(article);

    expect(media).toEqual([
      {
        type: "gif",
        url: "https://video.twimg.com/tweet_video/GZcde123.mp4",
        alt: null,
      },
    ]);
  });

  it("extracts a regular video once, without double counting nested player and component", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="videoPlayer">
          <div data-testid="videoComponent">
            <video src="blob:https://x.com/random-uuid"></video>
          </div>
        </div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    const media = extractMediaFromArticle(article);

    expect(media).toEqual([
      {
        type: "video",
        durationSeconds: null,
      },
    ]);
  });

  it("does NOT pick up photos or media inside a quoted post", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/ownPhoto?format=jpg" alt="Author's own photo" />
        </div>
        <div role="link">
          <div data-testid="User-Name">
            <a href="/quotedUser">Quoted Author</a>
          </div>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quotedPhoto?format=jpg" alt="Quoted photo" />
          </div>
          <div data-testid="videoPlayer">
            <video src="blob:https://x.com/quoted-video"></video>
          </div>
        </div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    const media = extractMediaFromArticle(article);

    expect(media).toEqual([
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/ownPhoto.jpg?name=orig",
        alt: "Author's own photo",
      },
    ]);
  });

  it("returns an empty array when there is no media", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="tweetText">Just some text</div>
      </article>
    `);
    const article = doc.querySelector("article")!;
    expect(extractMediaFromArticle(article)).toEqual([]);
  });
});

describe("extractXThread with media", () => {
  it("extracts posts with their media attached in full thread extraction", () => {
    const doc = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/alice">Alice</a>
          <span>@alice</span>
        </div>
        <time datetime="2026-10-21T10:00:00.000Z">
          <a href="/alice/status/1000000000000000001">Oct 21</a>
        </time>
        <div data-testid="tweetText">Hello with photo</div>
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/sample_img?format=jpg&name=orig" alt="Sample" />
        </div>
      </article>
    `);

    const res = extractXThread(doc, "https://x.com/alice/status/1000000000000000001");
    expect(res.status).toBe("ok");
    if (res.status === "ok") {
      expect(res.posts).toHaveLength(1);
      expect(res.posts[0]?.media).toEqual([
        {
          type: "photo",
          url: "https://pbs.twimg.com/media/sample_img.jpg?name=orig",
          alt: "Sample",
        },
      ]);
    }
  });
});

describe("extractXThread author name trimming", () => {
  it("trims trailing bullets ' •' and middle dots ' ·' from author display names", () => {
    const docBullet = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/alice">Alice •</a>
          <span>@alice</span>
        </div>
        <time datetime="2026-10-21T10:00:00.000Z">
          <a href="/alice/status/1000000000000000001">Oct 21</a>
        </time>
        <div data-testid="tweetText">Hello</div>
      </article>
    `);
    const resBullet = extractXThread(docBullet, "https://x.com/alice/status/1000000000000000001");
    expect(resBullet.status).toBe("ok");
    if (resBullet.status === "ok") {
      expect(resBullet.posts[0]?.authorName).toBe("Alice");
    }

    const docDot = makeDoc(`
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/bob">Bob ·</a>
          <span>@bob</span>
        </div>
        <time datetime="2026-10-21T10:00:00.000Z">
          <a href="/bob/status/1000000000000000002">Oct 21</a>
        </time>
        <div data-testid="tweetText">World</div>
      </article>
    `);
    const resDot = extractXThread(docDot, "https://x.com/bob/status/1000000000000000002");
    expect(resDot.status).toBe("ok");
    if (resDot.status === "ok") {
      expect(resDot.posts[0]?.authorName).toBe("Bob");
    }
  });
});
