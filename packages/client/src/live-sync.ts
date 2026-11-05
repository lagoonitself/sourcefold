// Live sync between computers (docs/dev/PLAN-sync.md). The database sends a small message on the
// private topic `sync:<user id>` after every write to the account (migration
// 20261106000000_live_sync.sql). A message is only a wake-up call: the app reloads what it shows
// the way it always has. So a lost, late or repeated message can never lose anything, and the
// app's own timer stays as the safety net.
import type { SupabaseClient } from "@supabase/supabase-js";

/** What one database message says. Row contents are never sent. */
export interface SyncMessage {
  table: string;
  op: "insert" | "update" | "delete";
  n: number;
  ids: string[];
  device: string | null;
}

/** Everything that changed during one burst, from other devices. */
export interface SyncBatch {
  tables: string[];
  /** Row ids (for highlights, cards, TL;DRs and X posts, the source's id). At most 25 a message. */
  ids: string[];
  messages: number;
}

export type LiveSyncState = "connecting" | "live" | "offline" | "off";

export type ChannelStatus = "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

/** The part of Supabase Realtime live sync uses; tests pass a fake. */
export interface LiveSyncTransport {
  /** Joins `topic` (private). Returns a function that leaves it. */
  join(
    topic: string,
    onMessage: (payload: unknown) => void,
    onStatus: (status: ChannelStatus, error?: Error) => void,
  ): () => void;
}

/** Window events and state; tests pass a fake. */
export interface LiveSyncEnvironment {
  isOnline(): boolean;
  isVisible(): boolean;
  on(event: "online" | "offline" | "visibilitychange", listener: () => void): () => void;
}

export interface LiveSyncOptions {
  transport: LiveSyncTransport;
  userId: string;
  /** This install's id, sent with every write as `x-sourcefold-device`; its own echoes are skipped. */
  deviceId?: string | null;
  /** Called once per burst of changes made elsewhere. */
  onChange: (batch: SyncBatch) => void;
  /** Called after (re)joining, coming back online or becoming visible: messages may have been missed. */
  onCatchUp: () => void;
  onState?: (state: LiveSyncState) => void;
  environment?: LiveSyncEnvironment | null;
  /** First wait before rejoining after a failure; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** A burst ends this long after its last message... */
  quietMs?: number;
  /** ...or this long after its first, whichever comes first. */
  maxWaitMs?: number;
}

export interface LiveSync {
  state(): LiveSyncState;
  stop(): void;
}

export const SYNC_EVENT = "change";

export function syncTopic(userId: string): string {
  return `sync:${userId}`;
}

/** Reads a message's payload; anything malformed is null. */
export function parseSyncMessage(payload: unknown): SyncMessage | null {
  const raw =
    payload && typeof payload === "object" && "payload" in payload
      ? (payload as { payload: unknown }).payload
      : payload;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.table !== "string" || !m.table) return null;
  const op = m.op === "insert" || m.op === "update" || m.op === "delete" ? m.op : null;
  if (!op) return null;
  const ids = Array.isArray(m.ids)
    ? m.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return {
    table: m.table,
    op,
    n: typeof m.n === "number" && Number.isFinite(m.n) ? m.n : 0,
    ids,
    device: typeof m.device === "string" && m.device ? m.device : null,
  };
}

/** The real transport: a private Supabase Realtime channel listening for broadcasts. */
/** Any Supabase client (the apps' clients use different database types). */
export type RealtimeClient = Pick<SupabaseClient, "channel" | "realtime" | "removeChannel">;

export function supabaseSyncTransport(supabase: RealtimeClient): LiveSyncTransport {
  return {
    join(topic, onMessage, onStatus) {
      let left = false;
      const channel = supabase.channel(topic, { config: { private: true } });
      channel.on("broadcast", { event: SYNC_EVENT }, (message) => {
        if (!left) onMessage(message);
      });
      // Private channels need the user's token on the socket before joining. supabase-js keeps
      // it current after token refreshes by itself.
      void supabase.realtime
        .setAuth()
        .catch(() => undefined)
        .then(() => {
          if (left) return;
          channel.subscribe((status, error) => {
            if (!left) onStatus(status as ChannelStatus, error);
          });
        });
      return () => {
        left = true;
        void supabase.removeChannel(channel).catch(() => undefined);
      };
    },
  };
}

export function browserSyncEnvironment(): LiveSyncEnvironment | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return {
    isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
    isVisible: () => document.visibilityState !== "hidden",
    on(event, listener) {
      const target: EventTarget = event === "visibilitychange" ? document : window;
      target.addEventListener(event, listener);
      return () => target.removeEventListener(event, listener);
    },
  };
}

export function createLiveSync(options: LiveSyncOptions): LiveSync {
  const {
    transport,
    userId,
    deviceId = null,
    onChange,
    onCatchUp,
    onState,
    retryMs = 1000,
    maxRetryMs = 30_000,
    quietMs = 400,
    maxWaitMs = 2000,
  } = options;
  const env = options.environment === undefined ? browserSyncEnvironment() : options.environment;
  const topic = syncTopic(userId);

  let stopped = false;
  let current: LiveSyncState = "off";
  let leave: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let nextRetry = retryMs;
  // Bumped on every join, so a late status from an old channel is ignored.
  let generation = 0;

  let pending: { tables: Set<string>; ids: Set<string>; messages: number } | null = null;
  let burstStarted = 0;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxTimer: ReturnType<typeof setTimeout> | null = null;

  const setState = (state: LiveSyncState) => {
    if (state === current) return;
    current = state;
    onState?.(state);
  };

  const safe = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error("Live sync listener failed", err);
    }
  };

  const flush = () => {
    if (quietTimer) clearTimeout(quietTimer);
    if (maxTimer) clearTimeout(maxTimer);
    quietTimer = maxTimer = null;
    const batch = pending;
    pending = null;
    if (!batch || stopped) return;
    safe(() =>
      onChange({ tables: [...batch.tables], ids: [...batch.ids], messages: batch.messages }),
    );
  };

  const receive = (payload: unknown) => {
    if (stopped) return;
    const message = parseSyncMessage(payload);
    if (!message) return;
    if (deviceId && message.device === deviceId) return;
    if (!pending) {
      pending = { tables: new Set(), ids: new Set(), messages: 0 };
      burstStarted = Date.now();
      maxTimer = setTimeout(flush, maxWaitMs);
    }
    pending.tables.add(message.table);
    for (const id of message.ids) pending.ids.add(id);
    pending.messages += 1;
    if (quietTimer) clearTimeout(quietTimer);
    const left = Math.max(0, maxWaitMs - (Date.now() - burstStarted));
    quietTimer = setTimeout(flush, Math.min(quietMs, left));
  };

  const catchUp = () => {
    if (!stopped) safe(onCatchUp);
  };

  const leaveChannel = () => {
    const fn = leave;
    leave = null;
    if (fn) safe(fn);
  };

  const scheduleRetry = () => {
    if (stopped || retryTimer) return;
    const wait = nextRetry;
    nextRetry = Math.min(nextRetry * 2, maxRetryMs);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      join();
    }, wait);
  };

  function join() {
    if (stopped) return;
    leaveChannel();
    if (env && !env.isOnline()) {
      // Wait for the "online" event instead of failing over and over.
      setState("offline");
      return;
    }
    setState("connecting");
    const mine = ++generation;
    try {
      leave = transport.join(topic, receive, (status) => {
        if (stopped || mine !== generation) return;
        if (status === "SUBSCRIBED") {
          nextRetry = retryMs;
          setState("live");
          // Whatever happened while we weren't listening.
          catchUp();
          return;
        }
        // TIMED_OUT, CHANNEL_ERROR (including a refused or expired token) or CLOSED.
        leaveChannel();
        setState(env && !env.isOnline() ? "offline" : "connecting");
        scheduleRetry();
      });
    } catch (err) {
      console.error("Live sync couldn't join", err);
      setState("connecting");
      scheduleRetry();
    }
  }

  const offs: (() => void)[] = [];
  if (env) {
    offs.push(
      env.on("online", () => {
        if (stopped) return;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        nextRetry = retryMs;
        if (current !== "live") join();
        catchUp();
      }),
      env.on("offline", () => {
        if (!stopped && current !== "off") setState("offline");
      }),
      env.on("visibilitychange", () => {
        if (stopped || !env.isVisible()) return;
        if (current !== "live" && !retryTimer) join();
        catchUp();
      }),
    );
  }

  join();

  return {
    state: () => current,
    stop() {
      if (stopped) return;
      stopped = true;
      generation++;
      if (retryTimer) clearTimeout(retryTimer);
      if (quietTimer) clearTimeout(quietTimer);
      if (maxTimer) clearTimeout(maxTimer);
      retryTimer = quietTimer = maxTimer = null;
      pending = null;
      for (const off of offs) off();
      leaveChannel();
      current = "off";
      onState?.("off");
    },
  };
}
