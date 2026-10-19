import { describe, expect, it } from "vitest";
import { buildItemFile } from "../drive-file";
import { parseReaderFile } from "./parse-file";

describe("parseReaderFile trailing sections", () => {
  it("keeps the summary, the highlights and the note out of the body", () => {
    const file = buildItemFile({
      kind: "web",
      title: "Page",
      url: "https://example.com/p",
      saved: "2026-10-19",
      body: "Body text.",
      summary: "A summary.",
      note: "Mine.",
      tags: ["A"],
      triage: "keep",
      highlights: [
        {
          id: "a",
          kind: "text",
          quote: "Body text.",
          image_src: null,
          note: null,
          seconds: null,
          cited: [],
          start_offset: 0,
          created_at: "2026-10-19T12:00:00.000Z",
        },
      ],
    });
    const parsed = parseReaderFile(file);
    expect(parsed.body).toBe("Body text.");
    expect(parsed.note).toBe("Mine.");
    expect(parsed.frontMatter.status).toBe("keep");
    expect(parsed.frontMatter.tags).toBe("A");
  });

  it("cuts a summary that has no highlights after it", () => {
    const file = buildItemFile({ kind: "web", title: "P", body: "Body.", summary: "Short." });
    expect(parseReaderFile(file).body).toBe("Body.");
    expect(parseReaderFile(file).note).toBeNull();
  });
});
