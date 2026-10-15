import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { wikipediaFullSizeImageUrl, wikipediaToMarkdown } from "./convert";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function convertHtml(html: string, language = "en"): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
  return wikipediaToMarkdown(document as unknown as Document, { language });
}

function convertFixture(name: string, language = "en"): string {
  const { document } = parseHTML(readFileSync(join(fixtures, name), "utf8"));
  return wikipediaToMarkdown(document as unknown as Document, { language });
}

describe("Turbocharger article (real REST page)", () => {
  const markdown = convertFixture("turbocharger.html");

  it("starts with the lead picture, then the lead text", () => {
    expect(
      markdown.startsWith(
        "![](https://upload.wikimedia.org/wikipedia/commons/4/42/Turbocharger_Animation_by_Tyroola.gif)\n\n*A turbocharger (item 10) on a piston engine*\n\nIn an [internal combustion engine](https://en.wikipedia.org/wiki/Internal_combustion_engine), a **turbocharger**",
      ),
    ).toBe(true);
  });

  it("starts headings at ## and never emits a # title", () => {
    expect(markdown).toMatch(/^## History$/m);
    expect(markdown).toMatch(/^### Turbine$/m);
    expect(markdown).not.toMatch(/^# /m);
  });

  it("drops hatnotes, maintenance banners, citation tags, navboxes and styles", () => {
    expect(markdown).not.toContain("redirects here");
    expect(markdown).not.toContain("Main article");
    expect(markdown).not.toMatch(/citation needed/i);
    expect(markdown).not.toContain("Unreliable sources");
    expect(markdown).not.toContain("mw-parser-output");
    expect(markdown).not.toMatch(/<[a-z]/i);
    expect(markdown).not.toContain("SFWP");
  });

  it("turns references into footnotes with a References section at the end", () => {
    expect(markdown).toMatch(/forced induction.*device that compresses.*\.\[\^1\]\[\^2\]/s);
    const references = markdown.slice(markdown.lastIndexOf("\n## References\n"));
    expect(references).toContain(
      '[^1]: Nice, Karim (4 December 2000). ["How Turbochargers Work"](http://auto.howstuffworks.com/turbo.htm). Auto.howstuffworks.com.',
    );
    expect(references.match(/^\[\^\d+\]: /gm)?.length).toBeGreaterThan(50);
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("numbers footnotes by first use and shares a repeated source", () => {
    const order = Array.from(markdown.matchAll(/\[\^(\d+)\]/g), (m) => Number(m[1]));
    const firstUses = order.filter((n, i) => order.indexOf(n) === i);
    expect(firstUses).toEqual([...firstUses].sort((a, b) => a - b));
    // The same named reference cited again keeps its number instead of getting a new one.
    expect(markdown.match(/^\[\^1\]: /gm)).toHaveLength(1);
    expect(order.filter((n) => n === 1).length).toBeGreaterThan(2);
  });

  it("keeps pictures as full-size links with italic captions", () => {
    expect(markdown).toContain(
      "![](https://upload.wikimedia.org/wikipedia/commons/2/2a/Turbosuperchargers.png)\n\n*Turbocharger components*",
    );
    expect(markdown).not.toContain("/thumb/");
    expect(markdown).not.toMatch(/\]\(\s*\)/);
  });

  it("keeps lists such as See also as links", () => {
    expect(markdown).toMatch(
      /## See also\n\n-\s+\[Boost gauge\]\(https:\/\/en\.wikipedia\.org\/wiki\/Boost_gauge\)/,
    );
  });

  it("never leaves an empty heading", () => {
    expect(markdown).not.toMatch(/^#{2,6} .*\n\n#{2,6} /m);
  });
});

describe("Rudolf Diesel article (infobox)", () => {
  const markdown = convertFixture("rudolf-diesel.html");

  it("puts the infobox right after the lead paragraph: picture, then a Field/Value table", () => {
    const leadEnd = markdown.indexOf("\n\n", 0);
    const afterLead = markdown.slice(leadEnd + 2);
    expect(markdown.startsWith("**Rudolf Christian Karl Diesel**")).toBe(true);
    expect(
      afterLead.startsWith(
        "![](https://upload.wikimedia.org/wikipedia/commons/9/9c/Rudolf_Diesel2.jpg)",
      ),
    ).toBe(true);
    expect(markdown).toContain("*Diesel, c. 1900*");
    expect(markdown).toContain(
      "| Field | Value |\n| --- | --- |\n| Born | Rudolf Christian Karl Diesel; 18 March 1858; Paris, France |",
    );
    expect(markdown).toContain(
      "| Died | 29 September 1913 (aged 55); [English Channel](https://en.wikipedia.org/wiki/English_Channel) |",
    );
    expect(markdown.indexOf("| Field | Value |")).toBeLessThan(markdown.indexOf("## Early life"));
  });

  it("drops hidden microformat text and the infobox title row", () => {
    expect(markdown).not.toContain("1858-03-18");
    expect(markdown).not.toMatch(/^\| Rudolf Diesel \|/m);
  });

  it("drops footnotes whose reference list isn't in the page", () => {
    // The fixture stops before the References section, so there is nothing to point at.
    expect(markdown).not.toContain("## References");
  });
});

describe("links", () => {
  it("makes article links absolute and drops titles, red links, File links and fragments", () => {
    const markdown = convertHtml(
      `<p><a rel="mw:WikiLink" href="./Internal_combustion_engine" title="Internal combustion engine">engine</a>,
      <a href="./Turbo_(disambiguation)">turbo</a>,
      <a href="./Missing_page?action=edit&amp;redlink=1" class="new">missing</a>,
      <a href="./File:Foo.jpg">a file</a>, <a href="#History">history</a>,
      <a rel="mw:ExtLink" href="https://example.com/a b">site</a>,
      <a href="./Foo#Section_one">section</a>,
      <a href="//commons.wikimedia.org/wiki/Cars">commons</a>, <a href="./Category:Cars">category</a>.</p>`,
      "de",
    );
    expect(markdown).toContain(
      "[engine](https://de.wikipedia.org/wiki/Internal_combustion_engine)",
    );
    expect(markdown).toContain("[turbo](https://de.wikipedia.org/wiki/Turbo_%28disambiguation%29)");
    expect(markdown).toContain("missing,");
    expect(markdown).not.toContain("Missing_page");
    expect(markdown).toContain("a file,");
    expect(markdown).not.toContain("File:Foo");
    expect(markdown).toContain("history,");
    expect(markdown).toContain("[site](https://example.com/a%20b)");
    expect(markdown).toContain("[section](https://de.wikipedia.org/wiki/Foo#Section_one)");
    expect(markdown).toContain("[commons](https://commons.wikimedia.org/wiki/Cars)");
    expect(markdown).toContain("category.");
    expect(markdown).not.toContain("Category:");
    expect(markdown).not.toContain(' "');
  });
});

describe("references", () => {
  const reflist = `<div class="mw-references-wrap"><ol class="mw-references references">
    <li id="cite_note-a-1"><span class="mw-cite-backlink"><a href="./X#cite_ref-a_1-0">↑</a></span>
      <span class="mw-reference-text reference-text">First <a href="./Source">source</a>.</span></li>
    <li id="cite_note-2"><span class="mw-reference-text reference-text">Second source.</span></li>
    <li id="cite_note-3"><span class="mw-reference-text reference-text"></span></li>
  </ol></div>`;
  const marker = (id: string, label: string) =>
    `<sup class="mw-ref reference" typeof="mw:Extension/ref"><a href="./X#${id}"><span class="mw-reflink-text">[${label}]</span></a></sup>`;

  it("collapses runs of repeated markers and lists each source once", () => {
    const markdown = convertHtml(
      `<p>One${marker("cite_note-a-1", "1")}${marker("cite_note-2", "2")}${marker("cite_note-a-1", "1")}. Two${marker("cite_note-2", "2")}.</p>
       <h2>References</h2>${reflist}`,
    );
    expect(markdown).toBe(
      "One[^1][^2]. Two[^2].\n\n## References\n\n[^1]: First [source](https://en.wikipedia.org/wiki/Source).\n[^2]: Second source.\n",
    );
  });

  it("drops markers without a usable reference and removes the original empty section", () => {
    const markdown = convertHtml(
      `<p>Text${marker("cite_note-3", "3")}${marker("cite_note-missing", "9")}.</p>
       <h2>Notes</h2><h2>References</h2>${reflist}`,
    );
    expect(markdown).toBe("Text.\n");
  });
});

describe("pictures", () => {
  const thumb = (name: string, size: string, extra = "") =>
    `<img src="//thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/${size}-${name}.jpg?utm_source=x" ${extra}>`;

  it("uses the original file and the caption", () => {
    const markdown = convertHtml(
      `<figure typeof="mw:File/Thumb"><a class="mw-file-description" href="./File:Car.jpg">${thumb("Car.jpg", "330px", 'alt="A red car" width="330" height="200"')}</a><figcaption>A <i>red</i> car, see <a href="./Car">Car</a>.</figcaption></figure>`,
    );
    expect(markdown).toBe(
      "![A red car](https://upload.wikimedia.org/wikipedia/commons/a/ab/Car.jpg)\n\n*A red car, see [Car](https://en.wikipedia.org/wiki/Car).*\n",
    );
  });

  it("skips icons and flags under 40px, in text and in figures", () => {
    const markdown = convertHtml(
      `<p>Germany <span typeof="mw:File"><a class="mw-file-description" href="./File:Flag.svg">${thumb("Flag.svg", "23px", 'width="23" height="14"')}</a></span> and <span typeof="mw:File/Frameless"><a href="./File:Map.png">${thumb("Map.png", "120px", 'alt="Map" width="120" height="90"')}</a></span>.</p>
       <figure typeof="mw:File/Thumb"><a href="./File:Icon.png">${thumb("Icon.png", "30px", 'width="30" height="30"')}</a><figcaption>Tiny</figcaption></figure>`,
    );
    expect(markdown).toBe(
      "Germany and ![Map](https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.png).\n",
    );
  });

  it("lists gallery images with their captions", () => {
    const markdown = convertHtml(
      `<ul class="gallery mw-gallery-traditional"><li class="gallerybox"><div class="thumb"><span typeof="mw:File"><a href="./File:A.jpg">${thumb("A.jpg", "120px", 'alt="A" width="120" height="90"')}</a></span></div><div class="gallerytext">First one</div></li>
       <li class="gallerybox"><div class="thumb"><span typeof="mw:File"><a href="./File:B.jpg">${thumb("B.jpg", "120px", 'width="120" height="90"')}</a></span></div><div class="gallerytext"></div></li></ul>`,
    );
    expect(markdown).toBe(
      "![A](https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg)\n\n*First one*\n\n![](https://upload.wikimedia.org/wikipedia/commons/a/ab/B.jpg)\n",
    );
  });

  it("works out full-size addresses", () => {
    const base = "//thumb.wikimedia.org/wikipedia/commons/thumb";
    expect(wikipediaFullSizeImageUrl(`${base}/4/42/Name.gif/500px-Name.gif?utm_source=x`)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/4/42/Name.gif",
    );
    expect(wikipediaFullSizeImageUrl(`${base}/a/ab/Diagram.svg/330px-Diagram.svg.png`)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Diagram.svg",
    );
    expect(
      wikipediaFullSizeImageUrl(
        "https://upload.wikimedia.org/wikipedia/en/thumb/9/9d/Car_(1).jpg/220px-Car_(1).jpg",
      ),
    ).toBe("https://upload.wikimedia.org/wikipedia/en/9/9d/Car_%281%29.jpg");
    // A page of a PDF can't be shown as the original, so the thumbnail stays.
    expect(wikipediaFullSizeImageUrl(`${base}/a/ab/Doc.pdf/page1-400px-Doc.pdf.jpg`)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Doc.pdf/page1-400px-Doc.pdf.jpg",
    );
    expect(
      wikipediaFullSizeImageUrl("https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg"),
    ).toBe("https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg");
    expect(wikipediaFullSizeImageUrl("")).toBeNull();
  });
});

describe("math", () => {
  const math = (tex: string, kind: "inline" | "block") =>
    `<span class="mwe-math-element mwe-math-element-${kind}"><span class="mwe-math-mathml-a11y" style="display: none;"><math alttext="{\\displaystyle ${tex}}"><semantics><mi>x</mi></semantics></math></span><img class="mwe-math-fallback-image-${kind}" alt="{\\displaystyle ${tex}}" src="https://wikimedia.org/api/rest_v1/media/math/render/svg/abc" width="60" height="20"></span>`;

  it("keeps LaTeX as $…$ inline and $$…$$ for display equations", () => {
    const markdown = convertHtml(
      `<p>Let ${math("E=mc^{2}", "inline")} where ${math("a_{1}*b", "inline")}.</p><dl><dd>${math("\\frac {a}{b}", "block")}</dd></dl><p>Done.</p>`,
    );
    expect(markdown).toContain("Let $E=mc^{2}$ where $a_{1}*b$.");
    expect(markdown).toContain("$$\n\\frac {a}{b}\n$$");
    expect(markdown).not.toContain("wikimedia.org/api");
  });

  it("avoids a bar that would split a table cell", () => {
    const markdown = convertHtml(
      `<table class="wikitable"><tr><th>Name</th><th>Formula</th></tr><tr><td>Norm</td><td>${math("|x|", "inline")}</td></tr></table>`,
    );
    expect(markdown).toContain("| Norm | $\\vert x\\vert $ |");
  });
});

describe("superscripts and subscripts", () => {
  it("uses Unicode where the characters exist", () => {
    const markdown = convertHtml(
      "<p>CO<sub>2</sub> at 10<sup>−3</sup> m<sup>2</sup>, the 1<sup>st</sup>, x<sup>n+1</sup>, a<sup>b&amp;c</sup>, T<sub>max</sub>.</p>",
    );
    expect(markdown).toBe("CO₂ at 10⁻³ m², the 1st, xⁿ⁺¹, a^(b&c), Tₘₐₓ.\n");
  });
});

describe("tables", () => {
  it("turns a simple table into GFM, escaping bars and dropping empty rows", () => {
    const markdown = convertHtml(
      `<table class="wikitable"><caption>Engines</caption>
        <tbody><tr><th>Name</th><th>Power</th></tr>
        <tr><td>A <a href="./Engine">engine</a></td><td>100 | 200</td></tr>
        <tr><td></td><td>&nbsp;</td></tr>
        <tr><td>B</td><td><ul><li>x</li><li>y</li></ul></td></tr></tbody></table>`,
    );
    expect(markdown).toBe(
      "*Engines*\n\n| Name | Power |\n| --- | --- |\n| A [engine](https://en.wikipedia.org/wiki/Engine) | 100 \\| 200 |\n| B | x; y |\n",
    );
  });

  it("keeps the text of tables with merged cells, one bullet per row", () => {
    const markdown = convertHtml(
      `<table class="wikitable"><tr><th colspan="2">Group</th></tr><tr><td>a</td><td>b</td></tr><tr><td>c</td><td></td></tr></table>`,
    );
    expect(markdown).toBe("- Group\n- a · b\n- c\n");
  });

  it("dissolves a table that only lays out other tables", () => {
    const markdown = convertHtml(
      `<table><tr><td><table class="wikitable"><tr><th>Y</th><th>N</th></tr><tr><td>1970</td><td>5</td></tr></table></td>
        <td><table class="wikitable"><tr><th>Y</th><th>N</th></tr><tr><td>1980</td><td>6</td></tr></table></td></tr></table>`,
    );
    expect(markdown).toBe(
      "| Y | N |\n| --- | --- |\n| 1970 | 5 |\n\n| Y | N |\n| --- | --- |\n| 1980 | 6 |\n",
    );
  });

  it("shows a flag's alt text in a cell and drops other pictures", () => {
    const markdown = convertHtml(
      `<table class="wikitable"><tr><th>Country</th><th>Size</th></tr><tr><td><a href="./File:De.svg"><img alt="Germany" src="//upload.wikimedia.org/x.png" width="23" height="14"></a></td><td><img alt="" src="//upload.wikimedia.org/y.png" width="200" height="100">big</td></tr></table>`,
    );
    expect(markdown).toBe("| Country | Size |\n| --- | --- |\n| Germany | big |\n");
  });
});

describe("infobox", () => {
  const infobox = `<table class="infobox vcard"><tbody>
    <tr><th colspan="2" class="infobox-above">Title row</th></tr>
    <tr><td colspan="2" class="infobox-image"><span typeof="mw:File/Frameless"><a href="./File:P.jpg"><img alt="Portrait" src="//thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/P.jpg/220px-P.jpg" width="220" height="300"></a></span><div class="infobox-caption">Portrait, 1900</div></td></tr>
    <tr><th colspan="2" class="infobox-header">Section header</th></tr>
    <tr><th scope="row" class="infobox-label">Born</th><td class="infobox-data">1858<br>Paris<span style="display:none">(hidden)</span></td></tr>
    <tr><th scope="row" class="infobox-label">Empty</th><td class="infobox-data"></td></tr>
    <tr><td colspan="2" class="infobox-full-data">No label here</td></tr>
  </tbody></table>`;

  it("becomes a compact table after the lead paragraph", () => {
    const markdown = convertHtml(
      `<section>${infobox}<p>Lead text.</p><p>Second paragraph.</p><h2>History</h2><p>Later.</p></section>`,
    );
    expect(markdown).toBe(
      "Lead text.\n\n![Portrait](https://upload.wikimedia.org/wikipedia/commons/a/ab/P.jpg)\n\n*Portrait, 1900*\n\n| Field | Value |\n| --- | --- |\n| Born | 1858; Paris |\n\nSecond paragraph.\n\n## History\n\nLater.\n",
    );
  });

  it("is dropped when no row has both a label and a value", () => {
    const markdown = convertHtml(
      `<table class="infobox"><tr><th colspan="2">Only a title</th></tr></table><p>Lead.</p>`,
    );
    expect(markdown).toBe("Lead.\n");
  });
});

describe("noise", () => {
  it("drops edit links, hatnotes, sidebars, coordinates, hidden text and the contents box", () => {
    const markdown = convertHtml(
      `<div class="hatnote">For other uses, see X.</div>
       <div class="shortdescription" style="display:none">short</div>
       <table class="sidebar"><tr><td>Side</td></tr></table>
       <div class="toc"><ul><li>Contents</li></ul></div>
       <p>Lead <span class="geo-inline"><span class="geo">1;2</span></span>text<span class="mw-editsection">[edit]</span><sup class="noprint Inline-Template"><a href="./Wikipedia:Citation_needed">citation needed</a></sup>.</p>
       <div class="navbox"><ul><li>Nav</li></ul></div>
       <script>alert(1)</script><style>.x{}</style>`,
    );
    expect(markdown).toBe("Lead text.\n");
  });

  it("removes empty sections left by dropped content but keeps parents of subsections", () => {
    const markdown = convertHtml(
      `<p>Lead.</p><h2>Parent</h2><h3>Child</h3><p>Body.</p><h2>See also</h2><h2>External links</h2><ul><li><a href="https://example.com">Site</a></li></ul><h2>Empty at end</h2>`,
    );
    expect(markdown).toBe(
      "Lead.\n\n## Parent\n\n### Child\n\nBody.\n\n## External links\n\n-   [Site](https://example.com/)\n",
    );
  });

  it("shifts headings down when the page has an h1", () => {
    expect(convertHtml("<h1>Title</h1><p>A</p><h2>Part</h2><p>B</p>")).toBe(
      "## Title\n\nA\n\n### Part\n\nB\n",
    );
  });

  it("returns an empty string for an empty page", () => {
    expect(convertHtml("<div class='navbox'>x</div>")).toBe("");
  });
});

describe("other languages", () => {
  it("builds links for the right edition", () => {
    const markdown = convertHtml(
      `<p><a rel="mw:WikiLink" href="./Verbrennungsmotor">Verbrennungsmotor</a></p>`,
      "de",
    );
    expect(markdown).toBe("[Verbrennungsmotor](https://de.wikipedia.org/wiki/Verbrennungsmotor)\n");
  });
});
