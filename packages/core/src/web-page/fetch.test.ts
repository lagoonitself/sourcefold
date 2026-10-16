import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  type SourceFetch,
  type SourceFetchRequest,
  type SourceFetchResponse,
} from "../source-fetch";
import { MAX_WEB_PAGE_BYTES, WebPageIsPdfError, fetchWebPageCapture } from "./fetch";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
const parseHtml = (html: string) => parseHTML(html).document as unknown as Document;

function response(overrides: Partial<SourceFetchResponse> = {}): SourceFetchResponse {
  return {
    status: 200,
    url: "https://example.com/2026/03/inside-the-workshop",
    headers: { "content-type": "text/html; charset=utf-8" },
    text: fixture("news-article.html"),
    ...overrides,
  };
}

function fakeFetch(result: SourceFetchResponse | Error): {
  fetch: SourceFetch;
  calls: SourceFetchRequest[];
} {
  const calls: SourceFetchRequest[] = [];
  const fetchImpl: SourceFetch = async (request) => {
    calls.push(request);
    if (result instanceof Error) throw result;
    return result;
  };
  return { fetch: fetchImpl, calls };
}

const options = (result: SourceFetchResponse | Error) => {
  const { fetch, calls } = fakeFetch(result);
  return { fetch, calls, run: (url: string) => fetchWebPageCapture(url, { fetch, parseHtml }) };
};

describe("fetchWebPageCapture", () => {
  it("fetches a page and builds a web capture from the final URL", async () => {
    const { calls, run } = options(
      response({ url: "https://www.example.com/2026/03/inside-the-workshop" }),
    );

    const result = await run("https://example.com/2026/03/inside-the-workshop");

    expect(calls[0]?.url).toBe("https://example.com/2026/03/inside-the-workshop");
    expect(calls[0]?.headers?.Accept).toContain("text/html");
    expect(result).toMatchObject({ status: "ok", kind: "web" });
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.capture.url).toBe("https://www.example.com/2026/03/inside-the-workshop");
    expect(result.capture.title).toBe("Inside the Workshop");
    expect(result.capture.meta.author).toBe("Jane Doe");
  });

  it("reports a page that no longer exists", async () => {
    for (const status of [404, 410]) {
      const { run } = options(response({ status, text: "" }));
      await expect(run("https://example.com/gone")).rejects.toMatchObject({
        code: "not_found",
        message: "This page doesn't exist anymore.",
      });
    }
  });

  it("reports a site that refused the request", async () => {
    for (const status of [401, 403, 429]) {
      const { run } = options(response({ status, text: "" }));
      await expect(run("https://example.com/walled")).rejects.toMatchObject({
        code: "blocked",
        message:
          "The site refused the request. Try saving it with the Sourcefold extension while you have the page open.",
      });
    }
  });

  it("reports a server error and a network failure", async () => {
    for (const status of [500, 503]) {
      const { run } = options(response({ status, text: "" }));
      await expect(run("https://example.com/down")).rejects.toMatchObject({ code: "fetch_failed" });
    }
    const { run } = options(new TypeError("offline"));
    await expect(run("https://example.com/offline")).rejects.toMatchObject({
      code: "fetch_failed",
    });
  });

  it("lets an abort through instead of calling it a network failure", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { run } = options(abort);
    await expect(run("https://example.com/slow")).rejects.toBe(abort);
  });

  it("hands a PDF content type to the PDF extractor", async () => {
    const { run } = options(
      response({
        url: "https://example.com/files/paper.pdf",
        headers: { "content-type": "application/pdf" },
        text: "%PDF-1.7",
      }),
    );
    const error = await run("https://example.com/files/paper").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WebPageIsPdfError);
    expect(error).toMatchObject({
      code: "invalid_url",
      url: "https://example.com/files/paper.pdf",
    });
  });

  it("recognizes a PDF from its bytes when the content type lies", async () => {
    const { run } = options(
      response({
        headers: { "content-type": "application/octet-stream" },
        text: "%PDF-1.7\nstream",
      }),
    );
    await expect(run("https://example.com/download?id=5")).rejects.toBeInstanceOf(
      WebPageIsPdfError,
    );
  });

  it("refuses a link that isn't HTML", async () => {
    const { run } = options(
      response({ headers: { "content-type": "application/json" }, text: '{"ok":true}' }),
    );
    await expect(run("https://example.com/api.json")).rejects.toMatchObject({
      code: "parse_failed",
      message: "This link isn't a web page Sourcefold can read.",
    });
  });

  it("reports a page with no article text", async () => {
    const { run } = options(response({ text: fixture("empty-page.html") }));
    await expect(run("https://example.com/login")).rejects.toMatchObject({
      code: "parse_failed",
      message: "Couldn't find the article text on this page.",
    });
  });

  it("reports a page the parser chokes on", async () => {
    const { fetch } = fakeFetch(response({ text: "<html><body>broken</body></html>" }));
    await expect(
      fetchWebPageCapture("https://example.com/broken", {
        fetch,
        parseHtml: () => {
          throw new Error("bad html");
        },
      }),
    ).rejects.toMatchObject({
      code: "parse_failed",
      message: "Couldn't find the article text on this page.",
    });
  });

  it("refuses a body over the size limit", async () => {
    const declared = options(
      response({ headers: { "content-type": "text/html", "content-length": "11000000" } }),
    );
    await expect(declared.run("https://example.com/big")).rejects.toMatchObject({
      code: "too_large",
    });

    const measured = options(response({ text: "a".repeat(MAX_WEB_PAGE_BYTES + 1) }));
    await expect(measured.run("https://example.com/big")).rejects.toMatchObject({
      code: "too_large",
    });
  });
});
