import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchRequest, SourceFetchResponse } from "../source-fetch";
import { fetchRedditCapture } from "./fetch";

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
}

interface Call {
  url: string;
  headers: Record<string, string>;
}

type Handler = (request: SourceFetchRequest) => SourceFetchResponse | Error;

function fakeFetch(handler: Handler, calls: Call[] = []): SourceFetch {
  return async (request) => {
    calls.push({ url: request.url, headers: request.headers ?? {} });
    const result = handler(request);
    if (result instanceof Error) throw result;
    return result;
  };
}

function jsonResponse(body: unknown, status = 200, url = ""): SourceFetchResponse {
  return { status, url, headers: {}, text: JSON.stringify(body) };
}

function textResponse(text: string, status = 200, url = ""): SourceFetchResponse {
  return { status, url, headers: {}, text };
}

const THREAD_URL = "https://www.reddit.com/r/cars/comments/1abc2d";

describe("fetchRedditCapture", () => {
  it("builds the capture from Reddit's post JSON", async () => {
    const calls: Call[] = [];
    const fetcher = fakeFetch(() => jsonResponse(fixture("thread.json")), calls);

    const result = await fetchRedditCapture("https://old.reddit.com/r/Cars/comments/1abc2d/", {
      fetch: fetcher,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://www.reddit.com/r/cars/comments/1abc2d.json?raw_json=1&limit=500&sort=top",
    );
    expect(calls[0]?.headers.Accept).toBe("application/json");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kind).toBe("reddit");
    expect(result.capture.url).toBe(THREAD_URL);
    expect(result.capture.title).toBe("Should I turbo my car?");
    expect(Object.keys(result.capture.meta)).toEqual([
      "subreddit",
      "author",
      "posted",
      "score",
      "comments",
    ]);
    expect(result.capture.meta).toEqual({
      subreddit: "cars",
      author: "op_user",
      posted: "2026-10-15",
      score: 532,
      comments: 87,
    });
    expect(result.capture.markdown).toBe(
      [
        "I'm thinking about a turbo kit for my car.",
        "",
        "It's a daily driver, so I'd rather not break anything.",
        "",
        "Thoughts?",
        "",
        "## Comments",
        "",
        "**u/gearhead** · 120 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c1/)",
        "",
        "Do the clutch first.",
        "",
        "> **u/op_user** · 40 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c2/)",
        ">",
        "> Good point, thanks.",
        ">",
        "> > **u/gearhead** · 12 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c3/)",
        "> >",
        "> > Mine lasted 90k miles on the stock clutch, then it started slipping.",
        "",
        "**u/tuner_tom** · 95 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c4/)",
        "",
        "What car is it? That changes everything.",
        "",
        "A stock GTI and a stock Miata are two different answers.",
        "",
        "> **u/op_user** · 30 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c5/)",
        ">",
        "> 2019 Golf GTI.",
        "",
        "**u/[deleted]** · 1 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c7/)",
        "",
        "[deleted]",
        "",
        "> **u/wrench_night** · 5 points · 2026-10-15 · [link](https://www.reddit.com/r/cars/comments/1abc2d/should_i_turbo_my_car/c8/)",
        ">",
        "> Same thing happened to my brother's Jetta.",
      ].join("\n"),
    );
  });

  it("skips `more` entries, removed comments and deleted comments without replies", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("thread.json")));
    const result = await fetchRedditCapture(THREAD_URL, { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected a capture");

    // `[removed]` with no replies and the `more` placeholder are both gone.
    expect(result.capture.markdown).not.toContain("[removed]");
    expect(result.capture.markdown).not.toContain("more1");
    // The deleted comment is kept for its reply, and reads as the replacement text Reddit sends.
    expect(result.capture.markdown).toContain("**u/[deleted]**");
  });

  it("renders a link post as a link line and leaves out the empty comments heading", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("link-post.json")));
    const result = await fetchRedditCapture("https://www.reddit.com/r/rust/comments/2def3e", {
      fetch: fetcher,
    });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(result.capture.title).toBe("Announcing a faster JSON parser");
    expect(result.capture.markdown).toBe(
      "[https://example.com/blog/faster-json?utm_source=reddit](https://example.com/blog/faster-json?utm_source=reddit)",
    );
    expect(result.capture.meta.author).toBe("parser_fan");
    expect(result.capture.meta.comments).toBe(0);
  });

  it("renders a gallery post as one image per item", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("gallery-post.json")));
    const result = await fetchRedditCapture("https://www.reddit.com/r/carporn/comments/3ghi4j", {
      fetch: fetcher,
    });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(result.capture.markdown).toBe(
      [
        "![](https://preview.redd.it/nurb1.jpg?width=4032&format=pjpg&auto=webp&s=a1b2c3)",
        "",
        "![](https://preview.redd.it/nurb2.jpg?width=4032&format=pjpg&auto=webp&s=d4e5f6)",
      ].join("\n"),
    );
  });

  it("follows a share link and reads the post it points at", async () => {
    const calls: Call[] = [];
    const fetcher = fakeFetch(
      (request) =>
        request.url.includes("/s/")
          ? textResponse("<html></html>", 200, THREAD_URL)
          : jsonResponse(fixture("thread.json")),
      calls,
    );

    const result = await fetchRedditCapture("https://www.reddit.com/r/cars/s/aBcDeF", {
      fetch: fetcher,
    });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(calls[0]?.url).toBe("https://www.reddit.com/r/cars/s/aBcDeF");
    expect(calls[1]?.url).toBe(
      "https://www.reddit.com/r/cars/comments/1abc2d.json?raw_json=1&limit=500&sort=top",
    );
    expect(result.capture.url).toBe(THREAD_URL);
  });

  it("reads a share link whose post is only named in the Location header", async () => {
    const fetcher = fakeFetch((request) =>
      request.url.includes("/s/")
        ? {
            status: 301,
            url: "",
            headers: { location: `${THREAD_URL}/should_i_turbo_my_car/` },
            text: "",
          }
        : jsonResponse(fixture("thread.json")),
    );

    const result = await fetchRedditCapture("https://www.reddit.com/r/cars/s/aBcDeF", {
      fetch: fetcher,
    });
    expect(result.status).toBe("ok");
  });

  it("uses a link with no subreddit", async () => {
    const calls: Call[] = [];
    const fetcher = fakeFetch(() => jsonResponse(fixture("thread.json")), calls);
    await fetchRedditCapture("https://redd.it/1abc2d", { fetch: fetcher });
    expect(calls[0]?.url).toBe(
      "https://www.reddit.com/comments/1abc2d.json?raw_json=1&limit=500&sort=top",
    );
  });

  it("explains a blocked request", async () => {
    const fetcher = fakeFetch(() => textResponse("blocked", 403));
    await expect(fetchRedditCapture(THREAD_URL, { fetch: fetcher })).rejects.toMatchObject({
      code: "blocked",
      message:
        "Reddit blocked this request. Save Reddit threads with the desktop app or the Sourcefold extension.",
    });
  });

  it("reports rate limiting, a missing post and a server error", async () => {
    await expect(
      fetchRedditCapture(THREAD_URL, { fetch: fakeFetch(() => textResponse("", 429)) }),
    ).rejects.toMatchObject({ code: "blocked" });
    await expect(
      fetchRedditCapture(THREAD_URL, { fetch: fakeFetch(() => textResponse("", 404)) }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      fetchRedditCapture(THREAD_URL, { fetch: fakeFetch(() => textResponse("", 503)) }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("reports an offline connection and unreadable JSON", async () => {
    await expect(
      fetchRedditCapture(THREAD_URL, { fetch: fakeFetch(() => new TypeError("offline")) }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
    await expect(
      fetchRedditCapture(THREAD_URL, { fetch: fakeFetch(() => textResponse("<html>nope")) }),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("treats a 200 with an error body as a missing post", async () => {
    const fetcher = fakeFetch(() => jsonResponse({ message: "Not Found", error: 404 }));
    await expect(fetchRedditCapture(THREAD_URL, { fetch: fetcher })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects links that aren't Reddit posts", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("thread.json")));
    await expect(
      fetchRedditCapture("https://example.com/r/cars", { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      fetchRedditCapture("https://www.reddit.com/r/cars", { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });

  it("keeps five levels of comments at most", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("deep.json")));
    const result = await fetchRedditCapture(THREAD_URL, { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(result.capture.markdown).toContain("> > > > xxx depth 4");
    expect(result.capture.markdown).not.toContain("depth 5");
    expect(result.capture.markdown).not.toContain("depth 6");
  });
});
