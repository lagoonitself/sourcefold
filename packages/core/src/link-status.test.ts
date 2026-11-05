import { describe, expect, it } from "vitest";
import {
  describeQueuedLink,
  summarizeLinks,
  workersAlive,
  type LinkWorkersSeen,
  type QueuedLinkInfo,
} from "./link-status";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const recent = new Date(NOW - 30_000).toISOString();
const stale = new Date(NOW - 10 * 60_000).toISOString();

function seen(desktop: string | null, extension: string | null, canRun = true): LinkWorkersSeen {
  return { desktop_seen_at: desktop, extension_seen_at: extension, extension_can_run: canRun };
}

function row(over: Partial<QueuedLinkInfo> = {}): QueuedLinkInfo {
  return { needs: "desktop", status: "waiting", message: null, ...over };
}

describe("workersAlive", () => {
  it("counts a check-in within 150 s, and Chrome only with the desktop running", () => {
    expect(workersAlive(seen(recent, recent), NOW)).toEqual({
      desktop: true,
      chrome: true,
      chromeIdle: false,
    });
    expect(workersAlive(seen(stale, recent), NOW)).toEqual({
      desktop: false,
      chrome: false,
      chromeIdle: true,
    });
    expect(workersAlive(seen(recent, recent, false), NOW).chromeIdle).toBe(true);
    expect(workersAlive(seen(null, null), NOW)).toEqual({
      desktop: false,
      chrome: false,
      chromeIdle: false,
    });
  });
});

describe("describeQueuedLink", () => {
  it("desktop links: up next while the app runs, otherwise asks to open it", () => {
    expect(describeQueuedLink(row(), seen(recent, null), NOW)).toMatchObject({
      state: "up_next",
      needsYou: false,
    });
    const closed = describeQueuedLink(row(), seen(stale, null), NOW);
    expect(closed).toMatchObject({ state: "waiting_desktop", needsYou: true });
    expect(closed.hint).toMatch(/desktop app/);
  });

  it("Chrome links name exactly what is missing", () => {
    const chrome = row({ needs: "browser" });
    expect(describeQueuedLink(chrome, seen(recent, recent), NOW).state).toBe("up_next");
    expect(describeQueuedLink(chrome, seen(recent, null), NOW).state).toBe("waiting_chrome");
    expect(describeQueuedLink(chrome, seen(null, null), NOW).state).toBe("waiting_both");
    // Chrome is open, the desktop isn't: Chrome waits for it.
    expect(describeQueuedLink(chrome, seen(null, recent, false), NOW)).toMatchObject({
      state: "waiting_desktop",
    });
    // Both open, but the extension can't run (not signed in).
    expect(describeQueuedLink(chrome, seen(recent, recent, false), NOW).hint).toMatch(/sign in/);
  });

  it("reads the extension's Allow and sign-in messages", () => {
    expect(
      describeQueuedLink(
        row({ needs: "browser", status: "failed", message: "Allow Sourcefold to open x.com in Chrome" }),
        null,
        NOW,
      ),
    ).toMatchObject({ state: "needs_allow", needsYou: true, done: false });
    const signIn = describeQueuedLink(
      row({ needs: "browser", status: "failed", message: "Sign in to x.com in Chrome, then press Retry" }),
      null,
      NOW,
    );
    expect(signIn).toMatchObject({ state: "needs_sign_in", needsYou: true });
    expect(signIn.hint).toBe("Sign in to x.com in Chrome, then press Retry.");
  });

  it("finished rows are done and need nothing", () => {
    for (const status of ["saved", "duplicate", "unavailable", "cancelled"] as const) {
      expect(describeQueuedLink(row({ status }), null, NOW)).toMatchObject({
        done: true,
        needsYou: false,
      });
    }
    expect(describeQueuedLink(row({ status: "failed", message: "Gone." }), null, NOW)).toMatchObject({
      state: "failed",
      hint: "Gone. Retry to try again.",
    });
    expect(describeQueuedLink(row({ status: "working", needs: "browser" }), null, NOW).label).toBe(
      "Saving in Chrome",
    );
  });

  it("without check-ins, waiting links are described neutrally", () => {
    expect(describeQueuedLink(row(), null, NOW)).toMatchObject({
      state: "waiting_desktop",
      needsYou: false,
    });
  });
});

describe("summarizeLinks", () => {
  it("counts and picks the first thing to do", () => {
    const summary = summarizeLinks(
      [
        row({ status: "saved" }),
        row({ status: "duplicate" }),
        row({ needs: "browser" }),
        row(),
        row({ status: "failed", message: "Gone." }),
      ],
      seen(recent, null),
      NOW,
    );
    expect(summary).toMatchObject({ total: 5, saved: 1, done: 2, moving: 1, needsYou: 2 });
    expect(summary.nextStep).toMatch(/Chrome/);
    expect(summarizeLinks([row({ status: "saved" })], seen(recent, recent), NOW).nextStep).toBeNull();
  });
});
