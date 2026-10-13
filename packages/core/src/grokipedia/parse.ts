import { parseHTML } from "linkedom";

export interface GrokipediaReference {
  number: number;
  title: string;
  url: string;
  domain: string;
}

export interface GrokipediaArticle {
  url: string; // as passed in
  title: string;
  summary: string | null;
  factCheckedAt: string | null; // ISO string from JSON-LD dateModified
  bodyHtml: string; // cleaned article HTML
  references: GrokipediaReference[];
}

export class GrokipediaParseError extends Error {}

export function parseGrokipediaHtml(html: string, url: string): GrokipediaArticle {
  const { document } = parseHTML(html);

  const articleEl = document.querySelector("article");
  const h1El = document.querySelector("h1");
  if (!articleEl || !h1El) {
    throw new GrokipediaParseError("Missing article or h1 element");
  }

  const title = h1El.textContent?.trim() ?? "";
  if (!title) {
    throw new GrokipediaParseError("Missing article title");
  }

  // Summary from meta description
  const metaDesc = document
    .querySelector('meta[name="description"]')
    ?.getAttribute("content")
    ?.trim();
  const summary = metaDesc || null;

  // Fact-checked date from JSON-LD dateModified
  let factCheckedAt: string | null = null;
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      if (data && typeof data === "object") {
        if (typeof data.dateModified === "string") {
          factCheckedAt = data.dateModified;
          break;
        }
        if (Array.isArray(data["@graph"])) {
          for (const item of data["@graph"]) {
            if (item && typeof item.dateModified === "string") {
              factCheckedAt = item.dateModified;
              break;
            }
          }
          if (factCheckedAt) break;
        }
      }
    } catch {
      // Ignore JSON parse errors in script tags
    }
  }

  // Parse references
  const references: GrokipediaReference[] = [];
  const refSelector = "#references, .references, [aria-labelledby='references-title']";
  const referencesEl =
    document.querySelector(refSelector) || articleEl.querySelector(refSelector);
  if (referencesEl) {
    const liElements = referencesEl.querySelectorAll("li");
    for (const li of liElements) {
      let num: number | null = null;
      const backrefLink = li.querySelector("a[data-backref], .ref-num, a[href^='#ref-']");
      if (backrefLink) {
        const backrefAttr = backrefLink.getAttribute("data-backref");
        if (backrefAttr) {
          const parsed = parseInt(backrefAttr, 10);
          if (!Number.isNaN(parsed)) num = parsed;
        }
        if (num === null) {
          const digits = backrefLink.textContent?.replace(/\D/g, "");
          if (digits) {
            const parsed = parseInt(digits, 10);
            if (!Number.isNaN(parsed)) num = parsed;
          }
        }
      }
      if (num === null && li.id && li.id.startsWith("ref-")) {
        const parsed = parseInt(li.id.slice(4), 10);
        if (!Number.isNaN(parsed)) num = parsed;
      }
      if (num === null) continue;

      const aEl =
        li.querySelector("a.ref-link") ||
        li.querySelector(".min-w-0 a") ||
        li.querySelector("a[target='_blank']") ||
        Array.from(li.querySelectorAll("a")).find((a) => a !== backrefLink);

      if (!aEl) continue;

      const rawHref = aEl.getAttribute("href")?.trim() ?? "";
      let absoluteUrl = rawHref;
      try {
        absoluteUrl = new URL(rawHref, "https://grokipedia.com").href;
      } catch {
        // Keep rawHref if invalid
      }

      const refTitle = (aEl.textContent ?? "").replace(/\s+/g, " ").trim();

      let domain = "";
      try {
        domain = new URL(absoluteUrl).hostname.replace(/^www\./, "");
      } catch {
        const domainSpan = li.querySelector(".type-hint");
        domain = (domainSpan?.textContent ?? "").trim().replace(/^www\./, "");
      }

      references.push({
        number: num,
        title: refTitle,
        url: absoluteUrl,
        domain,
      });
    }
  }
  references.sort((a, b) => a.number - b.number);

  const validRefNumbers = new Set(references.map((r) => r.number));

  // Clean bodyHtml
  const clone = articleEl.cloneNode(true) as HTMLElement;

  // 1. Remove references section
  clone
    .querySelectorAll(refSelector)
    .forEach((el) => {
      el.remove();
    });

  // 2. Remove h1
  clone.querySelectorAll("h1").forEach((el) => {
    el.remove();
  });

  // 3. Remove "Fact-checked by Grok" line/element
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    if (
      el.textContent?.includes("Fact-checked by Grok") &&
      !Array.from(el.children).some((child) => child.textContent?.includes("Fact-checked by Grok"))
    ) {
      const hintWrapper = el.closest(".type-hint");
      if (hintWrapper) {
        hintWrapper.remove();
      } else {
        el.remove();
      }
    }
  }

  // Remove header element
  clone.querySelectorAll("header").forEach((header) => {
    header.remove();
  });

  // 4. Remove table of contents / nav
  clone
    .querySelectorAll("nav, .toc, #toc, [class~='toc'], [id~='toc'], [class*='table-of-contents'], [id*='table-of-contents'], [aria-label*='contents' i]")
    .forEach((el) => {
      el.remove();
    });

  // 5. Remove buttons, svgs, images, picture, video, audio, script, style, noscript
  clone
    .querySelectorAll("button, svg, img, picture, video, audio, script, style, noscript")
    .forEach((el) => {
      el.remove();
    });

  // 6. Remove edit / "Suggest edit" / copy UI
  for (const el of Array.from(clone.querySelectorAll("*"))) {
    const text = (el.textContent ?? "").trim();
    if (/^(?:suggest\s+edit|edit\s+history|copy\s+link|copy)$/i.test(text)) {
      el.remove();
    } else {
      const hasActionClass =
        el.classList?.contains("heading-copy-link") ||
        el.classList?.contains("heading-listen") ||
        el.classList?.contains("swap-btn");
      const isActionControl = ["BUTTON", "A", "SPAN"].includes(el.tagName);
      const isActionId = /(?:^|[-_])(?:edit|copy|tts)(?:[-_]|$)/i.test(el.id || "");
      if (hasActionClass || (isActionControl && isActionId)) {
        el.remove();
      }
    }
  }

  // 7. Rewrite citation markers
  const topSups = Array.from(clone.querySelectorAll("sup")).filter(
    (sup) => !sup.parentElement?.closest("sup"),
  );

  for (const sup of topSups) {
    const refLinks = Array.from(sup.querySelectorAll("a[href*='#ref-']"));
    const numbers: number[] = [];
    for (const a of refLinks) {
      const href = a.getAttribute("href") ?? "";
      const match = href.match(/#ref-(\d+)/);
      if (match && match[1]) {
        const n = parseInt(match[1], 10);
        // Only include citation numbers that have matching reference definitions
        if (validRefNumbers.size === 0 || validRefNumbers.has(n)) {
          if (!numbers.includes(n)) {
            numbers.push(n);
          }
        }
      }
    }

    if (numbers.length > 0) {
      const markerText = numbers.map((n) => `[^${n}]`).join("");
      const textNode = clone.ownerDocument.createTextNode(markerText);
      sup.replaceWith(textNode);
    } else if (sup.classList?.contains("citation") || sup.classList?.contains("ref") || refLinks.length > 0) {
      sup.remove();
    }
    // Otherwise, leave non-citation superscripts (e.g. math powers x^2, ordinals 1^st) intact!
  }

  // 8. Rewrite relative links to absolute against https://grokipedia.com, and drop #fragment-only links
  for (const a of Array.from(clone.querySelectorAll("a"))) {
    const href = a.getAttribute("href")?.trim();
    if (!href || href.startsWith("#")) {
      a.replaceWith(...Array.from(a.childNodes));
      continue;
    }
    try {
      const abs = new URL(href, "https://grokipedia.com").href;
      a.setAttribute("href", abs);
    } catch {
      // Keep as-is
    }
  }

  // 9. Replace block-styled text spans and divs with <p> elements
  const blockTextWrappers = Array.from(
    clone.querySelectorAll("span[data-tts-block], span.block, div.block"),
  );
  for (const el of blockTextWrappers) {
    if (el.tagName.toLowerCase() === "p") continue;
    const hasBlockChild = el.querySelector(
      "h1, h2, h3, h4, h5, h6, ul, ol, li, table, thead, tbody, tr, th, td, p, div, nav, header, section, article",
    );
    if (hasBlockChild) continue;
    const p = clone.ownerDocument.createElement("p");
    while (el.firstChild) {
      p.appendChild(el.firstChild);
    }
    el.replaceWith(p);
  }

  const bodyHtml = clone.innerHTML.trim();

  return {
    url,
    title,
    summary,
    factCheckedAt,
    bodyHtml,
    references,
  };
}
