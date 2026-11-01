import { SourceError } from "@sourcefold/core";
import { YOUTUBE_BLOCKED_MESSAGE, YOUTUBE_RATE_LIMIT_WAITS_MS } from "@sourcefold/core/capture";
import type { LinkQueueRow } from "@sourcefold/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_MESSAGE,
  collectionMessage,
  formatBatchToast,
  formatChromeHint,
  formatSavingDetail,
  formatSavingStatus,
  YOUTUBE_RELEASE_MESSAGE,
} from "../copy";
import { DESKTOP_CLAIM_LIMIT, drainDesktopQueue, resetYouTubeCooldownForTests } from "../drain";
import { classifyQueuedLink, needsBrowser } from "../links";
import { createLinkQueueRunner } from "../runner";
import type { BatchSummary, DrainHooks, LinkQueuePatch, SavedLink } from "../types";
import { emptySummary } from "../types";
import { desktopWorkerId } from "../worker-id";

const FOLDER = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const VIDEO = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const VIDEO_2 = "https://www.youtube.com/watch?v=abcdefghijk";
const PAGE = "https://example.com/article";
const PAGE_2 = "https://example.com/other";

function row(partial: Partial<LinkQueueRow> & Pick<LinkQueueRow, "id" | "url">): LinkQueueRow {
  return {
    folder_id: FOLDER,
    kind: null,
    needs: "desktop",
    status: "working",
    claimed_by: "desktop:test",
    claimed_at: "2026-11-01T00:00:00.000Z",
    attempts: 1,
    message: "Waiting for the Sourcefold desktop app",
    title: null,
    item_id: null,
    added_by: "Claude",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...partial,
  };
}

function saved(title = "Saved page"): SavedLink {
  return { kind: "saved", title, itemId: ITEM };
}

function createHooks(
  over: Partial<DrainHooks> & Pick<DrainHooks, "claim" | "save">,
): DrainHooks & { patches: { id: string; body: LinkQueuePatch }[] } {
  const patches: { id: string; body: LinkQueuePatch }[] = [];
  const hooks: DrainHooks = {
    worker: "desktop:test",
    stopped: () => false,
    signal: new AbortController().signal,
    patch: async (id, body) => {
      patches.push({ id, body });
    },
    enqueueForBrowser: async () => {},
    listYouTube: async () => {
      throw new Error("unexpected YouTube list");
    },
    listPosts: async () => {
      throw new Error("unexpected publication list");
    },
    onProgress: () => {},
    wait: async () => true,
    youTubeGapMs: () => 2_000,
    ...over,
  };
  return Object.assign(hooks, { patches });
}

describe("classify and refusal", () => {
  it("splits links the way Add links does", () => {
    expect(classifyQueuedLink("https://x.com/jack/status/20", null)).toBe("x");
    expect(classifyQueuedLink(PAGE, "x")).toBe("x");
    expect(classifyQueuedLink("https://grokipedia.com/page/Rust", null)).toBe("grokipedia");
    expect(classifyQueuedLink("https://en.wikipedia.org/wiki/Rust", null)).toBe("wikipedia");
    expect(classifyQueuedLink("https://astral.substack.com/p/hello", null)).toBe("substack");
    expect(classifyQueuedLink("https://astral.substack.com", null)).toBe("publication");
    expect(classifyQueuedLink("https://www.youtube.com/playlist?list=PLabcdefghij", null)).toBe(
      "youtube_list",
    );
    expect(classifyQueuedLink("https://www.youtube.com/@veritasium", null)).toBe("youtube_list");
    expect(classifyQueuedLink(VIDEO, null)).toBe("source");
    expect(classifyQueuedLink(PAGE, null)).toBe("source");
    expect(classifyQueuedLink("not a link", null)).toBe("unknown");
  });

  it("hands refusals (Substack too) to Chrome and keeps YouTube limits", () => {
    expect(needsBrowser(new SourceError("blocked", "Reddit blocked this request."))).toBe(true);
    expect(needsBrowser(new SourceError("blocked", YOUTUBE_BLOCKED_MESSAGE))).toBe(false);
    expect(needsBrowser(new Error("The site refused the request. Try again later."))).toBe(true);
    expect(needsBrowser(new Error("This site refused the page."))).toBe(true);
    expect(needsBrowser(new Error("The page is a captcha wall."))).toBe(true);
    expect(
      needsBrowser(
        new Error("Substack refused the request. If it's a paid post, check your cookie."),
      ),
    ).toBe(true);
    expect(needsBrowser(new SourceError("not_found", "That page doesn't exist anymore."))).toBe(
      false,
    );
    expect(needsBrowser(new Error("Couldn't reach that page."))).toBe(false);
  });
});

describe("drainDesktopQueue", () => {
  beforeEach(() => resetYouTubeCooldownForTests());

  it("claims a desktop batch, saves it, and patches the row", async () => {
    const progress: { index: number; total: number; addedBy: string | null }[] = [];
    const hooks = createHooks({
      claim: async (body) => {
        expect(body).toEqual({
          needs: "desktop",
          worker: "desktop:test",
          limit: DESKTOP_CLAIM_LIMIT,
        });
        expect(DESKTOP_CLAIM_LIMIT).toBe(5);
        return [row({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", url: PAGE })];
      },
      save: async () => saved("A paper"),
      onProgress: (next) => progress.push(next),
    });

    const summary = await drainDesktopQueue(hooks);

    expect(hooks.patches).toEqual([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        body: { status: "saved", title: "A paper", item_id: ITEM },
      },
    ]);
    expect(summary.saved).toBe(1);
    expect(summary.libraryChanged).toBe(true);
    expect(summary.addedBy).toBe("Claude");
    expect(progress[0]).toMatchObject({ index: 1, total: 1, addedBy: "Claude", pause: null });
  });

  it("patches a real failure with the message Add links would show", async () => {
    const hooks = createHooks({
      claim: async () => [row({ id: "abababab-abab-4aba-8aba-abababababab", url: PAGE })],
      save: async () => {
        throw new Error("Couldn't reach that page. Check the link and try again.");
      },
    });

    const summary = await drainDesktopQueue(hooks);

    expect(hooks.patches[0]?.body).toEqual({
      status: "failed",
      message: "Couldn't reach that page. Check the link and try again.",
    });
    expect(summary.failed).toBe(1);
    expect(summary.libraryChanged).toBe(false);
  });

  it("patches a refusal as waiting for the browser", async () => {
    const hooks = createHooks({
      claim: async () => [row({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", url: PAGE })],
      save: async () => {
        throw new SourceError(
          "blocked",
          "Reddit blocked this request. Save Reddit threads with the desktop app or the Sourcefold extension.",
        );
      },
    });

    const summary = await drainDesktopQueue(hooks);

    expect(hooks.patches).toEqual([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        body: { status: "waiting", needs: "browser", message: BROWSER_MESSAGE },
      },
    ]);
    expect(summary.browser).toBe(1);
    expect(summary.libraryChanged).toBe(false);
  });

  it("sends an X post to Chrome without saving it", async () => {
    const save = vi.fn();
    const hooks = createHooks({
      claim: async () => [
        row({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", url: "https://x.com/jack/status/20" }),
      ],
      save,
    });

    await drainDesktopQueue(hooks);

    expect(save).not.toHaveBeenCalled();
    expect(hooks.patches[0]?.body).toEqual({
      status: "waiting",
      needs: "browser",
      message: BROWSER_MESSAGE,
    });
  });

  it("waits out a YouTube limit, then releases the row and leaves later YouTube for the next run", async () => {
    expect(YOUTUBE_RATE_LIMIT_WAITS_MS).toEqual([60_000, 180_000]);
    const waits: number[] = [];
    const savedUrls: string[] = [];
    const batches = [
      [
        row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", url: VIDEO }),
        row({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", url: VIDEO_2 }),
        row({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", url: PAGE }),
      ],
      [row({ id: "99999999-9999-4999-8999-999999999999", url: PAGE_2 })],
    ];
    let claims = 0;
    const hooks = createHooks({
      claim: async () => {
        claims += 1;
        return batches.shift() ?? [];
      },
      save: async (url) => {
        savedUrls.push(url);
        if (url.includes("youtube.com")) throw new SourceError("blocked", YOUTUBE_BLOCKED_MESSAGE);
        return saved("Page");
      },
      wait: async (ms) => {
        waits.push(ms);
        return true;
      },
    });

    const summary = await drainDesktopQueue(hooks);

    expect(savedUrls.filter((url) => url === VIDEO)).toHaveLength(3);
    expect(savedUrls).not.toContain(VIDEO_2);
    expect(savedUrls).toContain(PAGE);
    expect(savedUrls).not.toContain(PAGE_2);
    expect(waits).toEqual([...YOUTUBE_RATE_LIMIT_WAITS_MS]);
    expect(claims).toBe(1);
    expect(hooks.patches.map((patch) => patch.body)).toEqual([
      { status: "waiting", message: YOUTUBE_RELEASE_MESSAGE },
      { status: "waiting", message: YOUTUBE_RELEASE_MESSAGE },
      { status: "saved", title: "Page", item_id: ITEM },
    ]);
    expect(summary.youtubeLimited).toBe(true);
    expect(summary.saved).toBe(1);

    // The next run (a refresh seconds later) releases YouTube unread and makes one pass only.
    const later = [
      [
        row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", url: VIDEO }),
        row({ id: "99999999-9999-4999-8999-999999999999", url: PAGE_2 }),
      ],
      [row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", url: VIDEO })],
    ];
    let laterClaims = 0;
    const laterSaved: string[] = [];
    const next = createHooks({
      claim: async () => {
        laterClaims += 1;
        return later.shift() ?? [];
      },
      save: async (url) => {
        laterSaved.push(url);
        return saved("Page 2");
      },
    });
    await drainDesktopQueue(next);
    expect(laterClaims).toBe(1);
    expect(laterSaved).toEqual([PAGE_2]);
    expect(next.patches[0]).toEqual({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      body: { status: "waiting", message: YOUTUBE_RELEASE_MESSAGE },
    });
  });

  it("keeps claiming until the queue is empty", async () => {
    const ids = [1, 2, 3, 4, 5, 6].map(
      (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    );
    const batches = [
      ids.slice(0, 5).map((id) => row({ id, url: `${PAGE}?n=${id}` })),
      [row({ id: ids[5]!, url: PAGE_2 })],
    ];
    let claims = 0;
    const hooks = createHooks({
      claim: async () => {
        claims += 1;
        return batches.shift() ?? [];
      },
      save: async () => saved(),
    });

    const summary = await drainDesktopQueue(hooks);

    expect(claims).toBe(2);
    expect(summary.saved).toBe(6);
    expect(hooks.patches).toHaveLength(6);
  });

  it("releases rows still claimed when the user signs out", async () => {
    let stop = false;
    const savedUrls: string[] = [];
    const hooks = createHooks({
      stopped: () => stop,
      claim: async () => [
        row({ id: "12121212-1212-4121-8121-121212121212", url: `${PAGE}/first` }),
        row({ id: "13131313-1313-4131-8131-131313131313", url: `${PAGE}/second` }),
      ],
      save: async (url) => {
        savedUrls.push(url);
        stop = true;
        return saved("First");
      },
    });

    const summary = await drainDesktopQueue(hooks);

    expect(savedUrls).toEqual([`${PAGE}/first`]);
    expect(hooks.patches.map((patch) => patch.body.status)).toEqual(["saved", "waiting"]);
    expect(hooks.patches[1]?.body).toEqual({
      status: "waiting",
      message: "Waiting for the Sourcefold desktop app",
    });
    expect(summary.saved).toBe(1);
  });

  it("saves a playlist with the same pacing and reports the videos", async () => {
    const waits: number[] = [];
    const hooks = createHooks({
      claim: async () => [
        row({
          id: "14141414-1414-4141-8141-141414141414",
          url: "https://www.youtube.com/playlist?list=PLabcdefghij",
        }),
      ],
      listYouTube: async () => ({
        title: "Talks",
        truncated: false,
        videos: [
          { url: VIDEO, title: "One" },
          { url: VIDEO_2, title: "Two" },
        ],
      }),
      save: async (_url, _folder, _signal) => saved("Video"),
      wait: async (ms) => {
        waits.push(ms);
        return true;
      },
      youTubeGapMs: () => 2_500,
    });

    const summary = await drainDesktopQueue(hooks);

    expect(waits).toEqual([2_500, 2_500]);
    expect(hooks.patches[0]?.body).toEqual({
      status: "saved",
      title: "Talks",
      message: "Saved 2 videos",
    });
    expect(summary.saved).toBe(1);
    expect(summary.libraryChanged).toBe(true);
  });

  it("queues each refused post of a publication for Chrome and saves the rest", async () => {
    const queued: { folderId: string; urls: string[]; addedBy: string }[] = [];
    const hooks = createHooks({
      claim: async () => [
        row({ id: "16161616-1616-4161-8161-161616161616", url: "https://astral.substack.com" }),
      ],
      listPosts: async () => ({
        posts: [
          { url: "https://astral.substack.com/p/one", title: "One" },
          { url: "https://astral.substack.com/p/two", title: "Two" },
        ],
      }),
      save: async (url) => {
        if (url.endsWith("/two")) throw new Error("Substack refused the request.");
        return saved(url);
      },
      enqueueForBrowser: async (body) => {
        queued.push(body);
      },
    });

    const summary = await drainDesktopQueue(hooks);

    expect(queued).toEqual([
      { folderId: FOLDER, urls: ["https://astral.substack.com/p/two"], addedBy: "Claude" },
    ]);
    expect(hooks.patches[0]?.body).toEqual({
      status: "saved",
      message: "Saved 1 of 2 posts. 1 needs Chrome",
    });
    expect(summary.browser).toBe(1);
  });

  it("saves a Substack publication as its posts", async () => {
    const hooks = createHooks({
      claim: async () => [
        row({
          id: "15151515-1515-4151-8151-151515151515",
          url: "https://astral.substack.com",
        }),
      ],
      listPosts: async () => ({
        posts: [
          { url: "https://astral.substack.com/p/one", title: "One" },
          { url: "https://astral.substack.com/p/two", title: "Two" },
          { url: "https://astral.substack.com/p/three", title: "Three" },
        ],
      }),
      save: async (url) => {
        if (url.endsWith("/three")) {
          return { kind: "duplicate", title: "Three", message: "Already saved in Notes" };
        }
        return saved(url);
      },
    });

    await drainDesktopQueue(hooks);

    expect(hooks.patches[0]?.body).toEqual({
      status: "saved",
      message: "Saved 3 posts",
    });
  });
});

describe("link queue runner", () => {
  it("does not run a second drain while one is in progress", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const runner = createLinkQueueRunner(
      async () => {
        calls += 1;
        await gate;
        return emptySummary();
      },
      { signedIn: () => true, onFinished: () => {} },
    );

    const first = runner.start();
    const second = runner.start();
    expect(calls).toBe(1);
    expect(runner.running).toBe(true);
    release();
    await first;
    await second;
    expect(calls).toBe(1);
    expect(runner.running).toBe(false);
  });

  it("stops when signed out and does not toast that run", async () => {
    let signedIn = true;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sawStopped = false;
    const onFinished = vi.fn();
    const runner = createLinkQueueRunner(
      async (ctx) => {
        await gate;
        sawStopped = ctx.stopped();
        return { ...emptySummary(), saved: 1, libraryChanged: true };
      },
      { signedIn: () => signedIn, onFinished },
    );

    const pending = runner.start();
    signedIn = false;
    runner.stop();
    release();
    await pending;

    expect(sawStopped).toBe(true);
    expect(onFinished).not.toHaveBeenCalled();
  });
});

describe("queue copy", () => {
  it("matches the status and the finished-batch toast", () => {
    expect(formatSavingStatus(2, 5, "Claude")).toBe("Saving links from Claude: 2 of 5");
    expect(formatSavingDetail(2, 5, "Claude", "1 min")).toBe(
      "Saving links from Claude: 2 of 5. YouTube is limiting requests. Trying again in 1 min.",
    );
    const summary: BatchSummary = {
      ...emptySummary(),
      saved: 4,
      browser: 1,
      addedBy: "Claude",
      libraryChanged: true,
    };
    expect(formatBatchToast(summary)).toBe("Saved 4 links Claude added. 1 needs Chrome.");
    expect(formatChromeHint(1)).toBe(
      "1 link needs Chrome. Open Chrome with the Sourcefold extension to save it.",
    );
    expect(collectionMessage(23, 25, "video", false)).toBe("Saved 23 of 25 videos");
  });
});

describe("desktop worker id", () => {
  it("keeps one install id and stays within 100 characters", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const first = desktopWorkerId(storage, () => "install-1");
    const second = desktopWorkerId(storage, () => "install-2");
    expect(first).toBe("desktop:install-1");
    expect(second).toBe(first);
    expect(first.length).toBeLessThanOrEqual(100);

    const long = desktopWorkerId({ getItem: () => null, setItem: () => {} }, () => "x".repeat(200));
    expect(long.startsWith("desktop:")).toBe(true);
    expect(long.length).toBe(100);
  });
});
