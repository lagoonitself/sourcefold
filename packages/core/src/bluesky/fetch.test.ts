import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchResponse } from "../source-fetch";
import { SourceError } from "../source-fetch";
import { blueskyResolveHandleUrl, blueskyThreadUrl, fetchBlueskyCapture } from "./fetch";

const here = dirname(fileURLToPath(import.meta.url));
const realThread: unknown = JSON.parse(readFileSync(join(here, "fixtures", "thread.json"), "utf8"));

const JAY_DID = "did:plc:oky5czdrnfjpqslsw2a5iclo";
const ROOT_RKEY = "3mwf5nyhfh22i";

function json(body: unknown, status = 200): SourceFetchResponse {
  return { status, url: "", headers: {}, text: JSON.stringify(body) };
}

function fakeFetch(routes: Record<string, SourceFetchResponse | Error>, calls: string[] = []) {
  const fetcher: SourceFetch = async (request) => {
    calls.push(request.url);
    const route = routes[request.url];
    if (!route) return { status: 404, url: "", headers: {}, text: "" };
    if (route instanceof Error) throw route;
    return route;
  };
  return fetcher;
}

function post(
  did: string,
  handle: string,
  rkey: string,
  text: string,
  extra: Record<string, unknown> = {},
  recordExtra: Record<string, unknown> = {},
) {
  return {
    uri: `at://${did}/app.bsky.feed.post/${rkey}`,
    author: { did, handle, displayName: handle === "a.test" ? "Ann" : "" },
    record: {
      $type: "app.bsky.feed.post",
      createdAt: "2026-10-15T23:30:00.000Z",
      text,
      ...recordExtra,
    },
    ...extra,
  };
}

function threadOf(thread: unknown) {
  return { thread: { $type: "app.bsky.feed.defs#threadViewPost", ...(thread as object) } };
}

const link = (handle: string, rkey: string) => `https://bsky.app/profile/${handle}/post/${rkey}`;

describe("fetchBlueskyCapture with a real thread", () => {
  it("builds a thread capture", async () => {
    const calls: string[] = [];
    const fetcher = fakeFetch({ [blueskyThreadUrl(JAY_DID, ROOT_RKEY)]: json(realThread) }, calls);
    const result = await fetchBlueskyCapture(link(JAY_DID, ROOT_RKEY), { fetch: fetcher });

    expect(calls).toEqual([blueskyThreadUrl(JAY_DID, ROOT_RKEY)]);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const { capture } = result;
    expect(result.kind).toBe("bluesky");
    expect(capture.url).toBe(link("jay.bsky.team", ROOT_RKEY));
    expect(capture.title).toBe("Thread by Jay 🦋 (@jay.bsky.team)");
    expect(Object.keys(capture.meta)).toEqual(["author", "author_url", "posted"]);
    expect(capture.meta).toEqual({
      author: "Jay 🦋",
      author_url: "https://bsky.app/profile/jay.bsky.team",
      posted: "2026-09-26",
    });
    expect(capture.markdown).toMatch(
      /^\*\*Jay 🦋\*\* \(@jay\.bsky\.team\) · 2026-09-26 · \[link\]\(https:\/\/bsky\.app\/profile\/jay\.bsky\.team\/post\/3mwf5nyhfh22i\)\n\nhappy mid-autumn festival! 🍂🌕\n\n!\[mooncake\]\(https:\/\/cdn\.bsky\.app\/img\/feed_fullsize\//,
    );
    expect(capture.markdown).toContain("low sugar beautiful heart");
    expect(capture.markdown).toContain("\n> **KyleIridian");
  });
});

describe("fetchBlueskyCapture", () => {
  it("resolves a handle first", async () => {
    const calls: string[] = [];
    const root = post("did:plc:ann", "a.test", "3aaa", "Hello");
    const fetcher = fakeFetch(
      {
        [blueskyResolveHandleUrl("a.test")]: json({ did: "did:plc:ann" }),
        [blueskyThreadUrl("did:plc:ann", "3aaa")]: json(threadOf({ post: root })),
      },
      calls,
    );
    const result = await fetchBlueskyCapture(link("A.Test", "3aaa"), { fetch: fetcher });
    expect(calls).toEqual([
      blueskyResolveHandleUrl("a.test"),
      blueskyThreadUrl("did:plc:ann", "3aaa"),
    ]);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.capture.title).toBe("Post by Ann (@a.test)");
    expect(result.capture.url).toBe(link("a.test", "3aaa"));
    expect(result.capture.markdown).toBe(
      `**Ann** (@a.test) · 2026-10-15 · [link](${link("a.test", "3aaa")})\n\nHello`,
    );
  });

  it("nests other people's replies and keeps the author's chain at top level", async () => {
    const root = post("did:plc:ann", "a.test", "3aaa", "One");
    const second = post("did:plc:ann", "a.test", "3aab", "Two");
    const other = post("did:plc:bob", "b.test", "3bbb", "Nice");
    const deeper = post("did:plc:cy", "c.test", "3ccc", "Agreed");
    const body = threadOf({
      post: root,
      replies: [
        { post: other, replies: [{ post: deeper, replies: [] }] },
        { post: second, replies: [] },
      ],
    });
    const fetcher = fakeFetch({ [blueskyThreadUrl("did:plc:ann", "3aaa")]: json(body) });
    const result = await fetchBlueskyCapture(link("did:plc:ann", "3aaa"), { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.capture.title).toBe("Thread by Ann (@a.test)");
    const lines = result.capture.markdown.split("\n");
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(at("One")).toBeLessThan(at("**b.test**"));
    expect(at("**b.test**")).toBeLessThan(at("**c.test**"));
    expect(at("**c.test**")).toBeLessThan(at("Two"));
    expect(lines[at("**b.test**")]).toMatch(/^> \*\*b\.test\*\* /);
    expect(lines[at("**b.test**") + 1]).toBe(">");
    expect(lines[at("Nice")]).toBe("> Nice");
    expect(lines[at("**c.test**")]).toMatch(/^> > \*\*c\.test\*\* /);
    expect(lines[at("**c.test**") + 1]).toBe("> >");
    expect(
      lines[at("**Ann** (@a.test) · 2026-10-15 · [link](" + link("a.test", "3aab"))],
    ).toBeDefined();
  });

  it("writes images, link cards and facets", async () => {
    const root = post(
      "did:plc:ann",
      "a.test",
      "3aaa",
      "see é example.com now",
      {
        embed: {
          $type: "app.bsky.embed.recordWithMedia#view",
          media: {
            $type: "app.bsky.embed.images#view",
            images: [
              {
                fullsize: "https://cdn.test/full.jpg",
                thumb: "https://cdn.test/t.jpg",
                alt: "A cat",
              },
            ],
          },
          record: { record: { $type: "app.bsky.embed.record#viewRecord" } },
        },
      },
      {
        facets: [
          {
            index: { byteStart: 7, byteEnd: 18 },
            features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/" }],
          },
        ],
      },
    );
    const card = post("did:plc:ann", "a.test", "3aab", "Card", {
      embed: {
        $type: "app.bsky.embed.external#view",
        external: { uri: "https://news.test/a", title: "News [1]", description: "" },
      },
    });
    const body = threadOf({ post: root, replies: [{ post: card, replies: [] }] });
    const fetcher = fakeFetch({ [blueskyThreadUrl("did:plc:ann", "3aaa")]: json(body) });
    const result = await fetchBlueskyCapture(link("did:plc:ann", "3aaa"), { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected ok");
    const md = result.capture.markdown;
    expect(md).toContain("see é [example.com](https://example.com/) now");
    expect(md).toContain("![A cat](https://cdn.test/full.jpg)");
    expect(md).toContain("[News 1](https://news.test/a)");
  });

  it("quotes another post", async () => {
    const root = post("did:plc:ann", "a.test", "3aaa", "Look", {
      embed: {
        $type: "app.bsky.embed.record#view",
        record: {
          $type: "app.bsky.embed.record#viewRecord",
          uri: "at://did:plc:bob/app.bsky.feed.post/3bbb",
          author: { did: "did:plc:bob", handle: "b.test" },
          value: { text: "Original\nthought" },
          embeds: [
            {
              $type: "app.bsky.embed.images#view",
              images: [{ fullsize: "https://cdn.test/q.jpg", alt: "" }],
            },
          ],
        },
      },
    });
    const fetcher = fakeFetch({
      [blueskyThreadUrl("did:plc:ann", "3aaa")]: json(threadOf({ post: root })),
    });
    const result = await fetchBlueskyCapture(link("did:plc:ann", "3aaa"), { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.capture.markdown).toContain(
      `Quoting [@b.test](${link("b.test", "3bbb")})\n\n> Original\n> thought\n>\n> ![](https://cdn.test/q.jpg)`,
    );
  });

  it("limits nesting depth to 4 levels and posts to 200", async () => {
    let chain: unknown = null;
    for (let i = 8; i >= 1; i--) {
      chain = {
        post: post(`did:plc:u${i}`, `u${i}.test`, `3d${i}`, `level ${i}`),
        replies: chain ? [chain] : [],
      };
    }
    const wide = Array.from({ length: 250 }, (_, i) => ({
      post: post("did:plc:w", "w.test", `3w${i}`, `wide ${i}`),
      replies: [],
    }));
    const root = post("did:plc:ann", "a.test", "3aaa", "Root");
    const fetcher = fakeFetch({
      [blueskyThreadUrl("did:plc:ann", "3aaa")]: json(
        threadOf({ post: root, replies: [chain, ...wide] }),
      ),
    });
    const result = await fetchBlueskyCapture(link("did:plc:ann", "3aaa"), { fetch: fetcher });
    if (result.status !== "ok") throw new Error("expected ok");
    const md = result.capture.markdown;
    expect(md).toContain("level 4");
    expect(md).not.toContain("level 5");
    expect((md.match(/ · \[link\]\(/g) ?? []).length).toBe(200);
  });

  it("maps failures to errors", async () => {
    const run = async (fetcher: SourceFetch, url = link("did:plc:ann", "3aaa")) => {
      try {
        await fetchBlueskyCapture(url, { fetch: fetcher });
      } catch (error) {
        return error;
      }
      return null;
    };
    const threadUrl = blueskyThreadUrl("did:plc:ann", "3aaa");
    const code = (error: unknown) => (error instanceof SourceError ? error.code : String(error));

    expect(code(await run(fakeFetch({}), "https://bsky.app/profile/x"))).toBe("invalid_url");
    expect(code(await run(fakeFetch({ [threadUrl]: json({}, 400) })))).toBe("not_found");
    expect(
      code(
        await run(
          fakeFetch({
            [threadUrl]: json({ thread: { $type: "app.bsky.feed.defs#notFoundPost", uri: "x" } }),
          }),
        ),
      ),
    ).toBe("not_found");
    expect(
      code(
        await run(
          fakeFetch({
            [threadUrl]: json({ thread: { $type: "app.bsky.feed.defs#blockedPost", uri: "x" } }),
          }),
        ),
      ),
    ).toBe("not_found");
    expect(code(await run(fakeFetch({ [threadUrl]: json({}, 429) })))).toBe("blocked");
    expect(code(await run(fakeFetch({ [threadUrl]: json({}, 502) })))).toBe("fetch_failed");
    expect(code(await run(fakeFetch({ [threadUrl]: new Error("offline") })))).toBe("fetch_failed");
    expect(code(await run(fakeFetch({ [threadUrl]: json({ nope: 1 }) })))).toBe("parse_failed");
    expect(
      code(
        await run(
          fakeFetch({ [blueskyResolveHandleUrl("a.test")]: json({ error: "x" }, 400) }),
          link("a.test", "3aaa"),
        ),
      ),
    ).toBe("not_found");
  });
});
