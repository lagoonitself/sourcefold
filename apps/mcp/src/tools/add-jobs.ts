import { randomUUID } from "node:crypto";
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
// two jobs never hit YouTube at once. They live as long as this server process (Claude Desktop).

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
}

const DEFAULT_PACING: Pacing = {
  gapMs: () => youTubeGapMs(),
  rateLimitWaitsMs: YOUTUBE_RATE_LIMIT_WAITS_MS,
};
const KEEP_JOBS = 20;

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

export class AddJobs {
  private readonly jobs = new Map<string, AddJob>();
  private readonly stopRequested = new Set<string>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly makeDeps: () => Promise<LinkDeps>,
    private readonly pacing: Pacing = DEFAULT_PACING,
  ) {}

  start(groupId: string, groupPath: string, links: NewLink[], options: AddJobOptions): AddJob {
    const job: AddJob = {
      id: randomUUID().slice(0, 8),
      groupId,
      groupPath,
      options,
      state: "queued",
      createdAt: Date.now(),
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

  /** Stops after the link being saved now; the rest stay waiting. */
  stop(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.state === "finished" || job.state === "stopped") return;
    this.stopRequested.add(id);
    if (job.state === "queued") {
      job.state = "stopped";
      job.finishedAt = Date.now();
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

  private notify(job: AddJob) {
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

    let lastWasYouTube = false;
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
        lastWasYouTube = next.kind === "youtube_list";
        continue;
      }

      const youTube = isYouTubeRow(next);
      if (youTube && lastWasYouTube) {
        const waited = await waitUnlessStopped(this.pacing.gapMs(), stopped);
        if (!waited) break;
      }
      lastWasYouTube = youTube;

      next.status = "saving";
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
    this.notify(job);
  }

  private async saveWithRetries(job: AddJob, r: JobRow, deps: LinkDeps, stopped: () => boolean) {
    for (let attempt = 0; ; attempt++) {
      try {
        const outcome = await saveLink(
          r.url,
          r.kind as LinkKind,
          job.groupId,
          deps,
          undefined,
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
