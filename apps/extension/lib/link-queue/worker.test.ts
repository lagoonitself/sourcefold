import { describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "../capture-page";
import { permissionBannerText, progressText, signInMessage } from "./copy";
import { EMPTY_LINK_QUEUE_STATE, type LinkQueueRow, type LinkQueueState } from "./types";
import { createLinkQueueController, type LinkQueueDeps } from "./worker";

const webCapture: CaptureResult = {
  kind: "source",
  result: {
    status: "ok",
    kind: "web",
    capture: { url: "https://example.com/post", title: "Example", meta: {}, markdown: "Hello" },
  },
};

function row(overrides: Partial<LinkQueueRow> = {}): LinkQueueRow {
  return {
    id: "row-1",
    folder_id: "folder-1",
    url: "https://example.com/post",
    kind: "web",
    needs: "browser",
    status: "working",
    claimed_by: "extension:test",
    claimed_at: "2026-11-01T00:00:00.000Z",
    attempts: 1,
    message: null,
    title: null,
    item_id: null,
    added_by: "Claude",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function controller(
  partial: Partial<Omit<LinkQueueDeps, "api">> & { api?: Partial<LinkQueueDeps["api"]> } = {},
) {
  let state: LinkQueueState = EMPTY_LINK_QUEUE_STATE;
  const seen: LinkQueueState[] = [];
  const { api: apiPartial, ...rest } = partial;
  const deps: LinkQueueDeps = {
    signedIn: async () => true,
    desktopReachable: async () => true,
    workerId: async () => "extension:test",
    permissionsContains: async () => true,
    openTab: async () => 4,
    closeTab: async () => {},
    waitForLoad: async () => "complete",
    capture: async () => webCapture,
    needsSignIn: async () => false,
    save: async () => ({ status: "saved", itemId: "item-1", title: "Example" }),
    readState: async () => state,
    writeState: async (next) => {
      state = next;
      seen.push(next);
    },
    sleep: async () => {},
    timeoutMs: 45_000,
    paceMs: 0,
    pollMs: 0,
    ...rest,
    api: {
      claim: async () => [],
      patch: async () => {},
      listOpen: async () => [],
      listRecent: async () => [],
      ...apiPartial,
    },
  };
  return { ...createLinkQueueController(deps), state: () => state, seen };
}

describe("link queue copy", () => {
  it("describes the permission banner and the saving line", () => {
    expect(permissionBannerText(2, ["x.com", "reddit.com"])).toBe(
      "2 links need your OK to open x.com, reddit.com",
    );
    expect(permissionBannerText(1, ["x.com"])).toBe("1 link needs your OK to open x.com");
    expect(progressText({ index: 1, total: 3, addedBy: "Claude" })).toBe(
      "Saving 1 of 3 links Claude added…",
    );
    expect(signInMessage("x.com")).toBe("Sign in to x.com in Chrome, then press Retry");
  });
});

describe("link queue worker", () => {
  it("claims a browser row, captures the tab, and patches the save", async () => {
    const claimed = row();
    const others = [row({ id: "row-2" }), row({ id: "row-3" })];
    let claims = 0;
    const openTab = vi.fn(async () => 4);
    const closeTab = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const capture = vi.fn(async () => webCapture);
    const save = vi.fn(async () => ({
      status: "saved" as const,
      itemId: "item-1",
      title: "Example",
    }));
    const { run, seen } = controller({
      openTab,
      closeTab,
      capture,
      save,
      api: {
        claim: async (worker) => {
          expect(worker).toBe("extension:test");
          claims += 1;
          return claims === 1 ? [claimed] : [];
        },
        patch,
        listOpen: async () => [claimed, ...others],
        listRecent: async () => [],
      },
    });

    await run();

    expect(openTab).toHaveBeenCalledWith("https://example.com/post");
    expect(capture).toHaveBeenCalledWith(4);
    expect(save).toHaveBeenCalledWith(claimed.url, claimed.folder_id, webCapture);
    expect(patch).toHaveBeenCalledWith("row-1", {
      status: "saved",
      item_id: "item-1",
      title: "Example",
    });
    expect(closeTab).toHaveBeenCalledWith(4);
    expect(seen.some((item) => item.progress?.index === 1 && item.progress.total === 3)).toBe(true);
    expect(seen.at(-1)?.progress).toBeNull();
  });

  it("sets the row aside and records the banner when the host permission is missing", async () => {
    const claimed = row({ url: "https://x.com/jack/status/20", kind: "x" });
    const reddit = row({ id: "row-2", url: "https://www.reddit.com/r/test", kind: "reddit" });
    const patch = vi.fn(async () => {});
    const openTab = vi.fn();
    const { run, state } = controller({
      openTab,
      permissionsContains: async () => false,
      api: {
        claim: async () => [claimed],
        patch,
        listOpen: async () => [claimed, reddit],
        listRecent: async () => [],
      },
    });

    await run();

    expect(openTab).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(claimed.id, {
      status: "failed",
      message: "Allow Sourcefold to open x.com in Chrome",
    });
    expect(state().permission).toEqual({
      count: 2,
      hosts: ["x.com", "reddit.com"],
      origins: ["https://x.com/*", "https://www.reddit.com/*"],
    });
  });

  it("sets aside a link for a site not yet allowed and saves the rest", async () => {
    const xRow = row({ id: "row-x", url: "https://x.com/jack/status/20", kind: "x" });
    const page = row({ id: "row-web", url: "https://example.com/post" });
    const claims = [[xRow, page]];
    const patch = vi.fn(async () => {});
    const openTab = vi.fn(async () => 4);
    const { run } = controller({
      openTab,
      permissionsContains: async (origins) => !origins.includes("https://x.com/*"),
      api: {
        claim: async () => claims.shift() ?? [],
        patch,
        listOpen: async () => [xRow, page],
        listRecent: async () => [],
      },
    });

    await run();

    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith(page.url);
    expect(patch).toHaveBeenCalledWith(page.id, expect.objectContaining({ status: "saved" }));
    // Set aside (failed), so later claims skip it; Allow in the popup puts it back in line.
    expect(patch).toHaveBeenCalledWith(xRow.id, {
      status: "failed",
      message: "Allow Sourcefold to open x.com in Chrome",
    });
    expect(claims).toHaveLength(0);
  });

  it("shows the Allow banner, not Retry, for links set aside for a permission", async () => {
    const setAside = row({
      id: "row-x",
      url: "https://x.com/jack/status/20",
      status: "failed",
      message: "Allow Sourcefold to open x.com in Chrome",
    });
    const { run, state } = controller({
      permissionsContains: async () => false,
      api: { listRecent: async () => [setAside] },
    });

    await run();

    expect(state().permission).toMatchObject({ count: 1, hosts: ["x.com"] });
    expect(state().failed).toBeNull();
  });

  it("closes the tab when the page does not finish loading", async () => {
    const claimed = row();
    let claims = 0;
    const closeTab = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const save = vi.fn();
    const { run } = controller({
      closeTab,
      save,
      waitForLoad: async () => "timeout",
      openTab: async () => 9,
      api: {
        claim: async () => {
          claims += 1;
          return claims === 1 ? [claimed] : [];
        },
        patch,
      },
    });

    await run();

    expect(closeTab).toHaveBeenCalledWith(9);
    expect(save).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(claimed.id, {
      status: "failed",
      message: "This page took too long to open.",
    });
  });

  it("closes the tab when saving throws", async () => {
    const closeTab = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    let claims = 0;
    const { run } = controller({
      closeTab,
      save: async () => {
        throw new Error("Drive is offline.");
      },
      api: {
        claim: async () => {
          claims += 1;
          return claims === 1 ? [row()] : [];
        },
        patch,
      },
    });

    await run();

    expect(closeTab).toHaveBeenCalledWith(4);
    expect(patch).toHaveBeenCalledWith("row-1", {
      status: "failed",
      message: "Drive is offline.",
    });
  });

  it("does nothing when the desktop app is not reachable", async () => {
    const claim = vi.fn();
    const openTab = vi.fn();
    const signedIn = vi.fn(async () => true);
    const { run } = controller({
      desktopReachable: async () => false,
      signedIn,
      openTab,
      api: { claim },
    });

    await run();

    expect(claim).not.toHaveBeenCalled();
    expect(openTab).not.toHaveBeenCalled();
    expect(signedIn).not.toHaveBeenCalled();
  });

  it("does nothing when signed out", async () => {
    const claim = vi.fn();
    const { run } = controller({
      signedIn: async () => false,
      api: { claim },
    });

    await run();

    expect(claim).not.toHaveBeenCalled();
  });

  it("fails an X login wall and tells the reader to retry", async () => {
    const claimed = row({ url: "https://x.com/jack/status/20", kind: "x" });
    let claims = 0;
    const closeTab = vi.fn(async () => {});
    const patch = vi.fn(async () => {});
    const save = vi.fn();
    const { run } = controller({
      closeTab,
      save,
      needsSignIn: async () => true,
      capture: async () => ({
        kind: "x",
        result: {
          status: "error",
          message: "Couldn't find the post on this page. Scroll to it and try again.",
        },
      }),
      api: {
        claim: async () => {
          claims += 1;
          return claims === 1 ? [claimed] : [];
        },
        patch,
      },
    });

    await run();

    expect(save).not.toHaveBeenCalled();
    expect(closeTab).toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(claimed.id, {
      status: "failed",
      message: "Sign in to x.com in Chrome, then press Retry",
    });
  });

  it("does not open a second tab while the first capture is still running", async () => {
    let release: (value: CaptureResult) => void = () => {};
    const gate = new Promise<CaptureResult>((resolve) => {
      release = resolve;
    });
    let open = 0;
    let max = 0;
    let claims = 0;
    const { run } = controller({
      capture: () => gate,
      openTab: async () => {
        open += 1;
        max = Math.max(max, open);
        return 1;
      },
      closeTab: async () => {
        open -= 1;
      },
      api: {
        claim: async () => {
          claims += 1;
          return claims === 1 ? [row()] : [];
        },
      },
    });

    const first = run();
    await vi.waitFor(() => expect(open).toBe(1));
    const second = run();
    await Promise.resolve();
    expect(max).toBe(1);
    release(webCapture);
    await first;
    await second;
    expect(max).toBe(1);
    expect(open).toBe(0);
  });

  it("puts failed browser rows back to waiting on retry", async () => {
    const failed = row({
      status: "failed",
      message: "Sign in to x.com in Chrome, then press Retry",
    });
    const patch = vi.fn(async () => {});
    const claim = vi.fn(async () => []);
    const { retryFailed } = controller({
      api: {
        claim,
        patch,
        listRecent: vi.fn().mockResolvedValueOnce([failed]).mockResolvedValue([]),
      },
    });

    await retryFailed();

    expect(patch).toHaveBeenCalledWith(failed.id, { status: "waiting", needs: "browser" });
    expect(claim).toHaveBeenCalled();
  });

  it("reports how many links a run saved", async () => {
    let claims = 0;
    const onSaved = vi.fn();
    const { run } = controller({
      onSaved,
      api: {
        claim: async () => {
          claims += 1;
          return claims === 1 ? [row()] : [];
        },
      },
    });
    await run();
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  it("does not report a run that saved nothing", async () => {
    const onSaved = vi.fn();
    const { run } = controller({ onSaved });
    await run();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
