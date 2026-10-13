import { describe, expect, it } from "vitest";
import type { XTreeNode } from "../capture-types";
import { renderXThreadMarkdown, xThreadTitle } from "./markdown";

describe("xThreadTitle", () => {
  it("returns Untitled X post for empty array", () => {
    expect(xThreadTitle([])).toBe("Untitled X post");
  });

  it("returns Post by <author> (@<handle>) for single post", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/jane/status/123",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T10:00:00Z",
        text: "Single post text.",
      },
    ];
    expect(xThreadTitle(nodes)).toBe("Post by Jane Doe (@jane)");
  });

  it("handles handle with leading @", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/jane/status/123",
        authorName: "Jane Doe",
        handle: "@jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T10:00:00Z",
        text: "Single post text.",
      },
    ];
    expect(xThreadTitle(nodes)).toBe("Post by Jane Doe (@jane)");
  });

  it("returns Thread by <author> (@<handle>) when nodes.length > 1", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/jane/status/123",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T10:00:00Z",
        text: "Post 1",
      },
      {
        id: "2",
        parentId: "1",
        position: 1,
        postUrl: "https://x.com/jane/status/124",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T11:00:00Z",
        text: "Post 2",
      },
    ];
    expect(xThreadTitle(nodes)).toBe("Thread by Jane Doe (@jane)");
  });

  it("picks the lowest position root when multiple roots exist", () => {
    const nodes: XTreeNode[] = [
      {
        id: "2",
        parentId: null,
        position: 2,
        postUrl: "https://x.com/alice/status/2",
        authorName: "Alice",
        handle: "alice",
        authorUrl: "https://x.com/alice",
        postedAt: "2026-10-01T10:00:00Z",
        text: "Post 2",
      },
      {
        id: "1",
        parentId: null,
        position: 1,
        postUrl: "https://x.com/bob/status/1",
        authorName: "Bob",
        handle: "bob",
        authorUrl: "https://x.com/bob",
        postedAt: "2026-10-01T09:00:00Z",
        text: "Post 1",
      },
    ];
    expect(xThreadTitle(nodes)).toBe("Thread by Bob (@bob)");
  });
});

describe("renderXThreadMarkdown", () => {
  it("matches the exact full string for the SPEC example", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/jane/status/123",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T10:00:00Z",
        text: "First post text.",
      },
      {
        id: "2",
        parentId: "1",
        position: 0,
        postUrl: "https://x.com/jane/status/124",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: "2026-10-01T11:00:00Z",
        text: "Second post in the thread.",
      },
      {
        id: "3",
        parentId: "2",
        position: 0,
        postUrl: "https://x.com/sam/status/200",
        authorName: "Sam Lee",
        handle: "sam",
        authorUrl: "https://x.com/sam",
        postedAt: "2026-10-02T12:00:00Z",
        text: 'A reply or repost added later with "Add to this thread".',
      },
    ];

    const title = xThreadTitle(nodes);
    const md = renderXThreadMarkdown(nodes, title);

    const expected =
      "# Thread by Jane Doe (@jane)\n" +
      "\n" +
      "**Jane Doe** (@jane) · 2026-10-01 · [link](https://x.com/jane/status/123)\n" +
      "\n" +
      "First post text.\n" +
      "\n" +
      "> **Jane Doe** (@jane) · 2026-10-01 · [link](https://x.com/jane/status/124)\n" +
      ">\n" +
      "> Second post in the thread.\n" +
      ">\n" +
      "> > **Sam Lee** (@sam) · 2026-10-02 · [link](https://x.com/sam/status/200)\n" +
      "> >\n" +
      '> > A reply or repost added later with "Add to this thread".\n';

    expect(md).toBe(expected);
  });

  it("handles missing or invalid date by omitting the date and bullet", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/jane/status/123",
        authorName: "Jane Doe",
        handle: "jane",
        authorUrl: "https://x.com/jane",
        postedAt: null,
        text: "Post with missing timestamp.",
      },
      {
        id: "2",
        parentId: "1",
        position: 0,
        postUrl: "https://x.com/sam/status/456",
        authorName: "Sam Lee",
        handle: "sam",
        authorUrl: "https://x.com/sam",
        postedAt: "bad-date-format",
        text: "Post with unparseable timestamp.",
      },
    ];

    const md = renderXThreadMarkdown(nodes, "Thread with missing dates");

    expect(md).toContain("**Jane Doe** (@jane) · [link](https://x.com/jane/status/123)\n\n");
    expect(md).toContain("> **Sam Lee** (@sam) · [link](https://x.com/sam/status/456)\n>\n");
    expect(md).not.toContain("null");
    expect(md).not.toContain("bad-date");
  });

  it("renders multi-line text with blank lines correctly at depth 1 and 2", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/root/1",
        authorName: "Root",
        handle: "root",
        authorUrl: "https://x.com/root",
        postedAt: "2026-10-01",
        text: "Root post",
      },
      {
        id: "2",
        parentId: "1",
        position: 0,
        postUrl: "https://x.com/depth1/2",
        authorName: "Depth1",
        handle: "depth1",
        authorUrl: "https://x.com/depth1",
        postedAt: "2026-10-01",
        text: "Paragraph 1\n\nParagraph 2\n\nParagraph 3",
      },
      {
        id: "3",
        parentId: "2",
        position: 0,
        postUrl: "https://x.com/depth2/3",
        authorName: "Depth2",
        handle: "depth2",
        authorUrl: "https://x.com/depth2",
        postedAt: "2026-10-01",
        text: "Nested para 1\n\nNested para 2",
      },
    ];

    const md = renderXThreadMarkdown(nodes, "Multi-line test");

    expect(md).toContain("> Paragraph 1\n>\n> Paragraph 2\n>\n> Paragraph 3");
    expect(md).toContain("> > Nested para 1\n> >\n> > Nested para 2");
  });

  it("sorts siblings by position ascending, breaking ties by postedAt", () => {
    const nodes: XTreeNode[] = [
      {
        id: "root",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/root/0",
        authorName: "Root",
        handle: "root",
        authorUrl: "https://x.com/root",
        postedAt: "2026-10-01",
        text: "Root post",
      },
      {
        id: "c3",
        parentId: "root",
        position: 2,
        postUrl: "https://x.com/c3/3",
        authorName: "Child 3",
        handle: "c3",
        authorUrl: "https://x.com/c3",
        postedAt: "2026-10-01T15:00:00Z",
        text: "Position 2",
      },
      {
        id: "c1",
        parentId: "root",
        position: 1,
        postUrl: "https://x.com/c1/1",
        authorName: "Child 1",
        handle: "c1",
        authorUrl: "https://x.com/c1",
        postedAt: "2026-10-01T12:00:00Z",
        text: "Position 1 tie earlier",
      },
      {
        id: "c2",
        parentId: "root",
        position: 1,
        postUrl: "https://x.com/c2/2",
        authorName: "Child 2",
        handle: "c2",
        authorUrl: "https://x.com/c2",
        postedAt: "2026-10-01T13:00:00Z",
        text: "Position 1 tie later",
      },
    ];

    const md = renderXThreadMarkdown(nodes, "Ordering test");

    const idx1 = md.indexOf("Position 1 tie earlier");
    const idx2 = md.indexOf("Position 1 tie later");
    const idx3 = md.indexOf("Position 2");

    expect(idx1).toBeGreaterThan(-1);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it("treats orphan nodes whose parentId is not in the list as roots", () => {
    const nodes: XTreeNode[] = [
      {
        id: "orphan1",
        parentId: "non-existent-parent-1",
        position: 0,
        postUrl: "https://x.com/orphan1/1",
        authorName: "Orphan 1",
        handle: "orphan1",
        authorUrl: "https://x.com/orphan1",
        postedAt: "2026-10-01",
        text: "Orphan treated as root 1",
      },
      {
        id: "orphan2",
        parentId: "non-existent-parent-2",
        position: 1,
        postUrl: "https://x.com/orphan2/2",
        authorName: "Orphan 2",
        handle: "orphan2",
        authorUrl: "https://x.com/orphan2",
        postedAt: "2026-10-02",
        text: "Orphan treated as root 2",
      },
    ];

    const md = renderXThreadMarkdown(nodes, "Orphan test");

    expect(md).toContain("\n**Orphan 1** (@orphan1)");
    expect(md).toContain("\n**Orphan 2** (@orphan2)");
    expect(md).toContain("Orphan treated as root 1\n\n**Orphan 2**");
  });

  it("escapes leading # on text lines to prevent header collision", () => {
    const nodes: XTreeNode[] = [
      {
        id: "1",
        parentId: null,
        position: 0,
        postUrl: "https://x.com/hash/1",
        authorName: "Hashtag User",
        handle: "hash",
        authorUrl: "https://x.com/hash",
        postedAt: "2026-10-01",
        text: "#AI is changing things\n## A fake heading",
      },
      {
        id: "2",
        parentId: "1",
        position: 0,
        postUrl: "https://x.com/hash/2",
        authorName: "Reply User",
        handle: "reply",
        authorUrl: "https://x.com/reply",
        postedAt: "2026-10-01",
        text: "#Nested hashtag",
      },
    ];

    const md = renderXThreadMarkdown(nodes, "Escape test");

    expect(md).toContain("\\#AI is changing things");
    expect(md).toContain("\\## A fake heading");
    expect(md).toContain("> \\#Nested hashtag");
  });
});
