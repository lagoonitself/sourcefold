import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchRequest, SourceFetchResponse } from "../source-fetch";
import { fetchHackerNewsCapture } from "./fetch";
import { hackerNewsTextToMarkdown } from "./markdown";

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
}

interface Call {
  url: string;
}

type Handler = (request: SourceFetchRequest) => SourceFetchResponse | Error;

function fakeFetch(handler: Handler, calls: Call[] = []): SourceFetch {
  return async (request) => {
    calls.push({ url: request.url });
    const result = handler(request);
    if (result instanceof Error) throw result;
    return result;
  };
}

function jsonResponse(body: unknown, status = 200): SourceFetchResponse {
  return { status, url: "", headers: {}, text: JSON.stringify(body) };
}

function textResponse(text: string, status = 200): SourceFetchResponse {
  return { status, url: "", headers: {}, text };
}

const ITEM_URL = "https://news.ycombinator.com/item?id=42865527";
const API_URL = "https://hn.algolia.com/api/v1/items/42865527";

describe("fetchHackerNewsCapture", () => {
  it("builds the capture from the Algolia item JSON", async () => {
    const calls: Call[] = [];
    const fetcher = fakeFetch(() => jsonResponse(fixture("story.json")), calls);

    const result = await fetchHackerNewsCapture(`${ITEM_URL}&ref=top`, { fetch: fetcher });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(API_URL);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kind).toBe("hackernews");
    expect(result.capture.url).toBe(ITEM_URL);
    expect(result.capture.title).toBe(
      "OpenAI Furious DeepSeek Might Have Stolen All the Data OpenAI Stole from Us",
    );
    expect(Object.keys(result.capture.meta)).toEqual([
      "author",
      "posted",
      "points",
      "comments",
      "link",
    ]);
    expect(result.capture.meta).toEqual({
      author: "latexr",
      posted: "2025-01-29",
      points: 1361,
      comments: 7,
      link: "https://www.404media.co/openai-furious-deepseek-might-have-stolen-all-the-data-openai-stole-from-us/",
    });
    expect(result.capture.markdown).toBe(
      [
        "[https://www.404media.co/openai-furious-deepseek-might-have-stolen-all-the-data-openai-stole-from-us/](https://www.404media.co/openai-furious-deepseek-might-have-stolen-all-the-data-openai-stole-from-us/)",
        "",
        "## Comments",
        "",
        "**ChrisArchitect** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42865905)",
        "",
        "Earlier: [https://news.ycombinator.com/item?id=42861150](https://news.ycombinator.com/item?id=42861150)",
        "",
        "[https://news.ycombinator.com/item?id=42860888](https://news.ycombinator.com/item?id=42860888)",
        "",
        "**roshin** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42866322)",
        "",
        "I hate clickbait articles that try to make the bad guys seem like they're angry.",
        "",
        "> Both Bloomberg and the Financial Times are reporting that Microsoft and OpenAI have been probing whether DeepSeek improperly trained the R1 model",
        "",
        "The company openai is not angry, or furious, or enraged. They simply suspect that deepseek broke their usage agreement and are trying to verify that.",
        "",
        "> **csallen** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867549)",
        ">",
        "> I came here to say just this.",
        ">",
        "> Can we change the headline of this article to something more accurate and less clickbaity?",
        ">",
        '> The article unjustifiably labels OpenAI as "furious" despite surfacing zero evidence that that\'s how they actually feel, obviously in an attempt to paint them as hypocrites who are okay with copying others but are upset at being copied.',
        ">",
        "> This is a very dishonestly-framed and -advertised story.",
        ">",
        "> **ZeroTalent** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42869853)",
        ">",
        "> As I understand from Twitter, the issue explained in this article is not the actual case at hand. The issue is that they suspect them of stealing the o1 model with the weights via corporate espionage and optimizing it with Matrix Multiplication and other upgrades. That would explain why the outputs are nearly identical in some cases.",
        ">",
        "> I don't know how much of any of this is true. This is what I'm reading on Twitter today.",
        "",
        "**csallen** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867595)",
        "",
        'There is nothing in this article to suggest that OpenAI is "furious" or even upset. Zero evidence. It\'s total clickbait.',
        "",
        "And it's embarrassing that so many commenters on Hacker News who *want* to believe this storyline are just pretending that it's true despite the lack of evidence.",
        "",
        "> **sebastiennight** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867687)",
        ">",
        "> Such a perfect article title, but wasted on clickbait.",
        ">",
        "> **tim333** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42871832)",
        ">",
        "> It's funny though. There seem to be a lot of commenters on Hacker News who don't really get the sense of humor thing.",
      ].join("\n"),
    );
  });

  it("renders a comment item with its own text, links, code and deleted parents", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("comment.json")));
    const result = await fetchHackerNewsCapture(ITEM_URL, { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(result.capture.title).toBe("Comment by sneak");
    expect(result.capture.meta).toEqual({
      author: "sneak",
      posted: "2025-01-29",
      points: null,
      comments: 2,
      link: null,
    });
    expect(result.capture.markdown).toBe(
      [
        'There is nothing here to suggest that OpenAI is "furious". Zero evidence.',
        "",
        "It's clickbait, and the *only* reason people repeat it is that it fits the story they want to believe.",
        "",
        "Watch:",
        "",
        "```",
        "  if (headline !== body) {",
        '    return "clickbait";',
        "  }",
        "```",
        "",
        "## Comments",
        "",
        "**[deleted]** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867820)",
        "",
        "> **dang** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867901)",
        ">",
        "> We merged the two threads.",
        "",
        "**oarabbus_** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867687)",
        "",
        'This is the same conversation every time. "They trained on our data" is not an argument about legality, it\'s an argument about fairness.',
      ].join("\n"),
    );
  });

  it("keeps five levels of comments at most", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("deep.json")));
    const result = await fetchHackerNewsCapture(ITEM_URL, { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected a capture");

    expect(result.capture.markdown).toContain(
      "> > > > **user_4** · 2025-01-29 · [link](https://news.ycombinator.com/item?id=42867504)",
    );
    expect(result.capture.markdown).toContain("Level 4 of the chain.");
    expect(result.capture.markdown).not.toContain("Level 5 of the chain.");
    expect(result.capture.markdown).not.toContain("user_5");
  });

  it("counts only comments that still have text", () => {
    expect(hackerNewsTextToMarkdown("")).toBe("");
    expect(hackerNewsTextToMarkdown("   ")).toBe("");
  });

  it("explains a blocked request", async () => {
    const fetcher = fakeFetch(() => textResponse("blocked", 403));
    await expect(fetchHackerNewsCapture(ITEM_URL, { fetch: fetcher })).rejects.toMatchObject({
      code: "blocked",
      message: "Hacker News blocked this request. Try again in a minute.",
    });
  });

  it("reports rate limiting, a missing item and a server error", async () => {
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => textResponse("", 429)) }),
    ).rejects.toMatchObject({ code: "blocked" });
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => textResponse("", 404)) }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => textResponse("", 503)) }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("reports an offline connection and unreadable JSON", async () => {
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => new TypeError("offline")) }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => textResponse("<html>nope")) }),
    ).rejects.toMatchObject({ code: "parse_failed" });
    await expect(
      fetchHackerNewsCapture(ITEM_URL, { fetch: fakeFetch(() => jsonResponse("hello")) }),
    ).rejects.toMatchObject({ code: "parse_failed" });
  });

  it("rejects links that aren't Hacker News items", async () => {
    const fetcher = fakeFetch(() => jsonResponse(fixture("story.json")));
    await expect(
      fetchHackerNewsCapture("https://example.com/item?id=1", { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      fetchHackerNewsCapture("https://news.ycombinator.com/newest", { fetch: fetcher }),
    ).rejects.toMatchObject({ code: "invalid_url" });
  });
});
