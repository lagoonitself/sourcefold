// The TL;DR writer (docs/dev/PLAN-tldr.md, "Queue"). One per app. It keeps the open project's
// TL;DRs, writes missing ones two at a time, and pauses everything on a usage limit or a sign-in
// problem. Three kinds of work, in this order: what the user asked for with `w`, the groups the
// user picked, then new saves. The focused row goes first within each.
import {
  buildTldrInput,
  findArticleTldr,
  kindHasTldr,
  parseTldrAnswer,
  tldrBodyHash,
  tldrUserMessage,
  TLDR_INSTRUCTIONS,
  type ItemTldr,
  type ItemTldrInput,
} from "@sourcefold/core";
import { parseReaderFile } from "@sourcefold/core/reader";
import type { Item } from "@/lib/types";
import { AiCallError, type AiStatus, type Completion } from "./tldr-api";

export type JobReason = "manual" | "group" | "new";

export type TldrItemState =
  | { status: "queued" }
  | { status: "writing" }
  /** No model is set up yet; it is written once one is. */
  | { status: "waiting" }
  | { status: "failed"; message: string }
  | { status: "no_text" };

export interface TldrPause {
  code: string;
  message: string;
}

export interface EngineDeps {
  loadText: (item: Item) => Promise<string>;
  complete: (instructions: string, input: string) => Promise<Completion>;
  save: (itemId: string, input: ItemTldrInput) => Promise<ItemTldr>;
  aiStatus: () => Promise<AiStatus>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onGroupsChanged?: (groupIds: string[]) => void;
}

interface Job {
  item: Item;
  reason: JobReason;
  force: boolean;
  attempts: number;
  notBefore: number;
}

const CONCURRENCY = 2;
const RETRY_DELAYS = [30_000, 120_000];
const PAUSING_CODES = new Set(["limit", "not_eligible", "not_configured", "auth"]);
const REASON_RANK: Record<JobReason, number> = { manual: 0, group: 1, new: 2 };

/** Whether a source can get a TL;DR at all: saved, and a kind with text. */
export function canHaveTldr(item: Pick<Item, "kind" | "status">): boolean {
  return kindHasTldr(item.kind) && (item.status ?? "saved") === "saved";
}

export class TldrEngine {
  readonly tldrs = new Map<string, ItemTldr>();
  readonly states = new Map<string, TldrItemState>();
  pause: TldrPause | null = null;
  ai: AiStatus | null = null;
  /** Bumped on every change, for useSyncExternalStore. */
  version = 0;

  private queue: Job[] = [];
  private waiting = new Map<string, Job>();
  /** The last job of each source, so "Try again" can rerun failures. */
  private lastJobs = new Map<string, Job>();
  private running = new Set<string>();
  private groupJobs = new Map<string, Set<string>>();
  private focusId: string | null = null;
  private timer: unknown = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private readonly deps: EngineDeps;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  // ----------------- Subscriptions -----------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  // ----------------- State in -----------------

  /** Forgets everything (signing in or out swaps where TL;DRs are stored). */
  reset() {
    this.generation++;
    this.tldrs.clear();
    this.states.clear();
    this.queue = [];
    this.waiting.clear();
    this.running.clear();
    this.groupJobs.clear();
    this.pause = null;
    this.clearTimer();
    this.changed();
  }

  /** Adds TL;DRs loaded from storage. */
  addTldrs(list: ItemTldr[]) {
    for (const tldr of list) this.tldrs.set(tldr.item_id, tldr);
    this.changed();
  }

  async refreshAi() {
    try {
      this.ai = await this.deps.aiStatus();
    } catch {
      this.ai = null;
    }
    if (this.ai?.ready) {
      // A model is set up now: whatever waited for one, and a paused queue, can go.
      if (this.pause && PAUSING_CODES.has(this.pause.code)) this.pause = null;
      for (const job of this.waiting.values()) this.push(job);
      this.waiting.clear();
    }
    this.changed();
    this.pump();
  }

  /** The row the user is looking at goes first. */
  focus(itemId: string | null) {
    this.focusId = itemId;
  }

  // ----------------- Work in -----------------

  /**
   * Queues `items`. Without `force`, a source that already has a TL;DR (or is queued) is
   * skipped; with it (`w`), it is written again.
   */
  enqueue(items: Item[], reason: JobReason, force = false) {
    let added = false;
    for (const item of items) {
      if (!canHaveTldr(item)) continue;
      if (!force && this.tldrs.has(item.id)) continue;
      const state = this.states.get(item.id);
      if (!force && state && state.status !== "failed") continue;
      if (this.running.has(item.id)) continue;
      const existing = this.queue.find((j) => j.item.id === item.id);
      if (existing) {
        if (REASON_RANK[reason] < REASON_RANK[existing.reason]) existing.reason = reason;
        existing.force ||= force;
        continue;
      }
      this.waiting.delete(item.id);
      this.push({ item, reason, force, attempts: 0, notBefore: 0 });
      added = true;
    }
    if (added) {
      this.changed();
      this.pump();
    }
  }

  /** New saves: sources saved after `since` that have no TL;DR. */
  observeNewSaves(items: Item[], since: string) {
    const from = Date.parse(since);
    this.enqueue(
      items.filter((i) => Date.parse(i.created_at) >= from),
      "new",
    );
  }

  /** A picked group: every source in it (and its subgroups) without a TL;DR. */
  pickGroup(groupId: string, items: Item[]) {
    const missing = items.filter((i) => canHaveTldr(i) && !this.tldrs.has(i.id));
    if (missing.length === 0) {
      this.finishGroup(groupId);
      return;
    }
    this.groupJobs.set(groupId, new Set(missing.map((i) => i.id)));
    this.notifyGroups();
    this.enqueue(missing, "group");
  }

  /** Stops a picked group: its queued sources are dropped (ones being written finish). */
  stopGroup(groupId: string) {
    const remaining = this.groupJobs.get(groupId);
    if (!remaining) return;
    this.queue = this.queue.filter((job) => {
      if (job.reason !== "group" || !remaining.has(job.item.id)) return true;
      this.states.delete(job.item.id);
      return false;
    });
    for (const id of remaining) {
      if (this.states.get(id)?.status === "waiting") {
        this.states.delete(id);
        this.waiting.delete(id);
      }
    }
    this.finishGroup(groupId);
    this.changed();
  }

  /** Sources still to do in a picked group, or null when it isn't picked. */
  groupRemaining(groupId: string): number | null {
    return this.groupJobs.get(groupId)?.size ?? null;
  }

  pickedGroupIds(): string[] {
    return [...this.groupJobs.keys()];
  }

  /** "Try again" after a pause or failures: clears the pause and retries failed sources. */
  resume() {
    this.pause = null;
    const failed: Item[] = [];
    for (const [id, state] of this.states) {
      if (state.status === "failed") {
        const job = this.lastJobs.get(id);
        if (job) failed.push(job.item);
      }
    }
    for (const item of failed) {
      const job = this.lastJobs.get(item.id)!;
      this.states.delete(item.id);
      this.push({ ...job, attempts: 0, notBefore: 0 });
    }
    this.changed();
    void this.refreshAi();
  }

  // ----------------- The loop -----------------

  private push(job: Job) {
    this.lastJobs.set(job.item.id, job);
    this.queue.push(job);
    this.states.set(job.item.id, { status: "queued" });
  }

  private clearTimer() {
    if (this.timer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
      this.timer = null;
    }
  }

  private nextJob(): Job | null {
    const now = this.now();
    let best: Job | null = null;
    for (const job of this.queue) {
      if (job.notBefore > now || this.running.has(job.item.id)) continue;
      if (!best || this.before(job, best)) best = job;
    }
    if (best) this.queue.splice(this.queue.indexOf(best), 1);
    return best;
  }

  private before(a: Job, b: Job): boolean {
    if (REASON_RANK[a.reason] !== REASON_RANK[b.reason]) {
      return REASON_RANK[a.reason] < REASON_RANK[b.reason];
    }
    const af = a.item.id === this.focusId;
    const bf = b.item.id === this.focusId;
    if (af !== bf) return af;
    return a.item.created_at > b.item.created_at;
  }

  private pump() {
    if (this.pause) return;
    while (this.running.size < CONCURRENCY) {
      const job = this.nextJob();
      if (!job) break;
      this.running.add(job.item.id);
      void this.run(job, this.generation);
    }
    // Something is waiting for its retry time: wake up then.
    this.clearTimer();
    const delayed = this.queue.filter((j) => j.notBefore > this.now());
    if (delayed.length > 0 && this.running.size < CONCURRENCY) {
      const wait = Math.min(...delayed.map((j) => j.notBefore)) - this.now();
      this.timer = (this.deps.setTimer ?? setTimeout)(
        () => {
          this.timer = null;
          this.pump();
        },
        Math.max(50, wait),
      );
    }
  }

  private async run(job: Job, generation: number) {
    const id = job.item.id;
    // Its TL;DR may have loaded from storage after it was queued.
    if (!job.force && this.tldrs.has(id)) {
      this.states.delete(id);
      this.running.delete(id);
      this.doneInGroups(id);
      this.changed();
      this.pump();
      return;
    }
    this.states.set(id, { status: "writing" });
    this.changed();
    try {
      const outcome = await this.write(job);
      if (generation !== this.generation) return;
      if (outcome === "waiting") {
        this.states.set(id, { status: "waiting" });
        this.waiting.set(id, job);
      } else if (outcome === "no_text") {
        this.states.set(id, { status: "no_text" });
        this.doneInGroups(id);
      } else {
        this.tldrs.set(id, outcome);
        this.states.delete(id);
        this.doneInGroups(id);
      }
    } catch (err) {
      if (generation !== this.generation) return;
      this.failed(job, err);
    } finally {
      if (generation === this.generation) {
        this.running.delete(id);
        this.changed();
        this.pump();
      }
    }
  }

  private failed(job: Job, err: unknown) {
    const id = job.item.id;
    const ai = err instanceof AiCallError ? err : null;
    if (ai && PAUSING_CODES.has(ai.code)) {
      // Everything stops until the user acts (or a model gets set up); this source goes back.
      this.pause = { code: ai.code, message: ai.message };
      this.queue.unshift({ ...job, notBefore: 0 });
      this.states.set(id, { status: "queued" });
      return;
    }
    const retryable = ai ? ai.code === "unavailable" || ai.code === "network" : false;
    if (retryable && job.attempts < RETRY_DELAYS.length) {
      const delay = Math.max(RETRY_DELAYS[job.attempts]!, (ai?.retryAfter ?? 0) * 1000);
      this.queue.push({ ...job, attempts: job.attempts + 1, notBefore: this.now() + delay });
      this.states.set(id, { status: "queued" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.states.set(id, { status: "failed", message: message || "Couldn't write this TL;DR." });
    this.doneInGroups(id);
  }

  /** Writes one TL;DR: the article's own when it has one, else the model's. */
  private async write(job: Job): Promise<ItemTldr | "no_text" | "waiting"> {
    const { item } = job;
    const parsed = parseReaderFile(await this.deps.loadText(item));
    const body = parsed.body.trim();
    if (!body) return "no_text";
    const hash = tldrBodyHash(body);
    const existing = this.tldrs.get(item.id);

    // `w` on the article's own TL;DR asks for the model's instead.
    const wantsModel = job.force && existing?.source === "article";
    const article = wantsModel ? null : findArticleTldr({ kind: item.kind, body });
    if (article) {
      return await this.deps.save(item.id, {
        tldr: article,
        source: "article",
        model: null,
        body_hash: hash,
      });
    }

    if (!this.ai?.ready) {
      await this.refreshAi();
      if (!this.ai?.ready) return "waiting";
    }

    const input = buildTldrInput({
      title: parsed.title ?? item.title,
      kind: item.kind,
      frontMatter: parsed.frontMatter,
      body,
    });
    let answer = await this.deps.complete(TLDR_INSTRUCTIONS, tldrUserMessage(input.text));
    let tldr = parseTldrAnswer(answer.text);
    if (!tldr) {
      // One more try: models sometimes wrap or cut the JSON.
      answer = await this.deps.complete(TLDR_INSTRUCTIONS, tldrUserMessage(input.text));
      tldr = parseTldrAnswer(answer.text);
    }
    if (!tldr)
      throw new Error("The model's answer couldn't be read. Try again or pick another model.");
    return await this.deps.save(item.id, {
      tldr,
      source: "ai",
      model: answer.model,
      body_hash: hash,
    });
  }

  private doneInGroups(itemId: string) {
    let changedGroups = false;
    for (const [groupId, remaining] of this.groupJobs) {
      if (remaining.delete(itemId) && remaining.size === 0) {
        this.groupJobs.delete(groupId);
        changedGroups = true;
      }
    }
    if (changedGroups) this.notifyGroups();
  }

  private finishGroup(groupId: string) {
    if (this.groupJobs.delete(groupId)) this.notifyGroups();
  }

  private notifyGroups() {
    this.deps.onGroupsChanged?.(this.pickedGroupIds());
  }
}
