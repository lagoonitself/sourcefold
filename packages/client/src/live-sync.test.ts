import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLiveSync,
  parseSyncMessage,
  type ChannelStatus,
  type LiveSyncEnvironment,
  type LiveSyncState,
  type LiveSyncTransport,
  type SyncBatch,
} from "./live-sync";
import { DEVICE_HEADER, withDeviceHeader } from "./index";

interface FakeChannel {
  topic: string;
  send: (payload: unknown) => void;
  status: (status: ChannelStatus) => void;
  left: boolean;
}

function fakeTransport() {
  const channels: FakeChannel[] = [];
  const transport: LiveSyncTransport = {
    join(topic, onMessage, onStatus) {
      const channel: FakeChannel = {
        topic,
        send: onMessage,
        status: (s) => onStatus(s),
        left: false,
      };
      channels.push(channel);
      return () => {
        channel.left = true;
      };
    },
  };
  return { transport, channels, last: () => channels[channels.length - 1]! };
}

function fakeEnvironment() {
  const listeners = new Map<string, Set<() => void>>();
  let online = true;
  let visible = true;
  const env: LiveSyncEnvironment = {
    isOnline: () => online,
    isVisible: () => visible,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)!.delete(listener);
    },
  };
  const fire = (event: string) => listeners.get(event)?.forEach((l) => l());
  return {
    env,
    goOffline() {
      online = false;
      fire("offline");
    },
    goOnline() {
      online = true;
      fire("online");
    },
    hide() {
      visible = false;
      fire("visibilitychange");
    },
    show() {
      visible = true;
      fire("visibilitychange");
    },
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

const msg = (table: string, ids: string[] = [], device: string | null = null) => ({
  type: "broadcast",
  event: "change",
  payload: { table, op: "update", n: ids.length, ids, device },
});

function setup(options: { deviceId?: string } = {}) {
  const t = fakeTransport();
  const e = fakeEnvironment();
  const batches: SyncBatch[] = [];
  const states: LiveSyncState[] = [];
  let catchUps = 0;
  const sync = createLiveSync({
    transport: t.transport,
    userId: "u1",
    deviceId: options.deviceId ?? "me",
    environment: e.env,
    onChange: (b) => batches.push(b),
    onCatchUp: () => catchUps++,
    onState: (s) => states.push(s),
  });
  return { ...t, ...e, sync, batches, states, catchUps: () => catchUps };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("parseSyncMessage", () => {
  it("reads a broadcast envelope or a bare payload", () => {
    expect(parseSyncMessage(msg("items", ["a"]))).toEqual({
      table: "items",
      op: "update",
      n: 1,
      ids: ["a"],
      device: null,
    });
    expect(parseSyncMessage({ table: "folders", op: "insert", n: 2, device: "d" })).toMatchObject({
      table: "folders",
      ids: [],
      device: "d",
    });
  });

  it("refuses malformed messages", () => {
    expect(parseSyncMessage(null)).toBeNull();
    expect(parseSyncMessage({ payload: "x" })).toBeNull();
    expect(parseSyncMessage({ table: "items", op: "truncate" })).toBeNull();
    expect(parseSyncMessage({ table: "", op: "insert" })).toBeNull();
    expect(parseSyncMessage({ table: "items", op: "insert", ids: [1, "b", ""] })!.ids).toEqual([
      "b",
    ]);
  });
});

describe("createLiveSync", () => {
  it("joins the account's own topic and catches up once joined", () => {
    const s = setup();
    expect(s.last().topic).toBe("sync:u1");
    expect(s.sync.state()).toBe("connecting");
    s.last().status("SUBSCRIBED");
    expect(s.sync.state()).toBe("live");
    expect(s.catchUps()).toBe(1);
  });

  it("coalesces a burst into one change", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    s.last().send(msg("items", ["a"]));
    vi.advanceTimersByTime(200);
    s.last().send(msg("highlights", ["b", "a"]));
    expect(s.batches).toHaveLength(0);
    vi.advanceTimersByTime(400);
    expect(s.batches).toEqual([{ tables: ["items", "highlights"], ids: ["a", "b"], messages: 2 }]);
  });

  it("never holds a steady stream back longer than the maximum wait", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    for (let i = 0; i < 12; i++) {
      s.last().send(msg("items", [`i${i}`]));
      vi.advanceTimersByTime(300);
    }
    // Messages 300 ms apart for 3.6 s: the first burst is cut at 2 s, the rest follows.
    vi.advanceTimersByTime(1000);
    expect(s.batches).toHaveLength(2);
    expect(s.batches[0]!.messages).toBe(7);
    expect(s.batches[1]!.messages).toBe(5);
  });

  it("skips the echo of its own writes but not other devices'", () => {
    const s = setup({ deviceId: "me" });
    s.last().status("SUBSCRIBED");
    s.last().send(msg("items", ["a"], "me"));
    vi.advanceTimersByTime(3000);
    expect(s.batches).toHaveLength(0);
    s.last().send(msg("items", ["a"], "other"));
    s.last().send(msg("items", ["c"], null));
    vi.advanceTimersByTime(3000);
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0]!.messages).toBe(2);
  });

  it("ignores malformed messages", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    s.last().send({ payload: { nope: true } });
    vi.advanceTimersByTime(3000);
    expect(s.batches).toHaveLength(0);
  });

  it("rejoins with growing waits after errors and catches up again", () => {
    const s = setup();
    s.last().status("CHANNEL_ERROR");
    expect(s.channels[0]!.left).toBe(true);
    expect(s.sync.state()).toBe("connecting");
    vi.advanceTimersByTime(999);
    expect(s.channels).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(s.channels).toHaveLength(2);
    s.last().status("TIMED_OUT");
    vi.advanceTimersByTime(1999);
    expect(s.channels).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(s.channels).toHaveLength(3);
    s.last().status("SUBSCRIBED");
    expect(s.catchUps()).toBe(1);
    // A later failure starts from the short wait again.
    s.last().status("CLOSED");
    vi.advanceTimersByTime(1000);
    expect(s.channels).toHaveLength(4);
  });

  it("ignores late statuses from a channel it already left", () => {
    const s = setup();
    const first = s.last();
    first.status("CHANNEL_ERROR");
    vi.advanceTimersByTime(1000);
    first.status("SUBSCRIBED");
    expect(s.sync.state()).toBe("connecting");
    expect(s.catchUps()).toBe(0);
  });

  it("waits for the network instead of retrying while offline", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    s.goOffline();
    expect(s.sync.state()).toBe("offline");
    s.last().status("CHANNEL_ERROR");
    vi.advanceTimersByTime(60_000);
    // One retry fired, saw no network and stopped.
    expect(s.channels).toHaveLength(1);
    expect(s.sync.state()).toBe("offline");
    s.goOnline();
    expect(s.channels).toHaveLength(2);
    s.last().status("SUBSCRIBED");
    expect(s.sync.state()).toBe("live");
    expect(s.catchUps()).toBeGreaterThanOrEqual(2);
  });

  it("catches up when the window comes back into view", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    s.hide();
    expect(s.catchUps()).toBe(1);
    s.show();
    expect(s.catchUps()).toBe(2);
  });

  it("stops cleanly: leaves, drops pending changes and listeners", () => {
    const s = setup();
    s.last().status("SUBSCRIBED");
    s.last().send(msg("items", ["a"]));
    s.sync.stop();
    vi.advanceTimersByTime(5000);
    expect(s.batches).toHaveLength(0);
    expect(s.last().left).toBe(true);
    expect(s.sync.state()).toBe("off");
    expect(s.count("online")).toBe(0);
    s.last().status("CHANNEL_ERROR");
    vi.advanceTimersByTime(60_000);
    expect(s.channels).toHaveLength(1);
  });

  it("keeps going when a listener throws", () => {
    const t = fakeTransport();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    createLiveSync({
      transport: t.transport,
      userId: "u1",
      environment: null,
      onChange: () => {
        calls++;
        throw new Error("boom");
      },
      onCatchUp: () => {
        throw new Error("boom");
      },
    });
    t.last().status("SUBSCRIBED");
    t.last().send(msg("items"));
    vi.advanceTimersByTime(3000);
    t.last().send(msg("items"));
    vi.advanceTimersByTime(3000);
    expect(calls).toBe(2);
    errors.mockRestore();
  });
});

describe("withDeviceHeader", () => {
  it("adds the device header to database requests only", async () => {
    const seen: { url: string; header: string | null }[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        header: new Headers(init?.headers).get(DEVICE_HEADER),
      });
      return new Response("{}");
    }) as typeof fetch;
    const f = withDeviceHeader("dev-1", base);
    await f("https://x.supabase.co/rest/v1/items?select=*", {
      headers: { Authorization: "Bearer t" },
    });
    await f("https://x.supabase.co/functions/v1/google-access-token", { method: "POST" });
    await f(new URL("https://x.supabase.co/rest/v1/rpc/thing"));
    expect(seen.map((s) => s.header)).toEqual(["dev-1", null, "dev-1"]);
  });

  it("keeps the request's other headers", async () => {
    let auth: string | null = null;
    const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response("{}");
    }) as typeof fetch;
    await withDeviceHeader("d", base)("https://x/rest/v1/items", {
      headers: { Authorization: "Bearer t" },
    });
    expect(auth).toBe("Bearer t");
  });
});
