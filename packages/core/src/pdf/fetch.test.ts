import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import type { SourceFetch, SourceFetchRequest, SourceFetchResponse } from "../source-fetch";
import { MAX_PDF_BYTES, fetchPdfCapture, parseAtomEntry } from "./fetch";
import { turbochargerPdf } from "./fixtures/documents";

// No network: a fake `SourceFetch` answers with saved fixtures, so the request sequence and the
// error mapping can be checked exactly.

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const arxivHtml = readFileSync(join(fixtures, "arxiv-attention.html"), "utf8");

const parseHtml = (html: string): Document => parseHTML(html).document as unknown as Document;

type Handler = (request: SourceFetchRequest) => SourceFetchResponse;
const sourceFetch =
  (handler: Handler): SourceFetch =>
  (request) =>
    Promise.resolve(handler(request));

function text(
  url: string,
  body: string,
  options: { status?: number; contentType?: string } = {},
): SourceFetchResponse {
  return {
    status: options.status ?? 200,
    url,
    headers: { "content-type": options.contentType ?? "text/html" },
    text: body,
  };
}

function pdfBytes(url: string, body: Uint8Array): SourceFetchResponse {
  return {
    status: 200,
    url,
    headers: { "content-type": "application/pdf" },
    text: "",
    bytes: body,
  };
}

function statusOnly(url: string, status: number): SourceFetchResponse {
  return { status, url, headers: {}, text: "" };
}

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=2401.01234</title>
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <published>2024-01-02T09:00:00Z</published>
    <title>From the Atom feed</title>
    <author><name>Ada Lovelace</name></author>
    <author><name>Grace Hopper</name></author>
  </entry>
</feed>`;

describe("fetchPdfCapture, arXiv links", () => {
  it("uses arXiv's HTML version when it is there", async () => {
    const requested: string[] = [];
    const fetch = sourceFetch((request) => {
      requested.push(request.url);
      if (request.url === "https://arxiv.org/html/2401.01234") {
        return text(request.url, arxivHtml);
      }
      return statusOnly(request.url, 404);
    });

    const result = await fetchPdfCapture("https://arxiv.org/abs/2401.01234", { fetch, parseHtml });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.kind).toBe("pdf");
    expect(result.capture.url).toBe("https://arxiv.org/abs/2401.01234");
    expect(result.capture.title).toBe("Attention Is All You Need");
    expect(result.capture.meta.arxiv).toBe("2401.01234");
    expect(requested).toEqual([
      "https://arxiv.org/html/2401.01234",
      "https://export.arxiv.org/api/query?id_list=2401.01234",
    ]);
  });

  it("uses arXiv's HTML version and completes the title from the Atom API when the HTML has no document title", async () => {
    const noTitleHtml = readFileSync(join(fixtures, "arxiv-no-title.html"), "utf8");
    const requested: string[] = [];
    const ATOM_2308 = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=2308.08708</title>
  <entry>
    <id>http://arxiv.org/abs/2308.08708</id>
    <published>2023-08-16T17:00:00Z</published>
    <title>Consciousness in Artificial Intelligence: Insights from the Science of Consciousness</title>
    <author><name>Patrick Butlin</name></author>
    <author><name>Robert Long</name></author>
  </entry>
</feed>`;

    const fetch = sourceFetch((request) => {
      requested.push(request.url);
      if (request.url === "https://arxiv.org/html/2308.08708") {
        return text(request.url, noTitleHtml);
      }
      if (request.url.startsWith("https://export.arxiv.org/api/query")) {
        return text(request.url, ATOM_2308, { contentType: "application/atom+xml" });
      }
      return statusOnly(request.url, 404);
    });

    const result = await fetchPdfCapture("https://arxiv.org/abs/2308.08708", { fetch, parseHtml });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.kind).toBe("pdf");
    expect(result.capture.url).toBe("https://arxiv.org/abs/2308.08708");
    expect(result.capture.title).toBe(
      "Consciousness in Artificial Intelligence: Insights from the Science of Consciousness",
    );
    expect(result.capture.meta.arxiv).toBe("2308.08708");
    expect(result.capture.meta.author).toBe("Patrick Butlin, Robert Long");
    expect(result.capture.meta.published).toBe("2023-08-16");
    expect(result.capture.markdown).toContain("Introduction");
    expect(result.capture.markdown).toContain("Scientific Theories of Consciousness");
    expect(requested.some((url) => url.includes("/pdf/"))).toBe(false);
  });

  it("falls back to the PDF and reads arXiv's Atom metadata", async () => {
    const requested: string[] = [];
    const fetch = sourceFetch((request) => {
      requested.push(request.url);
      if (request.url === "https://arxiv.org/html/2401.01234v2") {
        return statusOnly(request.url, 404);
      }
      if (request.url === "https://arxiv.org/pdf/2401.01234v2") {
        return pdfBytes(request.url, turbochargerPdf());
      }
      if (request.url.startsWith("https://export.arxiv.org/api/query")) {
        return text(request.url, ATOM, { contentType: "application/atom+xml" });
      }
      return statusOnly(request.url, 500);
    });

    const result = await fetchPdfCapture("https://arxiv.org/abs/2401.01234v2", {
      fetch,
      parseHtml,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(requested).toEqual([
      "https://arxiv.org/html/2401.01234v2",
      "https://arxiv.org/pdf/2401.01234v2",
      "https://export.arxiv.org/api/query?id_list=2401.01234",
    ]);
    expect(result.capture.url).toBe("https://arxiv.org/abs/2401.01234");
    expect(result.capture.meta).toEqual({
      author: "Ada Lovelace, Grace Hopper",
      published: "2024-01-02",
      pages: 2,
      arxiv: "2401.01234",
    });
    expect(result.capture.title).toBe("From the Atom feed");
    expect(result.capture.markdown.startsWith("This report explains")).toBe(true);
  });

  it("falls back to the PDF when the HTML has no document title", async () => {
    const fetch = sourceFetch((request) => {
      if (request.url.startsWith("https://arxiv.org/html/")) {
        return text(request.url, "<html><body><p>nothing here</p></body></html>");
      }
      if (request.url.startsWith("https://arxiv.org/pdf/")) {
        return pdfBytes(request.url, turbochargerPdf());
      }
      return statusOnly(request.url, 404);
    });

    const result = await fetchPdfCapture("https://arxiv.org/abs/2401.01234", { fetch, parseHtml });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.capture.title).toBe("Turbocharging Basics");
    expect(result.capture.meta.arxiv).toBe("2401.01234");
  });

  it("keeps the PDF's own metadata when arXiv's API does not answer", async () => {
    const fetch = sourceFetch((request) => {
      if (request.url.startsWith("https://arxiv.org/html/")) return statusOnly(request.url, 404);
      if (request.url.startsWith("https://arxiv.org/pdf/")) {
        return pdfBytes(request.url, turbochargerPdf());
      }
      throw new Error("no atom for you");
    });

    const result = await fetchPdfCapture("https://arxiv.org/abs/2401.01234", { fetch, parseHtml });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.capture.title).toBe("Turbocharging Basics");
    expect(result.capture.meta.author).toBe("Ada Lovelace");
    expect(result.capture.meta.published).toBe("2024-01-03");
  });
});

describe("fetchPdfCapture, other links", () => {
  it("downloads bytes and saves a plain PDF", async () => {
    const requested: SourceFetchRequest[] = [];
    const url = "https://cdn.example.com/papers/quarterly.pdf";
    const fetch = sourceFetch((request) => {
      requested.push(request);
      return pdfBytes(url, turbochargerPdf());
    });

    const result = await fetchPdfCapture(url, { fetch, parseHtml });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(requested[0]).toMatchObject({ url, responseType: "bytes" });
    expect(result.capture.url).toBe(url);
    expect(result.capture.title).toBe("Turbocharging Basics");
    expect(result.capture.meta.arxiv).toBeNull();
  });

  it("refuses a response that is not a PDF", async () => {
    const fetch = sourceFetch((request) =>
      text(request.url, "<html><body>a web page</body></html>"),
    );
    await expect(
      fetchPdfCapture("https://example.com/page", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code: "parse_failed",
      message: "This link isn't a PDF.",
    });
  });

  it("accepts a PDF content type even without the %PDF bytes", async () => {
    const fetch = sourceFetch((request) => ({
      status: 200,
      url: request.url,
      headers: { "content-type": "application/pdf" },
      text: "",
      bytes: new Uint8Array([1, 2, 3, 4]),
    }));
    await expect(
      fetchPdfCapture("https://example.com/thing", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code: "parse_failed",
      message: "Couldn't read this PDF.",
    });
  });

  it("refuses a PDF over 50 MB", async () => {
    const fetch = sourceFetch((request) => ({
      status: 200,
      url: request.url,
      headers: { "content-type": "application/pdf", "content-length": String(MAX_PDF_BYTES + 1) },
      text: "",
    }));
    await expect(
      fetchPdfCapture("https://example.com/big.pdf", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code: "too_large",
      message: "This PDF is over 50 MB.",
    });
  });
});

describe("fetchPdfCapture error mapping", () => {
  it.each<[number, string, string]>([
    [404, "not_found", "Couldn't find that PDF. Check the link."],
    [410, "not_found", "Couldn't find that PDF. Check the link."],
    [403, "blocked", "The site refused the request. Try again later."],
    [429, "blocked", "The site refused the request. Try again later."],
    [
      500,
      "fetch_failed",
      "The site answered with an error (HTTP 500). It may be down; try again later.",
    ],
    [
      503,
      "fetch_failed",
      "The site answered with an error (HTTP 503). It may be down; try again later.",
    ],
    [400, "fetch_failed", "The site answered HTTP 400 instead of the page."],
  ])("maps status %i to %s", async (status, code, message) => {
    const fetch = sourceFetch((request) => statusOnly(request.url, status));
    await expect(
      fetchPdfCapture("https://example.com/paper.pdf", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code,
      message,
    });
  });

  it("maps a network error to fetch_failed", async () => {
    const fetch: SourceFetch = () => Promise.reject(new Error("ECONNRESET"));
    await expect(
      fetchPdfCapture("https://example.com/paper.pdf", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code: "fetch_failed",
      message: "Couldn't download the PDF. Check your connection and try again.",
    });
  });

  it("keeps a PDF status error when both arXiv paths fail", async () => {
    const fetch = sourceFetch((request) => {
      if (request.url.startsWith("https://arxiv.org/html/")) return statusOnly(request.url, 404);
      if (request.url.startsWith("https://arxiv.org/pdf/")) return statusOnly(request.url, 403);
      return statusOnly(request.url, 404);
    });

    await expect(
      fetchPdfCapture("https://arxiv.org/abs/2401.01234", { fetch, parseHtml }),
    ).rejects.toMatchObject({
      code: "blocked",
      message: "The site refused the request. Try again later.",
    });
  });
});

describe("parseAtomEntry", () => {
  it("reads the title, authors and published date", () => {
    expect(parseAtomEntry(ATOM)).toEqual({
      title: "From the Atom feed",
      authors: "Ada Lovelace, Grace Hopper",
      published: "2024-01-02",
    });
  });

  it("returns null when there is no entry", () => {
    expect(parseAtomEntry("<feed></feed>")).toBeNull();
  });

  it("decodes XML entities", () => {
    const xml =
      "<feed><entry><title>Tom &amp; Jerry &lt;3</title><published>2020-05-06T00:00:00Z</published></entry></feed>";
    expect(parseAtomEntry(xml)).toEqual({
      title: "Tom & Jerry <3",
      authors: null,
      published: "2020-05-06",
    });
  });
});
