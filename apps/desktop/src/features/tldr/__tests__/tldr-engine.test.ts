import { describe, expect, it, vi } from "vitest";
import type { ItemTldr, ItemTldrInput } from "@sourcefold/core";
import type { Item } from "@/lib/types";
import { TldrEngine, type EngineDeps } from "../tldr-engine";
import { AiCallError, type AiStatus, type Completion } from "../tldr-api";

const READY: AiStatus = { provider: "openrouter", ready: true, providers: [] };
const NOT_READY: AiStatus = { provider: null, ready: false, providers: [] };

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    folder_id: "g1",
    kind: "web",
    title: `Source ${id}`,
    source_url: `https://example.com/${id}`,
    status: "saved",
    meta: {},
    created_at: "2026-10-24T10:00:00.000Z",
    ...over,
  };
}

function file(body: string) {
  return `---\nsource: web\ntitle: T\n---\n\n# T\n\n> Saved from [example.com](https://example.com) on 2026-10-24.\n\n${body}\n`;
}

const ANSWER = '{"gist":"Turbos cut lag.","points":["One","Two","Three"],"best_part":null}';

function setup(over: Partial<EngineDeps> = {}, texts: Record<string, string> = {}) {
  const saved: Array<{ id: string; input: ItemTldrInput }> = [];
  const deps: EngineDeps = {
    loadText: vi.fn(async (i: Item) => texts[i.id] ?? file("Plain text without a summary.")),
    complete: vi.fn(async (): Promise<Completion> => ({
      text: ANSWER,
      model: "Test Model",
      provider: "openrouter",
    })),
    save: vi.fn(async (id: string, input: ItemTldrInput): Promise<ItemTldr> => {
      saved.push({ id, input });
      return {
        item_id: id,
        ...input,
        created_at: "now",
        updated_at: "now",
      } as ItemTldr;
    }),
    aiStatus: vi.fn(async () => READY),
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn(),
    ...over,
  };
  const engine = new TldrEngine(deps);
  return { engine, deps, saved };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("TldrEngine", () => {
  it("writes a model TL;DR and records the model", async () => {
    const { engine, saved } = setup();
    await engine.refreshAi();
    engine.enqueue([item("a")], "new");
    await settle();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.input).toMatchObject({ source: "ai", model: "Test Model" });
    expect(engine.tldrs.get("a")?.tldr.gist).toBe("Turbos cut lag.");
    expect(engine.states.get("a")).toBeUndefined();
  });

  it("uses the article's own TL;DR without calling a model", async () => {
    const body = "Story.\n\nTL;DR: The kit cost twice the quote, so do the clutch first.";
    const { engine, deps, saved } = setup({}, { a: file(body) });
    await engine.refreshAi();
    engine.enqueue([item("a", { kind: "reddit" })], "new");
    await settle();
    expect(deps.complete).not.toHaveBeenCalled();
    expect(saved[0]!.input.source).toBe("article");
  });

  it("skips sources that have one, notes, images and unsaved sources", async () => {
    const { engine, deps } = setup();
    await engine.refreshAi();
    engine.addTldrs([
      {
        item_id: "has",
        tldr: { gist: "g", points: [], best_part: null },
        source: "ai",
        model: null,
        body_hash: null,
        created_at: "",
        updated_at: "",
      },
    ]);
    engine.enqueue(
      [
        item("has"),
        item("note", { kind: "note" }),
        item("img", { kind: "image" }),
        item("failed", { status: "failed" }),
      ],
      "new",
    );
    await settle();
    expect(deps.loadText).not.toHaveBeenCalled();
  });

  it("only treats sources saved after the start time as new saves", async () => {
    const { engine, deps } = setup();
    await engine.refreshAi();
    engine.observeNewSaves(
      [
        item("old", { created_at: "2026-10-01T00:00:00.000Z" }),
        item("new", { created_at: "2026-10-25T00:00:00.000Z" }),
      ],
      "2026-10-24T00:00:00.000Z",
    );
    await settle();
    expect((deps.loadText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].id)).toEqual([
      "new",
    ]);
  });

  it("waits for a model, then writes once one is set up", async () => {
    let status = NOT_READY;
    const { engine, deps, saved } = setup({ aiStatus: vi.fn(async () => status) });
    await engine.refreshAi();
    engine.enqueue([item("a")], "new");
    await settle();
    expect(engine.states.get("a")).toEqual({ status: "waiting" });
    expect(deps.complete).not.toHaveBeenCalled();

    status = READY;
    await engine.refreshAi();
    await settle();
    expect(saved).toHaveLength(1);
  });

  it("pauses everything on a usage limit and resumes on Try again", async () => {
    let limited = true;
    const { engine, saved } = setup({
      complete: vi.fn(async () => {
        if (limited) throw new AiCallError("limit", "Your ChatGPT usage limit is reached.");
        return { text: ANSWER, model: "M", provider: "chatgpt" as const };
      }),
    });
    await engine.refreshAi();
    engine.enqueue([item("a"), item("b"), item("c")], "new");
    await settle();
    expect(engine.pause?.code).toBe("limit");
    expect(saved).toHaveLength(0);
    // Nothing failed: they all wait to be written.
    expect([...engine.states.values()].every((s) => s.status === "queued")).toBe(true);

    limited = false;
    engine.resume();
    await settle();
    expect(engine.pause).toBeNull();
    expect(saved.map((s) => s.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("retries a temporary failure later, then gives up with a message", async () => {
    let now = 0;
    const timers: Array<() => void> = [];
    const { engine } = setup({
      now: () => now,
      setTimer: vi.fn((fn: () => void) => {
        timers.push(fn);
        return timers.length;
      }),
      complete: vi.fn(async () => {
        throw new AiCallError("unavailable", "Down for now.");
      }),
    });
    await engine.refreshAi();
    engine.enqueue([item("a")], "new");
    await settle();
    expect(engine.states.get("a")).toEqual({ status: "queued" });

    for (let round = 0; round < 3; round++) {
      now += 200_000;
      timers.splice(0).forEach((fn) => fn());
      await settle();
    }
    expect(engine.states.get("a")).toEqual({ status: "failed", message: "Down for now." });
  });

  it("puts the user's request and the focused row first", async () => {
    const order: string[] = [];
    const { engine } = setup({
      loadText: vi.fn(async (i: Item) => {
        order.push(i.id);
        return file("Plain text.");
      }),
    });
    await engine.refreshAi();
    // Fill both slots first so the rest wait in the queue.
    engine.enqueue([item("busy1"), item("busy2")], "new");
    engine.enqueue([item("n1"), item("n2")], "new");
    engine.enqueue([item("g1")], "group");
    engine.enqueue([item("m1")], "manual");
    engine.focus("n2");
    await settle();
    expect(order.slice(2)).toEqual(["m1", "g1", "n2", "n1"]);
  });

  it("tracks a picked group until it is done, and can stop it", async () => {
    const changes: string[][] = [];
    const { engine, saved } = setup({ onGroupsChanged: (ids) => changes.push(ids) });
    await engine.refreshAi();
    engine.pickGroup("g1", [item("a"), item("b")]);
    expect(engine.groupRemaining("g1")).toBe(2);
    await settle();
    expect(saved).toHaveLength(2);
    expect(engine.groupRemaining("g1")).toBeNull();
    expect(changes.at(-1)).toEqual([]);

    // Stopping drops what hasn't started.
    const slow = setup({ loadText: () => new Promise(() => {}) });
    await slow.engine.refreshAi();
    slow.engine.pickGroup("g2", [item("x"), item("y"), item("z")]);
    slow.engine.stopGroup("g2");
    expect(slow.engine.groupRemaining("g2")).toBeNull();
    expect(slow.engine.states.get("z")).toBeUndefined();
  });

  it("writes again with w, and asks the model when the old one was the article's", async () => {
    const body = "Story.\n\nTL;DR: The kit cost twice the quote, so do the clutch first.";
    const { engine, deps, saved } = setup({}, { a: file(body) });
    await engine.refreshAi();
    engine.enqueue([item("a", { kind: "reddit" })], "new");
    await settle();
    expect(saved[0]!.input.source).toBe("article");

    engine.enqueue([item("a", { kind: "reddit" })], "manual", true);
    await settle();
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(saved[1]!.input.source).toBe("ai");
  });

  it("marks a source with no text and fails an unreadable answer after one retry", async () => {
    const { engine, deps } = setup(
      {
        complete: vi.fn(async () => ({
          text: "no json",
          model: "M",
          provider: "opencode" as const,
        })),
      },
      { empty: file("   ") },
    );
    await engine.refreshAi();
    engine.enqueue([item("empty"), item("bad")], "new");
    await settle();
    expect(engine.states.get("empty")).toEqual({ status: "no_text" });
    expect(engine.states.get("bad")?.status).toBe("failed");
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });
});
