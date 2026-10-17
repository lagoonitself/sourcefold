import { describe, expect, it } from "vitest";
import { bodyFromDriveFile, buildItemFile, type BuildItemInput } from "./drive-file";

describe("bodyFromDriveFile", () => {
  it("drops the front matter", () => {
    const file = "---\nsource: grokipedia\ntitle: Cars\nfolder: Cars/EVs\n---\n\n# Cars\n\nBody.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("drops the trailing note section", () => {
    const file = "---\ntitle: Cars\n---\n\n# Cars\n\nBody.\n\n## My note\n\nCheck the sources.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("keeps a body that has no front matter", () => {
    expect(bodyFromDriveFile("# Cars\n\nBody.")).toBe("# Cars\n\nBody.\n");
  });

  it("handles Windows line endings and a byte order mark", () => {
    const file = "\ufeff---\r\ntitle: Cars\r\n---\r\n\r\n# Cars\r\n\r\nBody.\r\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nBody.\n");
  });

  it("keeps horizontal rules inside the body", () => {
    const file = "---\ntitle: Cars\n---\n\n# Cars\n\nOne.\n\n---\n\nTwo.\n";
    expect(bodyFromDriveFile(file)).toBe("# Cars\n\nOne.\n\n---\n\nTwo.\n");
  });
});

describe("buildItemFile and round-trip stability", () => {
  const item: BuildItemInput = {
    kind: "grokipedia",
    title: "Quantum Computing",
    url: "https://grokipedia.com/page/Quantum_Computing",
    created_at: "2026-10-13T10:00:00Z",
    folder: "Quantum/Basics",
    meta: {
      summary: "An introduction to quantum computing.",
      fact_checked: "2026-10-12",
    },
    markdown: "## Overview\n\nQuantum bits exist in superposition.\n",
    note: "Review section on error correction.",
  };

  it("builds the expected structure", () => {
    const output = buildItemFile(item, "Quantum/Basics");
    expect(output).toContain("source: grokipedia\n");
    expect(output).toContain("title: Quantum Computing\n");
    expect(output).toContain("fact_checked: 2026-10-12\n");
    expect(output).toContain("saved: 2026-10-13\n");
    expect(output).toContain("folder: Quantum/Basics\n");
    expect(output).toContain("# Quantum Computing\n\n> Saved from [Grokipedia]");
    expect(output).toContain(
      "## Overview\n\nQuantum bits exist in superposition.\n\n## My note\n\nReview section on error correction.\n",
    );
  });

  it("build -> bodyFromDriveFile -> build is byte-for-byte identical", () => {
    const firstBuild = buildItemFile(item, "Quantum/Basics");
    const extractedBody = bodyFromDriveFile(firstBuild);
    const secondBuild = buildItemFile({ ...item, markdown: extractedBody }, "Quantum/Basics");

    expect(secondBuild).toBe(firstBuild);

    const thirdExtracted = bodyFromDriveFile(secondBuild);
    const thirdBuild = buildItemFile({ ...item, markdown: thirdExtracted }, "Quantum/Basics");

    expect(thirdBuild).toBe(firstBuild);
  });

  it("strips pre-existing old source line and leading # Title from stored markdown", () => {
    const oldMarkdown =
      "# Quantum Computing\n\n> Saved from Grokipedia on 2026-10-10. Grokipedia articles change; see the live page: https://old.url\n\n## Overview\n\nBody content.";
    const built = buildItemFile({ ...item, markdown: oldMarkdown }, "Quantum/Basics");

    // Must only have exactly one "# Quantum Computing"
    const titleMatches = built.match(/^# Quantum Computing$/gm);
    expect(titleMatches?.length).toBe(1);

    // Must only have the new canonical source line, not the old one
    expect(built).not.toContain("https://old.url");
    expect(built).toContain(
      "> Saved from [Grokipedia](https://grokipedia.com/page/Quantum_Computing) on 2026-10-13. Grokipedia articles change; check the live page for edits.",
    );
  });
});

describe("buildItemFile for Wikipedia", () => {
  const article: BuildItemInput = {
    kind: "wikipedia",
    title: "Turbocharger",
    url: "https://en.wikipedia.org/wiki/Turbocharger",
    created_at: "2026-10-13T10:00:00Z",
    meta: { summary: "Forced induction device", language: "en", revision: 1376335656 },
    markdown: "Lead.\n\n## History\n\nText.\n",
  };

  it("writes the Wikipedia fields in order, with the revision unquoted", () => {
    const output = buildItemFile(article, "Cars/Engines");
    expect(
      output.startsWith(
        "---\nsource: wikipedia\ntitle: Turbocharger\nurl: https://en.wikipedia.org/wiki/Turbocharger\nsummary: Forced induction device\nlanguage: en\nrevision: 1376335656\nsaved: 2026-10-13\nfolder: Cars/Engines\n---\n",
      ),
    ).toBe(true);
    expect(output).toContain(
      "> Saved from [Wikipedia](https://en.wikipedia.org/wiki/Turbocharger) on 2026-10-13. Wikipedia articles change; check the live page for edits.",
    );
  });

  it("takes the revision from a string, formats last_edited, and ignores a bad revision", () => {
    const fromString = buildItemFile(
      { ...article, meta: { revision: "42", last_edited: "2026-09-23T23:59:59Z" } },
      "",
    );
    expect(fromString).toContain("revision: 42\nlast_edited: 2026-09-23\n");
    const bad = buildItemFile({ ...article, meta: { revision: "abc" } }, "");
    expect(bad).not.toContain("revision:");
  });
});

function newKind(overrides: Partial<BuildItemInput>): BuildItemInput {
  return {
    kind: "youtube",
    title: "A title",
    url: "https://example.com/a",
    saved: "2026-10-16",
    folder: "Cars",
    meta: {},
    markdown: "Body.",
    ...overrides,
  };
}

describe("buildItemFile for the 2026-10 source kinds", () => {
  it("writes the YouTube fields in order and quotes a sexagesimal duration", () => {
    const output = buildItemFile(
      newKind({
        kind: "youtube",
        title: "How a Turbocharger Works",
        url: "https://www.youtube.com/watch?v=abcDEF12345",
        meta: {
          channel: "Engineering Explained",
          channel_url: "https://www.youtube.com/channel/UC12345",
          published: "2026-09-30T12:00:00Z",
          duration: "1:02:10",
          language: "en",
          captions: "auto-generated",
        },
      }),
      "Cars/Engines",
    );

    expect(
      output.startsWith(
        '---\nsource: youtube\ntitle: How a Turbocharger Works\nurl: https://www.youtube.com/watch?v=abcDEF12345\nchannel: Engineering Explained\nchannel_url: https://www.youtube.com/channel/UC12345\npublished: 2026-09-30\nduration: "1:02:10"\nlanguage: en\ncaptions: auto-generated\nsaved: 2026-10-16\nfolder: Cars/Engines\n---\n',
      ),
    ).toBe(true);
    expect(output).toContain(
      "> Saved from [YouTube](https://www.youtube.com/watch?v=abcDEF12345) on 2026-10-16. By Engineering Explained. Published 2026-09-30. Transcript from auto-generated captions.",
    );
  });

  it("leaves out the auto-generated transcript clause for manual captions", () => {
    const output = buildItemFile(
      newKind({ kind: "youtube", meta: { channel: "Someone", captions: "manual" } }),
      "",
    );
    expect(output).toContain("on 2026-10-16. By Someone.\n");
    expect(output).not.toContain("auto-generated captions");
  });

  it("uses the site name for a web page, else the host without www", () => {
    const withSite = buildItemFile(
      newKind({
        kind: "web",
        url: "https://www.britannica.com/technology/turbocharger",
        meta: { site: "Encyclopedia Britannica", author: "The Editors", published: "2025-03-01" },
      }),
      "",
    );
    expect(withSite).toContain(
      "> Saved from [Encyclopedia Britannica](https://www.britannica.com/technology/turbocharger) on 2026-10-16. By The Editors. Published 2025-03-01.",
    );

    const noSite = buildItemFile(
      newKind({ kind: "web", url: "https://www.example.com/article.php?id=5" }),
      "",
    );
    expect(noSite).toContain(
      "> Saved from [example.com](https://www.example.com/article.php?id=5) on 2026-10-16.",
    );
  });

  it("writes the Reddit fields and labels the source [r/<subreddit>] or [Reddit]", () => {
    const output = buildItemFile(
      newKind({
        kind: "reddit",
        url: "https://www.reddit.com/r/cars/comments/1abc2d",
        meta: {
          subreddit: "cars",
          author: "op_user",
          posted: "2026-10-15",
          score: 532,
          comments: 87,
        },
      }),
      "",
    );
    expect(
      output.startsWith(
        "---\nsource: reddit\ntitle: A title\nurl: https://www.reddit.com/r/cars/comments/1abc2d\nsubreddit: cars\nauthor: op_user\nposted: 2026-10-15\nscore: 532\ncomments: 87\nsaved: 2026-10-16\n---\n",
      ),
    ).toBe(true);
    expect(output).toContain(
      "> Saved from [r/cars](https://www.reddit.com/r/cars/comments/1abc2d) on 2026-10-16.",
    );

    const noSub = buildItemFile(newKind({ kind: "reddit" }), "");
    expect(noSub).toContain("> Saved from [Reddit](https://example.com/a) on 2026-10-16.");
  });

  it("labels an arXiv PDF [arXiv] and any other PDF by its host", () => {
    const arxiv = buildItemFile(
      newKind({
        kind: "pdf",
        url: "https://arxiv.org/abs/2401.01234",
        meta: { author: "A. Author", published: "2024-01-03", pages: 12, arxiv: "2401.01234" },
      }),
      "",
    );
    expect(arxiv).toContain('arxiv: "2401.01234"\n');
    expect(arxiv).toContain(
      "> Saved from [arXiv](https://arxiv.org/abs/2401.01234) on 2026-10-16. By A. Author. Published 2024-01-03.",
    );

    const plain = buildItemFile(
      newKind({
        kind: "pdf",
        url: "https://www.example.org/files/report.pdf",
        meta: { pages: 3 },
      }),
      "",
    );
    expect(plain).toContain(
      "> Saved from [example.org](https://www.example.org/files/report.pdf) on 2026-10-16.",
    );
  });

  it("writes the Hacker News and Bluesky fields and source lines", () => {
    const hn = buildItemFile(
      newKind({
        kind: "hackernews",
        url: "https://news.ycombinator.com/item?id=41234567",
        meta: {
          author: "builder",
          posted: "2026-10-15",
          points: 310,
          comments: 2,
          link: "https://example.com/turbo",
        },
      }),
      "",
    );
    expect(
      hn.startsWith(
        "---\nsource: hackernews\ntitle: A title\nurl: https://news.ycombinator.com/item?id=41234567\nauthor: builder\nposted: 2026-10-15\npoints: 310\ncomments: 2\nlink: https://example.com/turbo\nsaved: 2026-10-16\n---\n",
      ),
    ).toBe(true);
    expect(hn).toContain(
      "> Saved from [Hacker News](https://news.ycombinator.com/item?id=41234567) on 2026-10-16.",
    );

    const bsky = buildItemFile(
      newKind({
        kind: "bluesky",
        url: "https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l",
        meta: {
          author: "Jay",
          author_url: "https://bsky.app/profile/jay.bsky.team",
          posted: "2026-10-15",
        },
      }),
      "",
    );
    expect(
      bsky.startsWith(
        "---\nsource: bluesky\ntitle: A title\nurl: https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l\nauthor: Jay\nauthor_url: https://bsky.app/profile/jay.bsky.team\nposted: 2026-10-15\nsaved: 2026-10-16\n---\n",
      ),
    ).toBe(true);
    expect(bsky).toContain(
      "> Saved from [Bluesky](https://bsky.app/profile/jay.bsky.team/post/3l6oveex3ii2l) on 2026-10-16.",
    );
  });

  it("writes counts from strings as unquoted numbers and skips missing fields", () => {
    const output = buildItemFile(
      newKind({
        kind: "reddit",
        url: "https://www.reddit.com/r/x/comments/1abc2d",
        meta: { subreddit: "x", score: "532", comments: 0, posted: null, author: "" },
      }),
      "",
    );
    expect(output).toContain("\nscore: 532\ncomments: 0\n");
    expect(output).not.toContain("posted:");
    expect(output).not.toContain("author:");
  });

  it("always writes the arxiv field as text", () => {
    const trailingZero = buildItemFile(newKind({ kind: "pdf", meta: { arxiv: "2401.01230" } }), "");
    expect(trailingZero).toContain('\narxiv: "2401.01230"\n');
    const old = buildItemFile(newKind({ kind: "pdf", meta: { arxiv: "hep-th/9901001" } }), "");
    expect(old).toContain("\narxiv: hep-th/9901001\n");
  });

  it("round-trips every new kind byte for byte", () => {
    const items: BuildItemInput[] = [
      newKind({ kind: "youtube", meta: { channel: "C", captions: "auto-generated" } }),
      newKind({ kind: "web", meta: { site: "S" } }),
      newKind({ kind: "reddit", meta: { subreddit: "r", score: 3 } }),
      newKind({ kind: "pdf", meta: { pages: 2, arxiv: "2401.01234" } }),
      newKind({ kind: "hackernews", meta: { points: 1 } }),
      newKind({ kind: "bluesky", meta: { author: "A" } }),
    ];
    for (const item of items) {
      const first = buildItemFile(item, item.folder ?? undefined);
      const body = bodyFromDriveFile(first);
      const second = buildItemFile({ ...item, markdown: body }, item.folder ?? undefined);
      expect(second).toBe(first);
    }
  });
});

describe("highlights in the file", () => {
  const base: BuildItemInput = {
    kind: "web",
    title: "Page",
    url: "https://example.com/p",
    saved: "2026-10-16",
    body: "Body text.",
  };
  const one = {
    id: "a",
    kind: "text" as const,
    quote: "Body text.",
    image_src: null,
    note: null,
    seconds: null,
    cited: [],
    start_offset: 0,
    created_at: "2026-10-16T12:00:00.000Z",
  };

  it("writes the section after the body and before the note", () => {
    const file = buildItemFile({ ...base, note: "Mine.", highlights: [one] });
    expect(
      file.endsWith("Body text.\n\n## My highlights\n\n> Body text.\n\n## My note\n\nMine.\n"),
    ).toBe(true);
  });

  it("leaves the section out without highlights", () => {
    expect(buildItemFile({ ...base, highlights: [] })).toBe(buildItemFile(base));
    expect(buildItemFile({ ...base, highlights: null })).toBe(buildItemFile(base));
  });

  it("bodyFromDriveFile strips the highlights and the note", () => {
    const file = buildItemFile({ ...base, note: "Mine.", highlights: [one] });
    expect(bodyFromDriveFile(file)).not.toContain("My highlights");
    expect(bodyFromDriveFile(file)).not.toContain("My note");
    expect(bodyFromDriveFile(file)).toContain("Body text.");
  });

  it("strips the highlights when there is no note", () => {
    const file = buildItemFile({ ...base, highlights: [one] });
    expect(bodyFromDriveFile(file).trimEnd().endsWith("Body text.")).toBe(true);
  });

  it("rebuilding from a Drive copy never duplicates the section", () => {
    const input = { ...base, note: "Mine.", highlights: [one] };
    const first = buildItemFile(input);
    const second = buildItemFile({ ...input, markdown: first });
    expect(second).toBe(first);
    expect(second.match(/## My highlights/g)).toHaveLength(1);
  });

  it("also strips it from a body passed in as markdown", () => {
    const withSection = "Body text.\n\n## My highlights\n\n> old\n";
    expect(buildItemFile({ ...base, body: null, markdown: withSection })).toBe(buildItemFile(base));
  });
});
