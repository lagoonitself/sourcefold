import { describe, expect, it, vi } from "vitest";
import { openSource, openTargetFor, opensInReader } from "../open-decision";

const url = "https://example.com/page";

describe("openTargetFor", () => {
  it.each([
    "grokipedia",
    "substack",
    "x",
    "wikipedia",
    "note",
    "youtube",
    "web",
    "reddit",
    "pdf",
    "hackernews",
    "bluesky",
  ])("opens %s in the reader even when no text is loaded", (kind) => {
    expect(openTargetFor({ kind, source_url: url, markdown: null })).toBe("reader");
    expect(openTargetFor({ kind, source_url: null, markdown: null })).toBe("reader");
  });

  it("opens images in the image viewer, whatever the modifier", () => {
    expect(openTargetFor({ kind: "image", source_url: url })).toBe("image");
    expect(openTargetFor({ kind: "image", source_url: url }, true)).toBe("image");
  });

  it("opens the original page when asked, for sources that have a link", () => {
    expect(openTargetFor({ kind: "grokipedia", source_url: url }, true)).toBe("browser");
    expect(openTargetFor({ kind: "x", canonical_url: url }, true)).toBe("browser");
  });

  it("falls back to the reader for a source with no link, such as a note", () => {
    expect(openTargetFor({ kind: "note" }, true)).toBe("reader");
  });

  it("sends an unknown kind to the browser unless its text is at hand", () => {
    expect(openTargetFor({ kind: "other", source_url: url })).toBe("browser");
    expect(openTargetFor({ kind: "other", source_url: url, markdown: "# Text" })).toBe("reader");
    expect(openTargetFor({ kind: "other" })).toBe("none");
  });

  it.each(["substack", "youtube", "web", "reddit", "pdf", "hackernews", "bluesky"])(
    "opens an unavailable %s item in the browser",
    (kind) => {
      expect(openTargetFor({ kind, source_url: url, status: "unavailable" })).toBe("browser");
    },
  );
});

describe("opensInReader", () => {
  it("is false for images, even with text", () => {
    expect(opensInReader({ kind: "image", markdown: "text" })).toBe(false);
  });
});

describe("openSource", () => {
  it("calls only the handler for the chosen target", () => {
    const handlers = { reader: vi.fn(), browser: vi.fn(), image: vi.fn() };
    const item = { kind: "substack", source_url: url };

    expect(openSource(item, handlers)).toBe("reader");
    expect(handlers.reader).toHaveBeenCalledWith(item);

    expect(openSource(item, handlers, { forceExternal: true })).toBe("browser");
    expect(handlers.browser).toHaveBeenCalledWith(url, item);

    const image = { kind: "image" };
    expect(openSource(image, handlers)).toBe("image");
    expect(handlers.image).toHaveBeenCalledWith(image);

    expect(handlers.reader).toHaveBeenCalledTimes(1);
    expect(handlers.browser).toHaveBeenCalledTimes(1);
    expect(handlers.image).toHaveBeenCalledTimes(1);
  });
});
