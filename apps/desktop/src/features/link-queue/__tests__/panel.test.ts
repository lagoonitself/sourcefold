import type { LinkWorkersSeen } from "@sourcefold/core";
import { describe, expect, it } from "vitest";
import {
  detectChromeSaved,
  formatChromeSavedToast,
  formatPillSummary,
  groupPath,
  hasWorkToShow,
  linkTitle,
  panelNextStep,
  readLastLooked,
  rowActions,
  statusMap,
  unseenResults,
  writeLastLooked,
} from "../panel";
import type { LinkQueueRow } from "../types";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const HOUR = 3_600_000;

function row(partial: Partial<LinkQueueRow> & Pick<LinkQueueRow, "id">): LinkQueueRow {
  return {
    folder_id: "f1",
    url: "https://example.com/a",
    kind: null,
    needs: "desktop",
    status: "waiting",
    claimed_by: null,
    claimed_at: null,
    attempts: 0,
    message: null,
    title: null,
    item_id: null,
    added_by: "Claude",
    created_at: new Date(NOW - HOUR).toISOString(),
    updated_at: new Date(NOW - HOUR).toISOString(),
    ...partial,
  };
}

const alive: LinkWorkersSeen = {
  desktop_seen_at: new Date(NOW - 10_000).toISOString(),
  extension_seen_at: new Date(NOW - 10_000).toISOString(),
  extension_can_run: true,
};

describe("unseenResults", () => {
  it("keeps finished rows from the last 24 h that changed after the last look", () => {
    const rows = [
      row({ id: "new", status: "saved", updated_at: new Date(NOW - HOUR).toISOString() }),
      row({ id: "old", status: "saved", updated_at: new Date(NOW - 30 * HOUR).toISOString() }),
      row({ id: "seen", status: "saved", updated_at: new Date(NOW - 5 * HOUR).toISOString() }),
      row({ id: "cancelled", status: "cancelled" }),
      row({ id: "waiting", status: "waiting" }),
    ];
    const lastLooked = NOW - 2 * HOUR - 1;
    expect(unseenResults(rows, lastLooked, NOW).map((r) => r.id)).toEqual(["new"]);
    expect(unseenResults(rows, 0, NOW).map((r) => r.id)).toEqual(["new", "seen"]);
  });

  it("shows the button for open links, failed links or unseen results only", () => {
    const saved = row({ id: "s", status: "saved" });
    expect(hasWorkToShow([saved], NOW, NOW)).toBe(false);
    expect(hasWorkToShow([saved], 0, NOW)).toBe(true);
    expect(hasWorkToShow([row({ id: "w" })], NOW, NOW)).toBe(true);
    expect(hasWorkToShow([row({ id: "f", status: "failed" })], NOW, NOW)).toBe(true);
    expect(hasWorkToShow([], 0, NOW)).toBe(false);
  });

  it("remembers when the person last looked", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(readLastLooked(store)).toBe(0);
    writeLastLooked(NOW, store);
    expect(readLastLooked(store)).toBe(NOW);
    expect(readLastLooked(null)).toBe(0);
  });
});

describe("detectChromeSaved", () => {
  const before = [
    row({ id: "a", needs: "browser", status: "waiting" }),
    row({ id: "b", needs: "browser", status: "working" }),
    row({ id: "c", needs: "desktop", status: "waiting" }),
    row({ id: "d", needs: "browser", status: "saved" }),
  ];

  it("announces nothing on the first load", () => {
    expect(detectChromeSaved(null, before)).toBeNull();
  });

  it("counts browser rows that turned saved since the last refresh", () => {
    const next = [
      row({ id: "a", needs: "browser", status: "saved" }),
      row({ id: "b", needs: "browser", status: "saved" }),
      row({ id: "c", needs: "desktop", status: "saved" }),
      row({ id: "d", needs: "browser", status: "saved" }),
      row({ id: "e", needs: "browser", status: "saved" }),
    ];
    const saved = detectChromeSaved(statusMap(before), next);
    expect(saved).toEqual({ count: 2, addedBy: "Claude" });
    expect(formatChromeSavedToast(saved!)).toBe("Chrome saved 2 links Claude added");
  });

  it("says nothing when nothing changed, and drops the name when people differ", () => {
    expect(detectChromeSaved(statusMap(before), before)).toBeNull();
    const next = [
      row({ id: "a", needs: "browser", status: "saved", added_by: "Claude" }),
      row({ id: "b", needs: "browser", status: "saved", added_by: "Sam" }),
    ];
    const saved = detectChromeSaved(statusMap(before), next)!;
    expect(formatChromeSavedToast(saved)).toBe("Chrome saved 2 links");
    expect(formatChromeSavedToast({ count: 1, addedBy: "Claude" })).toBe(
      "Chrome saved 1 link Claude added",
    );
  });
});

describe("summary text", () => {
  it("leads with what needs the person, then waiting, then new results", () => {
    expect(formatPillSummary([row({ id: "f", status: "failed" })], alive, NOW, NOW)).toBe(
      "1 needs you",
    );
    expect(
      formatPillSummary(
        [row({ id: "f", status: "failed" }), row({ id: "g", status: "failed" })],
        alive,
        NOW,
        NOW,
      ),
    ).toBe("2 need you");
    expect(formatPillSummary([row({ id: "a" }), row({ id: "b" })], alive, NOW, NOW)).toBe(
      "2 waiting",
    );
    expect(formatPillSummary([row({ id: "s", status: "saved" })], alive, 0, NOW)).toBe("1 saved");
    expect(formatPillSummary([row({ id: "s", status: "saved" })], alive, NOW, NOW)).toBeNull();
  });

  it("gives the next step only while something needs the person", () => {
    const dead: LinkWorkersSeen = { ...alive, desktop_seen_at: null };
    expect(panelNextStep([row({ id: "a", status: "saved" })], alive, NOW)).toBeNull();
    expect(panelNextStep([row({ id: "a", needs: "browser" })], dead, NOW)).toContain("Open");
  });
});

describe("row text and actions", () => {
  it("titles a link by its title, else host and path", () => {
    expect(linkTitle({ title: " Hello ", url: "https://x.com/a" })).toBe("Hello");
    expect(linkTitle({ title: null, url: "https://www.example.com/post/1" })).toBe(
      "example.com/post/1",
    );
    expect(linkTitle({ title: null, url: "https://example.com/" })).toBe("example.com");
  });

  it("names a group by its path", () => {
    const folders = [
      { id: "p", parent_id: null, name: "Cars" },
      { id: "g", parent_id: "p", name: "Engines" },
    ];
    expect(groupPath(folders, "g")).toBe("Cars / Engines");
    expect(groupPath(folders, "missing")).toBe("");
  });

  it("offers Open, Retry and Dismiss, or Cancel, by status", () => {
    const info = (r: LinkQueueRow) => ({ state: "x" }) as never as Parameters<typeof rowActions>[1];
    expect(
      rowActions(row({ id: "a", status: "saved", item_id: "i" }), info(row({ id: "a" }))),
    ).toEqual(["open"]);
    expect(rowActions(row({ id: "a", status: "saved" }), info(row({ id: "a" })))).toEqual([]);
    expect(rowActions(row({ id: "a", status: "failed" }), info(row({ id: "a" })))).toEqual([
      "retry",
      "dismiss",
    ]);
    expect(rowActions(row({ id: "a", status: "waiting" }), info(row({ id: "a" })))).toEqual([
      "cancel",
    ]);
  });
});
