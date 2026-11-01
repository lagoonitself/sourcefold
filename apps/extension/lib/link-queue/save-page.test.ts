import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import type { CaptureResult } from "../capture-page";
import { CANNOT_SAVE_MESSAGE, PAID_POST_MESSAGE } from "./copy";
import { saveQueuePage, type PageSaver } from "./save-page";

function saver(partial: Partial<PageSaver> = {}): PageSaver {
  return {
    saveGrokipedia: vi.fn(async () => ({ item: { id: "g1", title: "Article" } })),
    capture: vi.fn(async () => ({ item: { id: "item-1", title: "Saved title" } })),
    enrichXPostsMedia: vi.fn(async (posts) => posts),
    ...partial,
  };
}

const web: CaptureResult = {
  kind: "source",
  result: {
    status: "ok",
    kind: "web",
    capture: { url: "https://example.com/post", title: "Example", meta: {}, markdown: "Hello" },
  },
};

describe("saveQueuePage", () => {
  it("saves a captured page with the same capture body the popup sends", async () => {
    const save = saver();
    const outcome = await saveQueuePage("https://example.com/post", "folder-1", web, save);
    expect(save.capture).toHaveBeenCalledWith({
      kind: "web",
      folder_id: "folder-1",
      capture: web.kind === "source" && web.result.status === "ok" ? web.result.capture : null,
    });
    expect(outcome).toEqual({ status: "saved", itemId: "item-1", title: "Example" });
  });

  it("reports a duplicate the way the popup treats a 409", async () => {
    const save = saver({
      capture: vi.fn(async () => {
        throw new ApiError("Already in this group", 409, "duplicate");
      }),
    });
    const outcome = await saveQueuePage("https://example.com/post", "folder-1", web, save);
    expect(outcome).toEqual({ status: "duplicate", message: "Already saved" });
  });

  it("saves a paid Substack post as unavailable", async () => {
    const save = saver();
    const captured: CaptureResult = {
      kind: "substack",
      result: { status: "paywalled", url: "https://news.substack.com/p/paid", title: "Paid" },
    };
    const outcome = await saveQueuePage(
      captured.result.status === "paywalled" ? captured.result.url : "",
      "folder-1",
      captured,
      save,
    );
    expect(save.capture).toHaveBeenCalledWith({
      kind: "substack_unavailable",
      folder_id: "folder-1",
      url: "https://news.substack.com/p/paid",
      title: "Paid",
    });
    expect(outcome).toEqual({
      status: "unavailable",
      itemId: "item-1",
      title: "Paid",
      message: PAID_POST_MESSAGE,
    });
  });

  it("saves a Grokipedia article without the capture script", async () => {
    const save = saver();
    const outcome = await saveQueuePage(
      "https://grokipedia.com/page/Engines",
      "folder-1",
      { kind: "unsupported" },
      save,
    );
    expect(save.saveGrokipedia).toHaveBeenCalledWith(
      "https://grokipedia.com/page/Engines",
      "folder-1",
    );
    expect(save.capture).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "saved", itemId: "g1", title: "Article" });
  });

  it("uses the popup's message when the page can't be saved", async () => {
    const outcome = await saveQueuePage(
      "https://example.com/post",
      "folder-1",
      { kind: "unsupported" },
      saver(),
    );
    expect(outcome).toEqual({ status: "failed", message: CANNOT_SAVE_MESSAGE });
  });
});
