import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  removeFromBody,
  renderMarkdown,
  SOURCE_SPAN_ATTR,
  targetsForSelection,
  type RemoveTarget,
  type RenderedBlock,
} from "./index";

interface Block {
  start: number;
  end: number;
  tag: string;
  text: string;
}

function blocksOf(markdown: string): Block[] {
  const { document } = parseHTML(
    `<div id="r">${renderMarkdown(markdown, { sourceMap: true })}</div>`,
  );
  return Array.from(document.querySelectorAll(`[${SOURCE_SPAN_ATTR}]`)).map((el) => {
    const [start, end] = (el.getAttribute(SOURCE_SPAN_ATTR) ?? "").split("-").map(Number);
    return { start: start!, end: end!, tag: el.tagName.toLowerCase(), text: el.textContent ?? "" };
  });
}

function textOf(markdown: string): string {
  const { document } = parseHTML(`<div id="r">${renderMarkdown(markdown)}</div>`);
  return (document.getElementById("r")?.textContent ?? "").trim();
}

/** A target for the first block whose visible text contains `needle`. */
function part(markdown: string, needle: string, whole = false): RemoveTarget {
  const block = blocksOf(markdown).find((b) => b.text.includes(needle));
  if (!block) throw new Error(`No block holds "${needle}"`);
  if (whole) return { start: block.start, end: block.end };
  const from = block.text.indexOf(needle);
  return {
    start: block.start,
    end: block.end,
    from,
    to: from + needle.length,
    textLength: block.text.length,
  };
}

function cut(markdown: string, ...targets: RemoveTarget[]): string {
  const result = removeFromBody(markdown, targets);
  if (!result.ok) throw new Error(result.message);
  return result.markdown;
}

describe("renderMarkdown source map", () => {
  it("marks blocks only when asked, and leaves the visible text alone", () => {
    const md = "# Title\n\nA paragraph.\n\n- one\n- two\n\n> quote\n";
    expect(renderMarkdown(md)).not.toContain(SOURCE_SPAN_ATTR);
    const mapped = renderMarkdown(md, { sourceMap: true });
    expect(mapped.match(new RegExp(SOURCE_SPAN_ATTR, "g"))).toHaveLength(5);
    const strip = (html: string) =>
      html.replace(new RegExp(` ${SOURCE_SPAN_ATTR}="[\\d-]+"`, "g"), "");
    expect(strip(mapped)).toBe(renderMarkdown(md));
  });

  it("gives spans that cut the block's own text out of the source", () => {
    const md = "First.\n\nSecond.\n\nThird.";
    const blocks = blocksOf(md);
    expect(blocks.map((b) => md.slice(b.start, b.end).trim())).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });
});

describe("removeFromBody: whole blocks", () => {
  const md = [
    "## Intro",
    "",
    "Keep this paragraph.",
    "",
    "Subscribe to my newsletter!",
    "",
    "- item a",
    "- item b",
    "- item c",
    "",
    "> a quote",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "Last words.",
  ].join("\n");

  it("removes a paragraph and the blank line after it", () => {
    const out = cut(md, part(md, "Subscribe", true));
    expect(out).not.toContain("Subscribe");
    expect(out).toContain("Keep this paragraph.\n\n- item a");
  });

  it("removes one list item and keeps the others", () => {
    const out = cut(md, part(md, "item b", true));
    expect(out).toContain("- item a\n- item c");
    expect(out).not.toContain("item b");
  });

  it("removes a heading, a quote and a code block", () => {
    const out = cut(
      md,
      part(md, "Intro", true),
      part(md, "a quote", true),
      part(md, "const x", true),
    );
    expect(out).not.toContain("Intro");
    expect(out).not.toContain("quote");
    expect(out).not.toContain("const x");
    expect(out).toContain("Keep this paragraph.");
    expect(out).toContain("Last words.");
  });

  it("never leaves three blank lines in a row or blank lines at the ends", () => {
    const out = cut(md, part(md, "Intro", true), part(md, "Last words", true));
    expect(out).not.toMatch(/\n{3,}/);
    expect(out.startsWith("\n")).toBe(false);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("removes the two ends of a range of blocks at once", () => {
    const out = cut(md, part(md, "Keep this", true), part(md, "Subscribe", true));
    expect(out.startsWith("## Intro\n\n- item a")).toBe(true);
  });
});

describe("removeFromBody: part of a paragraph", () => {
  it("removes a sentence from plain text", () => {
    const md = "First sentence. Sponsor read goes here. Last sentence.";
    const out = cut(md, part(md, "Sponsor read goes here."));
    expect(out).toBe("First sentence. Last sentence.");
  });

  it("removes the start and the end of a paragraph without leaving spaces", () => {
    const md = "Hello there. Middle part. Goodbye.";
    expect(cut(md, part(md, "Hello there. "))).toBe("Middle part. Goodbye.");
    expect(cut(md, part(md, " Goodbye."))).toBe("Hello there. Middle part.");
  });

  it("removes text inside bold and links without touching the rest", () => {
    const md = "Some **bold and brave** words with a [link to nowhere](https://example.com/x) end.";
    const out = cut(md, part(md, "and brave"));
    expect(out).toBe("Some **bold** words with a [link to nowhere](https://example.com/x) end.");
    expect(textOf(out)).toBe("Some bold words with a link to nowhere end.");
  });

  it("takes the markers along when everything inside them goes", () => {
    const md = "Before **gone** after, and [a link](https://example.com) too.";
    const out = cut(md, part(md, "gone"));
    expect(out).not.toContain("**");
    expect(textOf(out)).toBe("Before after, and a link too.");
    const linkGone = cut(md, part(md, "a link"));
    expect(linkGone).not.toContain("example.com");
  });

  it("removes a selection that spans formatting", () => {
    const md = "One **two** three [four](https://example.com) five.";
    const out = cut(md, part(md, "two three four"));
    expect(textOf(out)).toBe("One five.");
    expect(out).not.toContain("**");
    expect(out).not.toContain("example.com");
  });

  it("handles a transcript line: a time link and spoken words", () => {
    const md = "[2:31](https://youtu.be/abc?t=151) so today we talk about turbo lag and boost.";
    const out = cut(md, part(md, "so today we talk about turbo lag"));
    expect(out).toBe("[2:31](https://youtu.be/abc?t=151) and boost.");
  });

  it("removes a whole line break along with the text around it", () => {
    const md = "Line one is long.\nLine two is sponsor text.\nLine three stays.";
    const out = cut(md, part(md, "Line two is sponsor text."));
    expect(textOf(out)).not.toContain("sponsor");
    expect(textOf(out)).toContain("Line one is long.");
    expect(textOf(out)).toContain("Line three stays.");
  });

  it("removes a part of a heading and of a one-line list item", () => {
    const md = "## The big chapter title\n\n- first item here\n- second item here\n";
    expect(cut(md, part(md, "big "))).toContain("## The chapter title");
    expect(cut(md, part(md, "item here", false))).toContain("- first \n".trimEnd());
  });

  it("counts a footnote mark as one piece", () => {
    const md = "Claim one.[^1] Claim two.\n\n[^1]: The note.";
    const block = blocksOf(md)[0]!;
    expect(block.text).toBe("Claim one.[1] Claim two.");
    const out = cut(md, part(md, "Claim two."));
    expect(out.startsWith("Claim one.[^1]")).toBe(true);
    const marked = cut(md, part(md, "one.[1]"));
    expect(marked).toBe("Claim Claim two.\n\n[^1]: The note.");
  });

  it("counts a name like &amp; as one character", () => {
    const md = "Fish &amp; chips are good. Keep me.";
    expect(textOf(md)).toBe("Fish & chips are good. Keep me.");
    expect(cut(md, part(md, "chips are good."))).toBe("Fish &amp; Keep me.");
    expect(cut(md, part(md, "Fish & chips"))).toBe("are good. Keep me.");
  });
});

describe("removeFromBody: refusals", () => {
  it("refuses a part of a quote, a table or a multi-line item", () => {
    const md =
      "> a quote with words\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- line one\n  line two\n";
    for (const needle of ["quote with", "1"]) {
      const block = blocksOf(md).find((b) => b.text.includes(needle))!;
      const result = removeFromBody(md, [
        { start: block.start, end: block.end, from: 0, to: 1, textLength: block.text.length },
      ]);
      expect(result.ok).toBe(false);
    }
    const item = blocksOf(md).find((b) => b.tag === "li")!;
    expect(removeFromBody(md, [{ start: item.start, end: item.end, from: 0, to: 2 }]).ok).toBe(
      false,
    );
  });

  it("refuses when the page's text length does not match the source", () => {
    const md = "Plain paragraph text.";
    const block = blocksOf(md)[0]!;
    const result = removeFromBody(md, [
      { start: block.start, end: block.end, from: 0, to: 5, textLength: block.text.length + 3 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("refuses a block that is no longer there", () => {
    const result = removeFromBody("Some text.", [{ start: 4, end: 9 }]);
    expect(result.ok).toBe(false);
  });
});

describe("removeFromBody: the result still reads right", () => {
  it("matches the visible text minus the selection, for plain and formatted paragraphs", () => {
    const md = "Alpha **beta** gamma, [delta](https://example.com) epsilon. Zeta eta theta.";
    const full = textOf(md);
    for (const needle of ["Alpha", "beta gamma", "delta epsilon", "Zeta eta theta.", "gamma, "]) {
      const out = cut(md, part(md, needle));
      const expected = full.replace(needle, "").replace(/ {2,}/g, " ").trim();
      expect(textOf(out).replace(/ {2,}/g, " ").trim()).toBe(expected);
    }
  });
});

describe("targetsForSelection", () => {
  const md = "First paragraph here.\n\nSecond paragraph here.\n\n- one item\n- two item\n";

  /** The blocks as the reader measures them: where each one's text starts in the body's text. */
  function layout() {
    const { document } = parseHTML(`<div id="r">${renderMarkdown(md, { sourceMap: true })}</div>`);
    const root = document.getElementById("r")!;
    const blocks: RenderedBlock[] = [];
    let textStart = 0;
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          textStart += (child as Text).data.length;
          continue;
        }
        const span = (child as Element).getAttribute(SOURCE_SPAN_ATTR);
        if (span) {
          const [start, end] = span.split("-").map(Number);
          blocks.push({ start: start!, end: end!, textStart, text: child.textContent ?? "" });
        }
        walk(child);
      }
    };
    walk(root);
    return { blocks, text: root.textContent ?? "" };
  }

  function select(from: string, to: string) {
    const { blocks, text } = layout();
    const start = text.indexOf(from);
    return { blocks, start, end: text.indexOf(to, start) + to.length };
  }

  it("cuts the selected part of a block it only touches and removes a covered block whole", () => {
    const { blocks, start, end } = select("here.", "Second paragraph");
    const targets = targetsForSelection(blocks, start, end);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ from: 16, to: 21 });
    expect(targets[1]).toMatchObject({ from: 0, to: 16 });
    expect(cut(md, ...targets)).toBe("First paragraph\n\nhere.\n\n- one item\n- two item");
  });

  it("removes every block a selection runs across", () => {
    const { blocks, start, end } = select("Second", "two item");
    const targets = targetsForSelection(blocks, start, end);
    expect(targets.every((t) => t.from === undefined)).toBe(true);
    expect(cut(md, ...targets)).toBe("First paragraph here.");
  });

  it("ignores blocks a selection does not reach", () => {
    const { blocks, start } = select("First", "First");
    expect(targetsForSelection(blocks, start, start)).toEqual([]);
  });
});
