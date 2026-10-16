import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { arxivHtmlToCapture } from "./arxiv";

// The fixture is trimmed by hand from https://arxiv.org/html/1706.03762v7 (arXiv's LaTeXML HTML)
// down to the abstract, one section with a subsection, inline and display math, one figure, two
// references, and the page chrome that has to be dropped.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureHtml = readFileSync(join(fixtures, "arxiv-attention.html"), "utf8");

const parseHtml = (html: string): Document => parseHTML(html).document as unknown as Document;

const EXPECTED_BODY = [
  "## Abstract",
  "",
  "The dominant sequence transduction models are based on complex recurrent networks. We propose the Transformer, a model that relies on $\\eta = W/Q$.",
  "",
  "## 1 Introduction",
  "",
  "Recurrent models were the state of the art [1]. They process tokens in order.",
  "",
  "## 2 Model Architecture",
  "",
  "![The Transformer - model architecture.](https://arxiv.org/html/1706.03762v7/Figures/ModalNet-21.png)",
  "",
  "*The Transformer - model architecture.*",
  "",
  "The encoder maps an input sequence $(x_{1},...,x_{n})$ to continuous representations $z$.",
  "",
  "$$",
  "\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}(\\frac{QK^{T}}{\\sqrt{d_{k}}})V",
  "$$",
  "",
  "### 2.1 Encoder",
  "",
  "The encoder is a stack of six identical layers.",
  "",
  "## References",
  "",
  "- [1] Ashish Vaswani and Noam Shazeer. Attention is all you need. *NeurIPS*, 2017.",
  "- [2] Dzmitry Bahdanau. Neural machine translation by jointly learning to align and translate. *CoRR*, abs/1409.0473, 2014.",
].join("\n");

describe("arxivHtmlToCapture", () => {
  const capture = arxivHtmlToCapture(fixtureHtml, "1706.03762", parseHtml);

  it("uses the abstract page as the url and the id as the arxiv field", () => {
    expect(capture.url).toBe("https://arxiv.org/abs/1706.03762");
    expect(capture.title).toBe("Attention Is All You Need");
    expect(capture.meta).toEqual({
      author: "Ashish Vaswani, Noam Shazeer",
      published: null,
      pages: null,
      arxiv: "1706.03762",
    });
  });

  it("renders the abstract, numbered sections and subsections, and the references", () => {
    expect(capture.markdown).toBe(EXPECTED_BODY);
  });

  it("drops the page chrome", () => {
    expect(capture.markdown).not.toMatch(/Report issue/i);
    expect(capture.markdown).not.toContain("build logs");
    expect(capture.markdown).not.toContain("arXiv:1706.03762v7");
    expect(capture.markdown).not.toContain("Google Brain");
    expect(capture.markdown).not.toContain("ltx_");
    expect(capture.markdown).not.toMatch(/<[a-z]/i);
  });

  it("keeps citations as plain text and math as AltTeX", () => {
    expect(capture.markdown).toContain("the state of the art [1].");
    expect(capture.markdown).not.toContain("#bib.bib1");
    expect(capture.markdown).toMatch(/^\$\$$/m);
  });

  it("refuses HTML without a document title", () => {
    const html =
      '<html><body><article class="ltx_document"><p>no title</p></article></body></html>';
    expect(() => arxivHtmlToCapture(html, "1706.03762", parseHtml)).toThrowError(
      /Couldn't read this paper/,
    );
  });

  it("reports a parse failure when the HTML cannot be parsed", () => {
    const broken = () => {
      throw new Error("boom");
    };
    expect(() => arxivHtmlToCapture(fixtureHtml, "1706.03762", broken)).toThrowError(
      /Couldn't read this paper/,
    );
  });
});
