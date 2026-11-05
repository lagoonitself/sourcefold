import { describe, expect, it } from "vitest";
import type { LinkWorkersSeen } from "@sourcefold/core";
import {
  badgeText,
  badgeTitle,
  canRunQueue,
  checkInBody,
  listRows,
  needsYouCount,
  rowTitle,
  viewRows,
} from "./status";
import type { LinkQueueRow } from "./types";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const alive: LinkWorkersSeen = {
  desktop_seen_at: "2026-11-06T11:59:30.000Z",
  extension_seen_at: "2026-11-06T11:59:50.000Z",
  extension_can_run: true,
};

function row(overrides: Partial<LinkQueueRow> = {}): LinkQueueRow {
  return {
    id: "r1",
    folder_id: "f1",
    url: "https://x.com/a/status/1",
    kind: "x",
    needs: "browser",
    status: "waiting",
    claimed_by: null,
    claimed_at: null,
    attempts: 0,
    message: null,
    title: null,
    item_id: null,
    added_by: "Claude",
    created_at: "2026-11-06T11:00:00.000Z",
    updated_at: "2026-11-06T11:00:00.000Z",
    ...overrides,
  };
}

describe("check-in", () => {
  it("can run only when signed in and the desktop answers", () => {
    expect(canRunQueue(true, true)).toBe(true);
    expect(canRunQueue(true, false)).toBe(false);
    expect(canRunQueue(false, true)).toBe(false);
  });

  it("builds the request body", () => {
    expect(checkInBody("extension:abc", false, "0.7.0")).toEqual({
      worker: "extension:abc",
      kind: "extension",
      can_run: false,
      version: "0.7.0",
    });
  });
});

describe("badge", () => {
  it("counts only links that need the person", () => {
    const rows = [
      row({ id: "a", status: "saved" }),
      row({ id: "b", status: "waiting" }), // up next, Chrome running
      row({ id: "c", status: "failed", message: "Allow Sourcefold to open reddit.com in Chrome" }),
      row({ id: "d", status: "failed", message: "Boom" }),
    ];
    expect(needsYouCount(rows, alive, NOW)).toBe(2);
  });

  it("counts waiting links as needing you when the helper is not running", () => {
    const none: LinkWorkersSeen = {
      desktop_seen_at: null,
      extension_seen_at: null,
      extension_can_run: false,
    };
    expect(needsYouCount([row()], none, NOW)).toBe(1);
  });

  it("falls back to neutral wording when the workers answer failed", () => {
    expect(needsYouCount([row()], null, NOW)).toBe(0);
  });

  it("formats the text", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(3)).toBe("3");
    expect(badgeText(12)).toBe("9+");
  });

  it("gives the tooltip a next step", () => {
    const title = badgeTitle([row({ status: "failed", message: "Boom" })], alive, NOW);
    expect(title).toContain("1 link needs you.");
    expect(badgeTitle([row({ status: "saved" })], alive, NOW)).toBe("Sourcefold");
  });
});

describe("list", () => {
  it("is newest first, last seven days, at most 20", () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ id: `r${i}`, created_at: new Date(NOW - i * 60_000).toISOString() }),
    );
    rows.push(row({ id: "old", created_at: "2026-10-01T00:00:00.000Z" }));
    const listed = listRows(rows, NOW);
    expect(listed).toHaveLength(20);
    expect(listed[0]?.id).toBe("r0");
    expect(listed.some((r) => r.id === "old")).toBe(false);
  });

  it("titles a row by its title or its address", () => {
    expect(rowTitle({ title: " Hello ", url: "https://x.com/a" })).toBe("Hello");
    expect(rowTitle({ title: null, url: "https://example.com/a/b" })).toBe("example.com/a/b");
  });

  it("offers the buttons that apply", () => {
    const views = viewRows(
      [
        row({
          id: "allow",
          status: "failed",
          message: "Allow Sourcefold to open reddit.com in Chrome",
        }),
        row({
          id: "signin",
          status: "failed",
          message: "Sign in to x.com in Chrome, then press Retry",
        }),
        row({ id: "failed", status: "failed", message: "Boom" }),
        row({ id: "saved", status: "saved" }),
      ],
      alive,
      NOW,
    );
    const by = Object.fromEntries(views.map((v) => [v.row.id, v]));
    expect(by.allow).toMatchObject({ allow: true, retry: false, dismiss: false });
    expect(by.signin).toMatchObject({ allow: false, retry: true, dismiss: false });
    expect(by.failed).toMatchObject({ allow: false, retry: true, dismiss: true });
    expect(by.saved).toMatchObject({ allow: false, retry: false, dismiss: false });
  });
});
