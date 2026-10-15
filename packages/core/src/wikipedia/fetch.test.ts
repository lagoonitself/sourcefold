import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { WikipediaError, fetchWikipediaCapture } from "./fetch";

const fixtureHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures", "turbocharger.html"),
  "utf8",
);

const summary = {
  type: "standard",
  namespace: { id: 0, text: "" },
  titles: { canonical: "Turbocharger", normalized: "Turbocharger" },
  lang: "en",
  description: "Exhaust-powered forced-induction device for engines",
  revision: "1111",
  timestamp: "2026-09-01T00:00:00Z",
};

interface Call {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  responses: { html?: Response | Error; summary?: Response | Error },
  calls: Call[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const response = url.includes("/page/html/") ? responses.html : responses.summary;
    if (response instanceof Error) throw response;
    if (!response) return new Response("", { status: 404 });
    return response.clone();
  }) as typeof fetch;
}

const options = (fetchImpl: typeof fetch) => ({
  fetch: fetchImpl,
  parseHtml: (html: string) => parseHTML(html).document as unknown as Document,
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const html = (text = fixtureHtml, status = 200) => new Response(text, { status });

describe("fetchWikipediaCapture", () => {
  it("fetches the page and summary, and builds the capture", async () => {
    const calls: Call[] = [];
    const capture = await fetchWikipediaCapture(
      "https://en.m.wikipedia.org/wiki/Turbocharger#History",
      options(fakeFetch({ html: html(), summary: json(summary) }, calls)),
    );

    expect(calls.map((c) => c.url).sort()).toEqual([
      "https://en.wikipedia.org/api/rest_v1/page/html/Turbocharger",
      "https://en.wikipedia.org/api/rest_v1/page/summary/Turbocharger",
    ]);
    expect(calls[0]?.headers["Api-User-Agent"]).toMatch(/^Sourcefold\//);

    expect(capture.url).toBe("https://en.wikipedia.org/wiki/Turbocharger");
    expect(capture.title).toBe("Turbocharger");
    expect(capture.summary).toBe("Exhaust-powered forced-induction device for engines");
    expect(capture.language).toBe("en");
    // The revision and time come from the page itself, not the (possibly newer) summary.
    expect(capture.revision).toBe("1376335656");
    expect(capture.lastEdited).toBe("2026-09-23T14:44:34Z");
    expect(capture.markdown).toContain("## History");
    expect(capture.markdown.startsWith("![](")).toBe(true);
  });

  it("follows a redirect: the capture carries the title of the page it led to", async () => {
    const redirected = {
      ...summary,
      titles: { canonical: "Turbocharger", normalized: "Turbocharger" },
    };
    const capture = await fetchWikipediaCapture(
      "https://en.wikipedia.org/wiki/turbo",
      options(fakeFetch({ html: html(), summary: json(redirected) })),
    );
    expect(capture.url).toBe("https://en.wikipedia.org/wiki/Turbocharger");
    expect(capture.title).toBe("Turbocharger");
  });

  it("works without a summary, taking the title from the page", async () => {
    const capture = await fetchWikipediaCapture(
      "https://en.wikipedia.org/wiki/turbo",
      options(fakeFetch({ html: html(), summary: new Response("", { status: 500 }) })),
    );
    expect(capture.title).toBe("Turbocharger");
    expect(capture.url).toBe("https://en.wikipedia.org/wiki/Turbocharger");
    expect(capture.summary).toBeNull();
    expect(capture.language).toBe("en");
  });

  it("sends extra headers such as a server User-Agent", async () => {
    const calls: Call[] = [];
    await fetchWikipediaCapture("https://en.wikipedia.org/wiki/Turbocharger", {
      ...options(fakeFetch({ html: html(), summary: json(summary) }, calls)),
      headers: { "User-Agent": "Test/1.0" },
    });
    expect(calls[0]?.headers["User-Agent"]).toBe("Test/1.0");
  });

  it("rejects links that aren't Wikipedia articles", async () => {
    const fetchImpl = fakeFetch({});
    await expect(
      fetchWikipediaCapture("https://example.com/wiki/Car", options(fetchImpl)),
    ).rejects.toMatchObject({ code: "invalid_url" });
    await expect(
      fetchWikipediaCapture("https://en.wikipedia.org/wiki/Talk:Car", options(fetchImpl)),
    ).rejects.toMatchObject({ code: "not_article" });
  });

  it("reports a missing article", async () => {
    await expect(
      fetchWikipediaCapture(
        "https://en.wikipedia.org/wiki/Nope",
        options(fakeFetch({ html: new Response("", { status: 404 }), summary: json({}, 404) })),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports a network failure and a server error", async () => {
    await expect(
      fetchWikipediaCapture(
        "https://en.wikipedia.org/wiki/Car",
        options(fakeFetch({ html: new TypeError("offline"), summary: new TypeError("offline") })),
      ),
    ).rejects.toMatchObject({ code: "fetch_failed" });
    await expect(
      fetchWikipediaCapture(
        "https://en.wikipedia.org/wiki/Car",
        options(fakeFetch({ html: new Response("", { status: 503 }), summary: json(summary) })),
      ),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  it("refuses disambiguation pages", async () => {
    await expect(
      fetchWikipediaCapture(
        "https://en.wikipedia.org/wiki/Mercury",
        options(fakeFetch({ html: html(), summary: json({ ...summary, type: "disambiguation" }) })),
      ),
    ).rejects.toMatchObject({ code: "disambiguation" });
  });

  it("refuses pages outside the article namespace, even in languages we can't list", async () => {
    await expect(
      fetchWikipediaCapture(
        "https://de.wikipedia.org/wiki/Diskussion:Auto",
        options(
          fakeFetch({
            html: html(),
            summary: json({ ...summary, namespace: { id: 1, text: "Talk" } }),
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: "not_article" });
  });

  it("reports a page with no readable content", async () => {
    await expect(
      fetchWikipediaCapture(
        "https://en.wikipedia.org/wiki/Car",
        options(fakeFetch({ html: html("<html><body></body></html>"), summary: json(summary) })),
      ),
    ).rejects.toBeInstanceOf(WikipediaError);
  });
});
