import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { extractSubstack } from "./extract";

const freeHtml = readFileSync(new URL("./fixtures/free-post.html", import.meta.url), "utf8");
const paidSubHtml = readFileSync(
  new URL("./fixtures/paid-subscriber.html", import.meta.url),
  "utf8",
);
const paidLockedHtml = readFileSync(
  new URL("./fixtures/paid-locked.html", import.meta.url),
  "utf8",
);

describe("extractSubstack", () => {
  it("extracts a free post from a custom domain correctly", () => {
    const { document } = parseHTML(freeHtml);
    const doc = document as unknown as Document;

    const originalHtml = doc.body.innerHTML;
    const result = extractSubstack(
      doc,
      "https://www.example-letters.com/p/the-slow-ai-case?utm_source=feed",
    );

    // Ensure doc was not mutated
    expect(doc.body.innerHTML).toBe(originalHtml);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const { capture } = result;
    expect(capture.access).toBe("free");
    expect(capture.title).toBe("The Slow AI Case");
    expect(capture.subtitle).toBe(
      "Why artificial intelligence takes longer to diffuse than markets expect.",
    );
    expect(capture.author).toBe("Alice Morgan");
    expect(capture.authorUrl).toBe("https://substack.com/@alicemorgan");
    expect(capture.publication).toBe("Example Letters");
    expect(capture.publicationUrl).toBe("https://www.example-letters.com");
    expect(capture.published).toBe("2026-09-20T12:00:00.000Z");
    expect(capture.url).toBe("https://www.example-letters.com/p/the-slow-ai-case");

    // Body checks
    expect(capture.markdown).toContain(
      "The history of general-purpose technologies shows that organizational restructuring lags technical breakthroughs by decades.",
    );
    expect(capture.markdown).toContain("| Healthcare | 12% |");
    expect(capture.markdown).toContain(
      "[the empirical study](https://example.com/diffusion-study)",
    );

    // Excluded elements
    expect(capture.markdown).not.toContain("chart.png");
    expect(capture.markdown).not.toContain("Subscribe");
    expect(capture.markdown).not.toMatch(/^#\s+The Slow AI Case/m);

    // Paragraph separation
    expect(capture.markdown).toContain(
      "The history of general-purpose technologies shows that organizational restructuring lags technical breakthroughs by decades.\n\nIn contrast to software deployment",
    );
  });

  it("extracts an accessible paid post with access = 'paid'", () => {
    const { document } = parseHTML(paidSubHtml);
    const doc = document as unknown as Document;

    const result = extractSubstack(doc, "https://hardwarehorizon.substack.com/p/compute-clusters");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.capture.access).toBe("paid");
    expect(result.capture.title).toBe("Deep Dive into Compute Clusters");
    expect(result.capture.author).toBe("Marcus Vance");
    expect(result.capture.publication).toBe("Hardware Horizon");
    expect(result.capture.url).toBe("https://hardwarehorizon.substack.com/p/compute-clusters");
    expect(result.capture.markdown).toContain(
      "This premium analysis breaks down interconnect topologies",
    );
  });

  it("detects paywall element on a locked paid post", () => {
    const { document } = parseHTML(paidLockedHtml);
    const doc = document as unknown as Document;

    const result = extractSubstack(
      doc,
      "https://hardwarehorizon.substack.com/p/exclusive-analysis",
    );

    expect(result.status).toBe("paywalled");
    if (result.status !== "paywalled") return;

    expect(result.url).toBe("https://hardwarehorizon.substack.com/p/exclusive-analysis");
    expect(result.title).toBe("Exclusive Market Analysis");
  });

  it("returns not_substack for non-Substack pages", () => {
    const html = `<!DOCTYPE html><html><head><title>Some Blog</title></head><body><article><p>Hello world</p></article></body></html>`;
    const { document } = parseHTML(html);
    const doc = document as unknown as Document;

    const result = extractSubstack(doc, "https://myblog.example.com/post-1");
    expect(result.status).toBe("not_substack");
  });

  it("uses Readability fallback when .body.markup is absent", () => {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="Substack">
        <link rel="canonical" href="https://example.substack.com/p/fallback-test">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Readability Fallback Article",
          "url": "https://example.substack.com/p/fallback-test"
        }
        </script>
      </head>
      <body>
        <article class="post-content">
          <h1>Readability Fallback Article</h1>
          <p>This is fallback article body text extracted via Readability.</p>
        </article>
      </body>
    </html>`;

    const { document } = parseHTML(html);
    const doc = document as unknown as Document;

    const result = extractSubstack(doc, "https://example.substack.com/p/fallback-test");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.capture.title).toBe("Readability Fallback Article");
    expect(result.capture.markdown).toContain(
      "This is fallback article body text extracted via Readability.",
    );
    expect(result.capture.markdown).not.toMatch(/^#\s+Readability Fallback Article/m);
  });

  it("throws an error when post body text cannot be found for free post", () => {
    const html = `<!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="Substack">
        <link rel="canonical" href="https://example.substack.com/p/empty">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Empty Article",
          "url": "https://example.substack.com/p/empty"
        }
        </script>
      </head>
      <body>
        <div class="available-content">
          <div class="body markup"></div>
        </div>
      </body>
    </html>`;

    const { document } = parseHTML(html);
    const doc = document as unknown as Document;

    expect(() => extractSubstack(doc, "https://example.substack.com/p/empty")).toThrow(
      "Couldn't find the post text on this page.",
    );
  });

  it("extracts author and publisher as plain string, object, or array of either from JSON-LD", () => {
    // 1. Plain string
    const htmlString = `<!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="Substack">
        <link rel="canonical" href="https://example.substack.com/p/string-test">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          "headline": "String Test",
          "author": "Single Author",
          "publisher": "Single Publisher"
        }
        </script>
      </head>
      <body>
        <div class="body markup"><p>${"Content text that is long enough to meet minimum body length requirement ".repeat(3)}</p></div>
      </body>
    </html>`;

    const docString = parseHTML(htmlString).document as unknown as Document;
    const resString = extractSubstack(docString, "https://example.substack.com/p/string-test");
    expect(resString.status).toBe("ok");
    if (resString.status === "ok") {
      expect(resString.capture.author).toBe("Single Author");
      expect(resString.capture.publication).toBe("Single Publisher");
    }

    // 2. Array of strings
    const htmlArray = `<!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="Substack">
        <link rel="canonical" href="https://example.substack.com/p/array-test">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Array Test",
          "author": ["First Author", "Second Author"],
          "publisher": ["First Pub", "Second Pub"]
        }
        </script>
      </head>
      <body>
        <div class="body markup"><p>${"Content text that is long enough to meet minimum body length requirement ".repeat(3)}</p></div>
      </body>
    </html>`;

    const docArray = parseHTML(htmlArray).document as unknown as Document;
    const resArray = extractSubstack(docArray, "https://example.substack.com/p/array-test");
    expect(resArray.status).toBe("ok");
    if (resArray.status === "ok") {
      expect(resArray.capture.author).toBe("First Author");
      expect(resArray.capture.publication).toBe("First Pub");
    }

    // 3. Array of objects
    const htmlObjArray = `<!DOCTYPE html>
    <html>
      <head>
        <meta name="generator" content="Substack">
        <link rel="canonical" href="https://example.substack.com/p/obj-array-test">
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "headline": "Object Array Test",
          "author": [{ "name": "Obj Author" }],
          "publisher": [{ "name": "Obj Pub" }]
        }
        </script>
      </head>
      <body>
        <div class="body markup"><p>${"Content text that is long enough to meet minimum body length requirement ".repeat(3)}</p></div>
      </body>
    </html>`;

    const docObjArray = parseHTML(htmlObjArray).document as unknown as Document;
    const resObjArray = extractSubstack(
      docObjArray,
      "https://example.substack.com/p/obj-array-test",
    );
    expect(resObjArray.status).toBe("ok");
    if (resObjArray.status === "ok") {
      expect(resObjArray.capture.author).toBe("Obj Author");
      expect(resObjArray.capture.publication).toBe("Obj Pub");
    }
  });
});
