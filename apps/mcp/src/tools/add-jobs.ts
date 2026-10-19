import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname } from "node:path";
import {
  YOUTUBE_RATE_LIMIT_WAITS_MS,
  isYouTubeRateLimit,
  isYouTubeVideoLink,
  waitUnlessStopped,
  youTubeGapMs,
} from "@sourcefold/core/capture";
import { listCollection, saveLink, type LinkDeps, type LinkKind } from "../links/save-link";
import { messageOf } from "./format";

// Background jobs for add_links. A Claude tool call is cut off after a minute or so, and a
// playlist takes far longer (YouTube is paced like the desktop's Add links: 2–5 s between videos,
// then waits of 1 and 3 min when it pushes back). So add_links starts a job here and answers with
// its progress; get_add_progress checks on it. Jobs run one after another, never side by side, so
// two jobs never hit YouTube at once.

export const ADD_JOBS_FILE = "mcp-add-jobs.json";

export type RowStatus =
  | "waiting"
  | "finding"
  | "saving"
  | "saved"
  | "duplicate"
  | "unavailable"
  | "paid"
  | "paused"
  | "failed"
  | "skipped";

export interface JobRow {
  url: string;
  kind: LinkKind | null;
  status: RowStatus;
  title: string | null;
  message: string | null;
  itemId: string | null;
  /** While paused: when the next try starts (ms since epoch). */
  resumeAt: number | null;
}

export interface AddJobOptions {
  limitPerCollection: number;
  publishedAfter: string | null;
  publishedBefore: string | null;
  allowDuplicates?: boolean;
}

export interface AddJob {
  id: string;
  groupId: string;
  groupPath: string;
  rows: JobRow[];
  options: AddJobOptions;
  state: "queued" | "running" | "finished" | "stopped";
  createdAt: number;
  finishedAt: number | null;
}

export interface Pacing {
  /** Pause between two YouTube videos. */
  gapMs: () => number;
  /** Waits after each YouTube rate limit before trying the same video again. */
  rateLimitWaitsMs: readonly number[];
  /** Timeout for saving a single link (default: 2 minutes). */
  linkTimeoutMs?: number;
}

export interface AddJobStore {
  load(): AddJob[];
  save(jobs: AddJob[]): void;
}

export function inMemoryJobStore(initial: AddJob[] = []): AddJobStore {
  let stored = [...initial];
  return {
    load: () => [...stored],
    save: (jobs) => {
      stored = [...jobs];
    },
  };
}

export const memoryJobStore = inMemoryJobStore;

export function fileJobStore(path: string): AddJobStore {
  return {
    load(): AddJob[] {
      try {
        const raw = fs.readFileSync(path, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as AddJob[];
      } catch (err) {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        console.error(`[sourcefold] failed to load add jobs from ${path}:`, err);
        return [];
      }
    },
    save(jobs: AddJob[]): void {
      try {
        fs.mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), "utf8");
        fs.renameSync(tmp, path);
      } catch (err) {
        console.error(`[sourcefold] failed to save add jobs to ${path}:`, err);
      }
    },
  };
}

const DEFAULT_PACING: Pacing = {
  gapMs: () => youTubeGapMs(),
  rateLimitWaitsMs: YOUTUBE_RATE_LIMIT_WAITS_MS,
  linkTimeoutMs: 120_000,
};
const KEEP_JOBS = 20;

let lastCreatedAt = 0;
function nextCreatedAt(): number {
  const now = Date.now();
  lastCreatedAt = Math.max(now, lastCreatedAt + 1);
  return lastCreatedAt;
}

const DONE: ReadonlySet<RowStatus> = new Set([
  "saved",
  "duplicate",
  "unavailable",
  "paid",
  "failed",
  "skipped",
]);

export function isRowDone(row: JobRow): boolean {
  return DONE.has(row.status);
}

function row(url: string, kind: LinkKind | null, patch: Partial<JobRow> = {}): JobRow {
  return {
    url,
    kind,
    status: "waiting",
    title: null,
    message: null,
    itemId: null,
    resumeAt: null,
    ...patch,
  };
}

export interface NewLink {
  url: string;
  kind: LinkKind | null;
}

export type JobFinishedCallback = (job: AddJob) => void;

export interface AddJobsOptions {
  store?: AddJobStore;
  onJobFinished?: JobFinishedCallback;
}

export class AddJobs {
  private readonly jobs = new Map<string, AddJob>();
  private readonly stopRequested = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private tail: Promise<void> = Promise.resolve();
  private readonly store?: AddJobStore;
  private readonly onJobFinished?: JobFinishedCallback;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastWasYouTube = false;

  constructor(
    private readonly makeDeps: () => Promise<LinkDeps>,
    private readonly pacing: Pacing = DEFAULT_PACING,
    storeOrOptions?: AddJobStore | AddJobsOptions,
    onJobFinished?: JobFinishedCallback,
  ) {
    if (storeOrOptions && "load" in storeOrOptions && "save" in storeOrOptions) {
      this.store = storeOrOptions;
      this.onJobFinished = onJobFinished;
    } else if (storeOrOptions) {
      this.store = (storeOrOptions as AddJobsOptions).store;
      this.onJobFinished = (storeOrOptions as AddJobsOptions).onJobFinished ?? onJobFinished;
    } else {
      this.store = undefined;
      this.onJobFinished = onJobFinished;
    }
  }

  restore(): void {
    if (!this.store) return;
    const loaded = this.store.load();
    if (!Array.isArray(loaded) || loaded.length === 0) return;

    const kept = [...loaded]
      .filter((j) => j && typeof j === "object" && typeof j.id === "string")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, KEEP_JOBS);

    this.jobs.clear();
    for (const job of kept) {
      this.jobs.set(job.id, job);
    }

    const unfinished = kept
      .filter((j) => j.state === "queued" || j.state === "running")
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const job of unfinished) {
      job.state = "queued";
      job.finishedAt = null;
      for (const r of job.rows) {
        if (r.status === "saving" || r.status === "finding" || r.status === "paused") {
          r.status = "waiting";
          r.resumeAt = null;
          r.message = null;
        }
      }
      this.tail = this.tail.then(() => this.run(job)).catch(() => {});
    }

    this.saveImmediate();
  }

  start(groupId: string, groupPath: string, links: NewLink[], options: AddJobOptions): AddJob {
    const job: AddJob = {
      id: randomUUID().slice(0, 8),
      groupId,
      groupPath,
      options,
      state: "queued",
      createdAt: nextCreatedAt(),
      finishedAt: null,
      rows: links.map(({ url, kind }) => {
        if (kind === null) {
          return row(url, null, {
            status: "skipped",
            message: "Sourcefold can't save this kind of link.",
          });
        }
        if (kind === "x") {
          return row(url, kind, {
            status: "skipped",
            message:
              "X posts are saved with the Sourcefold extension: open the post in Chrome and click Save.",
          });
        }
        return row(url, kind);
      }),
    };
    this.jobs.set(job.id, job);
    this.prune();
    this.saveImmediate();
    this.tail = this.tail.then(() => this.run(job)).catch(() => {});
    return job;
  }

  get(id: string): AddJob | undefined {
    return this.jobs.get(id.trim());
  }

  /** Newest first. */
  list(): AddJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Jobs queued or running before this job (by createdAt). */
  ahead(job: AddJob): AddJob[] {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          j.id !== job.id &&
          (j.state === "queued" || j.state === "running") &&
          j.createdAt < job.createdAt,
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Stops after the link being saved now; the rest stay waiting. */
  stop(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.state === "finished" || job.state === "stopped") return;
    this.stopRequested.add(id);
    if (job.state === "queued") {
      job.state = "stopped";
      job.finishedAt = Date.now();
      this.saveImmediate();
    }
    this.notify(job);
  }

  /** Resolves when the job ends or `ms` pass, whichever is first. */
  waitForEnd(job: AddJob, ms: number): Promise<void> {
    if (ms <= 0 || job.state === "finished" || job.state === "stopped") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      const set = this.waiters.get(job.id) ?? new Set();
      this.waiters.set(job.id, set);
      const check = () => {
        if (job.state === "finished" || job.state === "stopped") done();
      };
      set.add(check);
      function done() {
        clearTimeout(timer);
        set.delete(check);
        resolve();
      }
    });
  }

  private scheduleSave() {
    if (!this.store) return;
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, 1000);
    this.saveTimer.unref?.();
  }

  saveImmediate(): void {
    if (!this.store) return;
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.store.save(this.list());
  }

  private notify(job: AddJob) {
    this.scheduleSave();
    for (const waiter of this.waiters.get(job.id) ?? []) waiter();
  }

  /** Drops the oldest ended jobs once there are more than KEEP_JOBS. */
  private prune() {
    const ended = this.list()
      .filter((j) => j.state === "finished" || j.state === "stopped")
      .reverse();
    for (const job of ended) {
      if (this.jobs.size <= KEEP_JOBS) break;
      this.jobs.delete(job.id);
      this.waiters.delete(job.id);
    }
  }

  private async run(job: AddJob): Promise<void> {
    if (job.state === "stopped") return;
    job.state = "running";
    this.notify(job);
    const stopped = () => this.stopRequested.has(job.id);
    let deps: LinkDeps;
    try {
      deps = await this.makeDeps();
    } catch (err) {
      for (const r of job.rows) {
        if (!isRowDone(r)) Object.assign(r, { status: "failed", message: messageOf(err) });
      }
      this.finish(job, "finished");
      return;
    }

    // Set when YouTube kept refusing after the waits: the other videos stay waiting.
    let youTubeLimited = false;
    const isYouTubeRow = (r: JobRow) => r.kind === "source" && isYouTubeVideoLink(r.url);

    while (!stopped()) {
      const next = job.rows.find(
        (r) => r.status === "waiting" && !(youTubeLimited && isYouTubeRow(r)),
      );
      if (!next) break;

      if (next.kind === "publication" || next.kind === "youtube_list") {
        await this.expand(job, next, deps);
        this.lastWasYouTube = next.kind === "youtube_list";
        continue;
      }

      const youTube = isYouTubeRow(next);
      if (youTube && this.lastWasYouTube) {
        const waited = await waitUnlessStopped(this.pacing.gapMs(), stopped);
        if (!waited) break;
      }
      this.lastWasYouTube = youTube;

      next.status = "saving";
      this.notify(job);
      try {
        await this.saveWithRetries(job, next, deps, stopped);
      } catch (err) {
        if (stopped()) {
          Object.assign(next, { status: "waiting", message: null, resumeAt: null });
        } else if (youTube && isYouTubeRateLimit(err)) {
          youTubeLimited = true;
          Object.assign(next, {
            status: "failed",
            resumeAt: null,
            message:
              "YouTube is still limiting requests, so the other videos are left waiting. Add them again in a few minutes.",
          });
        } else {
          Object.assign(next, { status: "failed", resumeAt: null, message: messageOf(err) });
        }
      }
      this.notify(job);
    }

    if (youTubeLimited && !stopped()) {
      for (const r of job.rows) {
        if (r.status === "waiting") r.message = "Not tried: YouTube was limiting requests.";
      }
    }
    this.finish(job, stopped() ? "stopped" : "finished");
  }

  private finish(job: AddJob, state: "finished" | "stopped") {
    job.state = state;
    job.finishedAt = Date.now();
    this.stopRequested.delete(job.id);
    this.saveImmediate();
    this.notify(job);
    try {
      this.onJobFinished?.(job);
    } catch (err) {
      console.error("[sourcefold] onJobFinished error:", err);
    }
  }

  private async saveWithRetries(job: AddJob, r: JobRow, deps: LinkDeps, stopped: () => boolean) {
    const timeoutMs = this.pacing.linkTimeoutMs ?? 120_000;
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const outcome = await saveLink(
          r.url,
          r.kind as LinkKind,
          job.groupId,
          deps,
          signal,
          job.options.allowDuplicates,
        );
        Object.assign(r, {
          status: outcome.status,
          title: outcome.title ?? r.title,
          message: outcome.status === "saved" ? (outcome.message ?? null) : outcome.message,
          itemId: outcome.status === "saved" ? outcome.itemId : null,
          resumeAt: null,
        });
        if (outcome.status === "saved") await deps.desktop.changed();
        return;
      } catch (err) {
        if (signal.aborted && !stopped()) {
          throw new Error("The site took too long to answer (over 2 minutes).");
        }
        const wait = this.pacing.rateLimitWaitsMs[attempt];
        if (!isYouTubeRateLimit(err) || wait === undefined || stopped()) throw err;
        Object.assign(r, {
          status: "paused",
          resumeAt: Date.now() + wait,
          message: "YouTube is limiting requests.",
        });
        this.notify(job);
        const waited = await waitUnlessStopped(wait, stopped);
        if (!waited) throw err;
        Object.assign(r, { status: "saving", resumeAt: null, message: null });
        this.notify(job);
      }
    }
  }

  /** Replaces a playlist, channel or publication row with one row per video or post. */
  private async expand(job: AddJob, r: JobRow, deps: LinkDeps) {
    r.status = "finding";
    this.notify(job);
    try {
      const list = await listCollection(
        r.url,
        r.kind as "publication" | "youtube_list",
        {
          limit: job.options.limitPerCollection,
          publishedAfter: job.options.publishedAfter,
          publishedBefore: job.options.publishedBefore,
        },
        deps,
      );
      if (list.links.length === 0) {
        Object.assign(r, {
          status: "failed",
          message:
            r.kind === "publication" && (job.options.publishedAfter || job.options.publishedBefore)
              ? "No posts in that date range."
              : r.kind === "publication"
                ? "No posts found."
                : "No videos found.",
        });
        return;
      }
      const kind: LinkKind = r.kind === "publication" ? "substack" : "source";
      const rows = list.links.map((link) =>
        row(link.url, kind, { title: link.title, message: null }),
      );
      if (list.truncated && rows[0]) {
        rows[0].message = `Only the first ${rows.length} ${r.kind === "publication" ? "posts" : "videos"} of ${list.title ?? r.url} are added (limit_per_collection).`;
      }
      const at = job.rows.indexOf(r);
      job.rows.splice(at, 1, ...rows);
    } catch (err) {
      Object.assign(r, { status: "failed", message: messageOf(err) });
    } finally {
      this.notify(job);
    }
  }
}
