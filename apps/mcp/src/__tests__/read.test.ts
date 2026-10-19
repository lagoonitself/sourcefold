import { beforeEach, describe, expect, it } from "vitest";
import {
  clearReadCache,
  PART_LIMIT,
  registerReadTools,
  splitFrontMatter,
  splitParts,
} from "../tools/read";
import { connect, fakeWeb } from "./harness";

beforeEach(() => clearReadCache());

function file(body: string, extra = ""): string {
  return [
    "---",
    "source: web",
    'title: "A: title"',
    "url: https://example.com/post",
    "site: Example",
    "author: Ada",
    "published: 2026-01-02",
    extra,
    "saved: 2026-10-01",
    "folder: Cars/Engines",
    "---",
    "",
    "# A: title",
    "",
    "> Saved from [Example](https://example.com/post) on 2026-10-01.",
    "",
    body,
    "",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== undefined)
    .join("\n");
}

function web(kind: string, markdown: string, counters?: { content: number }) {
  return fakeWeb({
    "GET /items/*/content": () => {
      if (counters) counters.content++;
      return { text: markdown };
    },
    "GET /items/*/file": () => ({ json: { data: { url: "https://files.test/pic.png" } } }),
    "GET /items/*": () => ({
      json: { data: { id: "s1", kind, title: "A: title", note: "caption note", folder_id: "g1" } },
    }),
  });
}

const paragraph = (n: number, size = 1000) => `Paragraph ${n}. ${"word ".repeat(size / 5)}`.trim();
const section = (title: string, paragraphs: number) =>
  [`## ${title}`, ...Array.from({ length: paragraphs }, (_, n) => paragraph(n))].join("\n\n");

describe("splitFrontMatter", () => {
  it("returns the fields and the text after the closing line", () => {
    const { fields, body } = splitFrontMatter(file("Hello."));
    expect(fields.title).toBe("A: title");
    expect(fields.url).toBe("https://example.com/post");
    expect(fields.author).toBe("Ada");
    expect(body.startsWith("\n# A: title") || body.startsWith("# A: title")).toBe(true);
  });

  it("leaves text without front matter alone", () => {
    expect(splitFrontMatter("# Title\n\ntext")).toEqual({ fields: {}, body: "# Title\n\ntext" });
  });
});

describe("splitParts", () => {
  it("cuts before a heading, else at a paragraph break, else hard", () => {
    const limit = 100;
    const withHeading = `${"a".repeat(60)}\n\n${"b".repeat(20)}\n## H\n${"c".repeat(60)}`;
    const headingOffset = withHeading.indexOf("## H");
    expect(
      splitParts(withHeading, [{ level: 2, text: "H", offset: headingOffset }], limit),
    ).toEqual([
      [0, headingOffset],
      [headingOffset, withHeading.length],
    ]);

    const paragraphs = `${"a".repeat(60)}\n\n${"b".repeat(60)}`;
    expect(splitParts(paragraphs, [], limit)).toEqual([
      [0, 62],
      [62, paragraphs.length],
    ]);

    const solid = "x".repeat(250);
    expect(splitParts(solid, [], limit)).toEqual([
      [0, 100],
      [100, 200],
      [200, 250],
    ]);
  });
});

describe("read_source", () => {
  it("answers a short source in one part with the useful front matter", async () => {
    const h = await connect(registerReadTools, { web: web("web", file("Short text.")) });
    const { text, isError } = await h.call("read_source", { source_id: "s1" });
    expect(isError).toBe(false);
    const lines = text.split("\n");
    expect(lines[0]).toBe("A: title");
    expect(lines[1]).toBe("Web page · https://example.com/post");
    expect(lines[2]).toBe("By: Ada · Site: Example · Published: 2026-01-02 · Saved: 2026-10-01");
    expect(text).toContain("Part 1 of 1");
    expect(text).toContain("Short text.");
    expect(text).toContain("End of the source.");
    // Front matter and the repeated title are gone; the "Saved from" line stays.
    expect(text).not.toContain("source: web");
    expect(text).not.toContain("# A: title");
    expect(text).toContain("> Saved from [Example]");
    expect(text).not.toContain("Outline");
  });

  it("answers a long source with an overview and outline, without its text", async () => {
    const body = [section("First", 15), section("Second", 15), section("Third", 15)].join("\n\n");
    const h = await connect(registerReadTools, { web: web("web", file(body)) });
    const { text, isError } = await h.call("read_source", { source_id: "s1" });
    expect(isError).toBe(false);
    const lines = text.split("\n");
    expect(lines[0]).toBe("A: title");
    expect(lines[2]).toBe("By: Ada · Site: Example · Published: 2026-01-02 · Saved: 2026-10-01");
    expect(text).toMatch(/Length: [\d,]+ characters \(about [\d,]+ words\), too long/);
    expect(text).toMatch(/^§1 First · 15\.\dk characters$/m);
    expect(text).toMatch(/^§3 Third · /m);
    expect(text).not.toContain("Paragraph 0.");
  });

  it("gives the video time each part of a long transcript covers", async () => {
    const lines = Array.from(
      { length: 60 },
      (_, n) => `[${n}:00](https://youtu.be/abc?t=${n * 60}) ${"word ".repeat(200)}`,
    );
    const body = ["## Transcript", ...lines].join("\n\n");
    const h = await connect(registerReadTools, { web: web("youtube", file(body)) });
    const { text } = await h.call("read_source", { source_id: "s1" });
    expect(text).toContain("Video time in each part (read one with part=N):");
    expect(text).toMatch(/^part 1: 0:00 to \d+:00$/m);
    expect(text).toMatch(/^part 2: \d+:00 to 59:00$/m);
  });

  it("reads one section, and the next part of a section that is too long", async () => {
    const body = [
      "Intro text.",
      section("First", 3),
      "### Inside first\n\nNested text.",
      section("Second", 45),
      section("Third", 3),
    ].join("\n\n");
    const h = await connect(registerReadTools, { web: web("web", file(body)) });

    const overview = await h.call("read_source", { source_id: "s1" });
    expect(overview.text).toMatch(/^§1 First · /m);
    expect(overview.text).toMatch(/^ {2}§2 Inside first · /m);

    const first = await h.call("read_source", { source_id: "s1", section: 1 });
    expect(first.text).toContain("Section §1 First");
    expect(first.text).toContain("----\n## First");
    // A section includes its subsections and stops at the next heading at its level.
    expect(first.text).toContain("Nested text.");
    expect(first.text).not.toContain("## Second");
    expect(first.text).toContain("Next section: §3 Second.");

    const second = await h.call("read_source", { source_id: "s1", section: 3 });
    expect(second.text).toContain("Section §3 Second (part 1 of 2 of this section)");
    expect(second.text).toContain("call read_source with section=3, part=2.");
    const rest = await h.call("read_source", { source_id: "s1", section: 3, part: 2 });
    expect(rest.text).toContain("(part 2 of 2 of this section)");
    expect(rest.text).not.toContain("## Third");
    expect(rest.text).toContain("Next section: §4 Third.");

    const missing = await h.call("read_source", { source_id: "s1", section: 9 });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("has 4 sections; section 9 doesn't exist");
  });

  it("splits a long source at headings into parts", async () => {
    const body = [section("First", 15), section("Second", 15), section("Third", 15)].join("\n\n");
    const markdown = file(body);
    const h = await connect(registerReadTools, { web: web("web", markdown) });

    const one = await h.call("read_source", { source_id: "s1", part: 1 });
    expect(one.text).toMatch(/Part 1 of 2 \(characters 1–[\d,]+ of [\d,]+\)/);
    expect(one.text).not.toContain("Outline");
    expect(one.text).toContain("Continues in part 2: call read_source with part=2.");
    // Part 1 stops before the heading that starts part 2.
    expect(one.text).not.toContain("## Third");

    const two = await h.call("read_source", { source_id: "s1", part: 2 });
    expect(two.isError).toBe(false);
    expect(two.text).toContain("Part 2 of 2");
    expect(two.text).not.toContain("Outline");
    expect(two.text).toContain("----\n## Third");
    expect(two.text).toContain("End of the source.");

    // Nothing is lost or repeated between the parts.
    const partText = (t: string) => t.split("----\n")[1]!.replace(/\n----.*$/s, "");
    expect(partText(one.text).length).toBeLessThanOrEqual(PART_LIMIT);
    expect(partText(two.text).length).toBeLessThanOrEqual(PART_LIMIT);
    expect(partText(one.text).trimEnd() + "\n\n" + partText(two.text).trimEnd()).toContain(
      paragraph(14),
    );
  });

  it("cuts at a paragraph break when there are no headings", async () => {
    const body = Array.from({ length: 60 }, (_, n) => paragraph(n)).join("\n\n");
    const h = await connect(registerReadTools, { web: web("web", file(body)) });
    const overview = await h.call("read_source", { source_id: "s1" });
    expect(overview.text).toContain("It has no headings. Read it in order with part=1 to part=2.");
    const one = await h.call("read_source", { source_id: "s1", part: 1 });
    expect(one.text).toContain("Part 1 of 2");
    expect(one.text).not.toContain("Outline");
    const first = one.text.split("----\n")[1]!;
    // The cut falls between paragraphs: the part ends with a whole paragraph.
    expect(first.trimEnd().endsWith("word")).toBe(true);
    const two = await h.call("read_source", { source_id: "s1", part: 2 });
    expect(two.text).toMatch(/----\nParagraph \d+\. word/);
  });

  it("does not treat a # line inside a code fence as a heading", async () => {
    const body = ["## Real", "```", "# not a heading", "```", "text"].join("\n");
    const h = await connect(registerReadTools, {
      web: web("web", file(body + "\n\n" + section("Big", 45))),
    });
    const { text } = await h.call("read_source", { source_id: "s1" });
    expect(text).toMatch(/^§1 Real · /m);
    expect(text).not.toContain("not a heading");
  });

  it("says which parts exist when the part is out of range", async () => {
    const body = [section("First", 15), section("Second", 15), section("Third", 15)].join("\n\n");
    const h = await connect(registerReadTools, { web: web("web", file(body)) });
    const { text, isError } = await h.call("read_source", { source_id: "s1", part: 9 });
    expect(isError).toBe(true);
    expect(text).toContain("has 2 parts; part 9 doesn't exist");
    expect(text).toContain("from 1 to 2");
    const zero = await h.call("read_source", { source_id: "s1", part: 0 });
    expect(zero.isError).toBe(true);
  });

  it("keeps the text for 10 minutes and asks the web app only once", async () => {
    const counters = { content: 0 };
    const body = [section("First", 15), section("Second", 15), section("Third", 15)].join("\n\n");
    const fake = web("web", file(body), counters);
    const h = await connect(registerReadTools, { web: fake });
    await h.call("read_source", { source_id: "s1" });
    const callsAfterFirst = fake.calls.length;
    await h.call("read_source", { source_id: "s1", part: 2 });
    expect(counters.content).toBe(1);
    expect(fake.calls.length).toBe(callsAfterFirst);

    clearReadCache();
    await h.call("read_source", { source_id: "s1", part: 2 });
    expect(counters.content).toBe(2);
  });

  it("answers an image with its link and caption", async () => {
    const counters = { content: 0 };
    const h = await connect(registerReadTools, { web: web("image", "", counters) });
    const { text, isError } = await h.call("read_source", { source_id: "s1" });
    expect(isError).toBe(false);
    expect(text).toContain("Image · https://files.test/pic.png");
    expect(text).toContain("Caption: A: title");
    expect(text).toContain("no text to read");
    expect(counters.content).toBe(0);
  });

  it("explains a source that has no saved text", async () => {
    const fake = fakeWeb({
      "GET /items/*/content": () => ({
        status: 404,
        json: { error: { message: "Item not found." } },
      }),
      "GET /items/*": () => ({
        json: { data: { id: "s1", kind: "web", title: "Pending", note: null, folder_id: "g1" } },
      }),
    });
    const h = await connect(registerReadTools, { web: fake });
    const { text, isError } = await h.call("read_source", { source_id: "s1" });
    expect(isError).toBe(true);
    expect(text).toContain('"Pending" has no saved text to read');
  });
});
