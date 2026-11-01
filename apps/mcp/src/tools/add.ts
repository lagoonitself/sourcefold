import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { detectLinkKind } from "@sourcefold/core";
import { extractUrls, formatWait } from "@sourcefold/core/capture";
import { z } from "zod";
import { createNodeSourceFetch, createPublicFetch } from "../links/public-fetch";
import {
  classifyLink,
  isCloudRefusal,
  listCollection,
  saveLink,
  type LinkDeps,
  type LinkKind,
} from "../links/save-link";
import type { Folder, LinkQueueRow } from "../types";
import {
  ADD_JOBS_FILE,
  AddJobs,
  fileJobStore,
  inMemoryJobStore,
  isRowDone,
  memoryJobStore,
  type AddJob,
  type AddJobStore,
  type JobRow,
  type Pacing,
} from "./add-jobs";
import { defineTool, type ToolContext } from "./define";
import { scheduleDriveSave } from "./drive-autosave";
import { indexFolders, messageOf, plural } from "./format";

export {
  ADD_JOBS_FILE,
  AddJobs,
  fileJobStore,
  inMemoryJobStore,
  isRowDone,
  memoryJobStore,
  type AddJob,
  type AddJobStore,
  type JobRow,
  type Pacing,
};

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .optional();
/** Claude Desktop cuts a tool call off after about a minute. */
const MAX_WAIT_SECONDS = 50;
const ROWS_SHOWN = 60;
// Vercel stops the function at 60 s. Saving gets 35 s from the start of the call (finding the
// group included); writing the waiting links gets at most 15 s after that.
const REMOTE_BUDGET_MS = 35_000;
const REMOTE_LINK_TIMEOUT_MS = 12_000;
const REMOTE_QUEUE_TIMEOUT_MS = 15_000;
/** Links taken per call: one queue write (the route accepts 200). */
const REMOTE_MAX_LINKS = 200;

const STATUS_LABEL: Record<JobRow["status"], string> = {
  waiting: "waiting",
  finding: "finding videos or posts",
  saving: "saving",
  saved: "saved",
  duplicate: "already saved",
  unavailable: "not saved",
  paid: "paid, not saved",
  paused: "paused",
  queued: "waiting for your computer",
  failed: "failed",
  skipped: "skipped",
};

function rowLine(r: JobRow, now: number): string {
  const name = r.title ? `${r.title} — ${r.url}` : r.url;
  let message = r.message;
  if (r.status === "paused" && r.resumeAt) {
    const seconds = Math.max(1, Math.ceil((r.resumeAt - now) / 1000));
    message = `${r.message ?? "Paused."} Trying again in ${formatWait(seconds)}.`;
  }
  const id = r.itemId ? ` [${r.itemId}]` : "";
  const label =
    r.status === "queued" && r.kind === "x" ? "waiting for Chrome" : STATUS_LABEL[r.status];
  return `- ${label}${id}: ${name}${message ? ` (${message})` : ""}`;
}

export function formatJob(
  job: AddJob,
  now = Date.now(),
  ahead?: AddJob[] | { jobs: number; links: number },
): string {
  const count = (status: JobRow["status"]) => job.rows.filter((r) => r.status === status).length;
  const done = job.rows.filter(isRowDone).length;
  const lines: string[] = [];

  const parts = [
    `${count("saved")} saved`,
    count("duplicate") && `${count("duplicate")} already saved`,
    count("unavailable") && `${count("unavailable")} not saved (no captions or similar)`,
    count("paid") && `${count("paid")} paid`,
    job.rows.filter((r) => r.status === "queued" && r.kind !== "x").length &&
      `${job.rows.filter((r) => r.status === "queued" && r.kind !== "x").length} waiting for your computer`,
    job.rows.filter((r) => r.status === "queued" && r.kind === "x").length &&
      `${job.rows.filter((r) => r.status === "queued" && r.kind === "x").length} waiting for Chrome`,
    count("failed") && `${count("failed")} failed`,
    count("skipped") && `${count("skipped")} skipped`,
  ].filter(Boolean);
  lines.push(
    `Adding to ${job.groupPath} [${job.groupId}], job ${job.id}: ${done} of ${plural(job.rows.length, "link")} done (${parts.join(", ")}).`,
  );

  if (count("paid") > 0) {
    lines.push(
      "Paid posts need the user's Substack cookie: in the Sourcefold desktop app, Settings → Substack. Then add those links again.",
    );
  }

  if (job.state === "running" || job.state === "queued") {
    if (job.state === "queued") {
      if (ahead) {
        if (Array.isArray(ahead)) {
          const count = ahead.length;
          const links = ahead.reduce(
            (sum, j) => sum + j.rows.filter((r) => !isRowDone(r)).length,
            0,
          );
          lines.push(
            `Waiting behind ${plural(count, "earlier add job")} with ${plural(links, "link")} still to save.`,
          );
        } else {
          lines.push(
            `Waiting behind ${plural(ahead.jobs, "earlier add job")} with ${plural(ahead.links, "link")} still to save.`,
          );
        }
      } else {
        lines.push("Waiting for an earlier add job to finish.");
      }
    } else {
      lines.push("Still running in the background. YouTube videos are saved a few seconds apart.");
    }
    lines.push(`Check again with get_add_progress { "job_id": "${job.id}" }.`);
  } else if (job.state === "stopped") {
    lines.push("Stopped. Links still waiting were not saved; add them again to continue.");
  } else {
    lines.push("Finished.");
  }

  // Everything that isn't plain waiting, newest activity last; waiting rows only as a count.
  const active = job.rows.filter((r) => r.status !== "waiting");
  const waiting = job.rows.filter((r) => r.status === "waiting");
  const shown = active.slice(-ROWS_SHOWN);
  if (active.length > shown.length)
    lines.push(`(${active.length - shown.length} earlier rows not shown)`);
  lines.push("", ...shown.map((r) => rowLine(r, now)));
  if (waiting.length > 0) {
    const preview = waiting.slice(0, 5).map((r) => rowLine(r, now));
    lines.push(...preview);
    if (waiting.length > preview.length)
      lines.push(`- … and ${waiting.length - preview.length} more waiting`);
  }
  return lines.join("\n").trim();
}

function linkDepsFactory(ctx: ToolContext): () => Promise<LinkDeps> {
  return async () => ({
    api: ctx.api,
    desktop: ctx.desktop,
    addedBy: ctx.addedBy ?? "Claude",
    sourceFetch: createNodeSourceFetch(),
    publicFetch: createPublicFetch(),
    desktopOpen: (await ctx.desktop.status()) !== null,
    deferUnavailable: ctx.mode === "remote",
  });
}

async function resolveGroup(
  ctx: ToolContext,
  groupId: string,
  timeoutMs?: number,
): Promise<{ id: string; path: string }> {
  const folders = await ctx.api.get<Folder[]>("/folders", {
    query: { includeArchived: true },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const index = indexFolders(folders);
  const group = index.byId.get(groupId.trim());
  if (!group)
    throw new Error(`No group with id ${groupId}. Use get_project_tree to find group ids.`);
  if (!group.parent_id) {
    throw new Error(
      `${group.name} is a project. Sources live in groups: pick a group inside it, or make one with create_group.`,
    );
  }
  return { id: group.id, path: index.pathOf(group.id) };
}

interface RemoteResult {
  url: string;
  status: "saved" | "duplicate" | "unavailable" | "failed" | "waiting";
  title?: string;
  itemId?: string;
  message?: string;
  needs?: "desktop" | "browser";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(
        `The link took longer than ${Math.ceil(timeoutMs / 1000)} seconds to answer.`,
      );
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function queueReason(reason: string): string {
  return reason.length > 950 ? `${reason.slice(0, 947)}...` : reason;
}

interface QueuedLink {
  url: string;
  kind: string | null;
  needs: "desktop" | "browser";
  message: string;
  result: RemoteResult;
}

// Links to queue during one add_links call, written together at the end in one request.
const queueBatches = new WeakMap<ToolContext, QueuedLink[]>();

async function queueRemoteLink(
  ctx: ToolContext,
  _groupId: string,
  url: string,
  kind: string | null,
  needs: "desktop" | "browser",
  message: string,
): Promise<RemoteResult> {
  const batch = queueBatches.get(ctx);
  if (!batch) throw new Error("Remote links are queued inside add_links only.");
  const result: RemoteResult = { url, status: "waiting", needs, message };
  batch.push({ url, kind, needs, message, result });
  return result;
}

async function flushRemoteQueue(
  ctx: ToolContext,
  groupId: string,
  batch: QueuedLink[],
): Promise<void> {
  if (batch.length === 0) return;
  const fail = (message: string) => {
    for (const link of batch) {
      link.result.status = "failed";
      link.result.message = message;
      delete link.result.needs;
    }
  };
  try {
    await ctx.api.post<LinkQueueRow[]>(
      "/link-queue",
      {
        folder_id: groupId,
        added_by: (ctx.addedBy ?? "Claude").trim().slice(0, 100) || "Claude",
        links: batch.map((link) => ({
          url: link.url,
          kind: link.kind,
          needs: link.needs,
          message: queueReason(link.message),
        })),
      },
      { timeoutMs: REMOTE_QUEUE_TIMEOUT_MS },
    );
  } catch (err) {
    fail(`Could not queue this link: ${messageOf(err)}`);
  }
}

function desktopQueueMessage(reason: string): string {
  return `The cloud could not fetch this link: ${reason}. Waiting for the Sourcefold desktop app.`;
}

async function saveRemoteCloudLink(
  ctx: ToolContext,
  deps: LinkDeps,
  groupId: string,
  url: string,
  kind: LinkKind,
  deadline: number,
  allowDuplicates: boolean,
): Promise<RemoteResult> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    return queueRemoteLink(
      ctx,
      groupId,
      url,
      kind,
      "desktop",
      desktopQueueMessage("the cloud save time budget ran out"),
    );
  }

  const timeoutMs = Math.min(REMOTE_LINK_TIMEOUT_MS, remainingMs);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const outcome = await withTimeout(
      saveLink(url, kind, groupId, deps, signal, allowDuplicates, timeoutMs),
      timeoutMs,
    );
    if (outcome.status === "paid") {
      return queueRemoteLink(
        ctx,
        groupId,
        url,
        kind,
        "desktop",
        "This Substack post is paid and needs the Sourcefold desktop app with your Substack cookie.",
      );
    }
    return {
      url,
      status: outcome.status,
      ...(outcome.title ? { title: outcome.title } : {}),
      ...(outcome.status === "saved" ? { itemId: outcome.itemId } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
    };
  } catch (err) {
    const reason = messageOf(err);
    if (isCloudRefusal(err)) {
      return queueRemoteLink(ctx, groupId, url, kind, "desktop", desktopQueueMessage(reason));
    }
    return { url, status: "failed", message: reason };
  }
}

function directQueueTarget(url: string, kind: LinkKind | null) {
  if (kind === "x") {
    return {
      needs: "browser" as const,
      message: "X posts need Chrome with the Sourcefold extension.",
    };
  }
  if (kind === "youtube_list" || detectLinkKind(url) === "youtube") {
    return {
      needs: "desktop" as const,
      message: "YouTube blocks cloud servers; waiting for the Sourcefold desktop app.",
    };
  }
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // Invalid URLs are rejected by classifyLink before this helper is reached.
  }
  if (
    detectLinkKind(url) === "reddit" ||
    hostname === "reddit.com" ||
    hostname.endsWith(".reddit.com") ||
    hostname === "redd.it" ||
    hostname.endsWith(".redd.it")
  ) {
    return {
      needs: "desktop" as const,
      message: "Reddit often refuses cloud servers; waiting for the Sourcefold desktop app.",
    };
  }
  return null;
}

function formatRemoteResults(group: { id: string; path: string }, results: RemoteResult[]): string {
  const count = (status: RemoteResult["status"]) =>
    results.filter((row) => row.status === status).length;
  const waiting = results.filter((row) => row.status === "waiting");
  const summary = [
    `${count("saved")} saved`,
    `${count("duplicate")} already saved`,
    `${count("unavailable")} unavailable`,
    `${count("failed")} failed`,
    `${waiting.length} waiting`,
  ];
  const lines = [`Adding to ${group.path} [${group.id}]: ${summary.join(", ")}.`];
  for (const result of results) {
    const title = result.title ? `${result.title} — ${result.url}` : result.url;
    const state =
      result.status === "waiting"
        ? result.needs === "browser"
          ? "waiting for Chrome"
          : "waiting for your computer"
        : result.status === "duplicate"
          ? "already saved"
          : result.status === "unavailable"
            ? "not saved"
            : result.status;
    const id = result.itemId ? ` [${result.itemId}]` : "";
    lines.push(`- ${state}${id}: ${title}${result.message ? ` (${result.message})` : ""}`);
  }
  if (waiting.length > 0) {
    lines.push(
      `${waiting.length} links are waiting for your computer. They'll be saved the next time the Sourcefold desktop app is open (X posts also need Chrome with the Sourcefold extension). Check with get_add_progress.`,
    );
  } else {
    lines.push("Finished.");
  }
  return lines.join("\n");
}

async function addLinksRemote(
  args: {
    group_id: string;
    links: string[];
    allow_duplicates?: boolean;
    limit_per_collection?: number;
    published_after?: string;
    published_before?: string;
  },
  ctx: ToolContext,
): Promise<string> {
  const deadline = Date.now() + REMOTE_BUDGET_MS;
  const found = [...new Set(extractUrls(args.links.join("\n")))];
  if (found.length === 0) {
    throw new Error("No links found. Pass full addresses starting with https://.");
  }
  const urls = found.slice(0, REMOTE_MAX_LINKS);
  const left = found.length - urls.length;
  const batch: QueuedLink[] = [];
  ctx = { ...ctx };
  queueBatches.set(ctx, batch);
  const group = await resolveGroup(ctx, args.group_id, Math.min(10_000, REMOTE_BUDGET_MS));
  const deps = await linkDepsFactory(ctx)();
  deps.deferUnavailable = true;
  deps.addedBy = ctx.addedBy ?? "Claude";
  const results: RemoteResult[] = [];

  for (const url of urls) {
    const kind = classifyLink(url);
    if (!kind) {
      results.push({ url, status: "failed", message: "Sourcefold can't save this kind of link." });
      continue;
    }

    const direct = directQueueTarget(url, kind);
    if (direct) {
      results.push(await queueRemoteLink(ctx, group.id, url, kind, direct.needs, direct.message));
      continue;
    }

    if (kind === "publication") {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        results.push(
          await queueRemoteLink(
            ctx,
            group.id,
            url,
            kind,
            "desktop",
            desktopQueueMessage("the cloud save time budget ran out"),
          ),
        );
        continue;
      }
      const timeoutMs = Math.min(REMOTE_LINK_TIMEOUT_MS, remaining);
      try {
        const list = await withTimeout(
          listCollection(
            url,
            "publication",
            {
              limit: args.limit_per_collection ?? 50,
              publishedAfter: args.published_after ?? null,
              publishedBefore: args.published_before ?? null,
              signal: AbortSignal.timeout(timeoutMs),
            },
            deps,
          ),
          timeoutMs,
        );
        if (list.links.length === 0) {
          results.push({
            url,
            status: "failed",
            message:
              args.published_after || args.published_before
                ? "No Substack posts in that date range."
                : "No Substack posts found.",
          });
          continue;
        }
        for (const link of list.links) {
          results.push(
            await saveRemoteCloudLink(
              ctx,
              deps,
              group.id,
              link.url,
              "substack",
              deadline,
              args.allow_duplicates ?? false,
            ),
          );
        }
      } catch (err) {
        if (isCloudRefusal(err)) {
          results.push(
            await queueRemoteLink(
              ctx,
              group.id,
              url,
              kind,
              "desktop",
              desktopQueueMessage(messageOf(err)),
            ),
          );
        } else {
          results.push({ url, status: "failed", message: messageOf(err) });
        }
      }
      continue;
    }

    results.push(
      await saveRemoteCloudLink(
        ctx,
        deps,
        group.id,
        url,
        kind,
        deadline,
        args.allow_duplicates ?? false,
      ),
    );
  }

  // A publication can list more posts than one queue write takes; the rest are left for later.
  const overflow = batch.splice(REMOTE_MAX_LINKS);
  for (const link of overflow) {
    link.result.status = "failed";
    link.result.message = `Not queued: one call queues at most ${REMOTE_MAX_LINKS} links. Add it again.`;
    delete link.result.needs;
  }
  await flushRemoteQueue(ctx, group.id, batch);
  const reply = formatRemoteResults(group, results);
  return left > 0
    ? `${reply}\nOnly the first ${REMOTE_MAX_LINKS} links were taken; ${left} more were left out. Call add_links again with the rest.`
    : reply;
}

function formatQueueRows(rows: LinkQueueRow[]): string {
  if (rows.length === 0) return "No links are waiting for your computer.";
  return rows
    .map((row) => {
      const title = row.title ? `${row.title} — ${row.url}` : row.url;
      const state =
        row.status === "waiting"
          ? row.needs === "browser"
            ? "waiting for Chrome"
            : "waiting for your computer"
          : row.status === "working"
            ? row.needs === "browser"
              ? "Chrome is saving"
              : "your computer is saving"
            : row.status === "saved"
              ? "saved"
              : row.status === "duplicate"
                ? "already saved"
                : row.status;
      const id = row.item_id ? ` [${row.item_id}]` : "";
      return `- ${state}${id}: ${title}${row.message ? ` (${row.message})` : ""} — added by ${row.added_by}`;
    })
    .join("\n");
}

async function remoteAddProgress(
  args: { ids?: string[]; group_id?: string; recent?: boolean },
  ctx: ToolContext,
): Promise<string> {
  const rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
    query: {
      status: args.recent ? "recent" : "open",
      ids: args.ids?.join(","),
      folder_id: args.group_id,
      limit: 500,
    },
  });
  return formatQueueRows(rows);
}

async function cancelWaitingLinks(
  args: { ids?: string[]; group_id?: string },
  ctx: ToolContext,
): Promise<string> {
  let rows: LinkQueueRow[];
  let cancelled = 0;
  if (args.ids) {
    rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
      query: { ids: args.ids.join(","), limit: 500 },
    });
    cancelled += await cancelRows(ctx, rows);
  } else {
    while (true) {
      rows = await ctx.api.get<LinkQueueRow[]>("/link-queue", {
        query: { status: "open", folder_id: args.group_id, limit: 500 },
      });
      if (rows.length === 0) break;
      const changed = await cancelRows(ctx, rows);
      cancelled += changed;
      if (changed === 0) break;
    }
  }
  return `${cancelled} ${plural(cancelled, "waiting link")} cancelled.`;
}

async function cancelRows(ctx: ToolContext, rows: LinkQueueRow[]): Promise<number> {
  let cancelled = 0;
  for (const row of rows) {
    if (row.status !== "waiting" && row.status !== "working") continue;
    const result = await ctx.api.delete<LinkQueueRow>(`/link-queue/${encodeURIComponent(row.id)}`);
    if (result.status === "cancelled") cancelled++;
  }
  return cancelled;
}

export function registerAddTools(
  server: McpServer,
  ctx: ToolContext,
  pacing?: Pacing,
  store?: AddJobStore,
  onJobFinished?: (job: AddJob) => void,
): AddJobs {
  const jobStore = store ?? memoryJobStore();
  const finishedCallback = onJobFinished ?? (store ? () => scheduleDriveSave(ctx.api) : undefined);
  const jobs = new AddJobs(linkDepsFactory(ctx), pacing, jobStore, finishedCallback);
  jobs.restore();

  defineTool(server, ctx, {
    name: "add_links",
    title: "Add links",
    description: `Saves links into a group, like pasting them into Sourcefold's Add links. Works for Grokipedia and Wikipedia articles, YouTube videos (their transcript), web pages, PDFs and arXiv papers, Reddit and Hacker News threads, Bluesky posts and Substack posts. A YouTube playlist or channel, or a Substack publication, is expanded into its videos or posts (up to limit_per_collection each; Substack can be narrowed by date).\n\nIn the web connector, links the cloud can't fetch wait for the desktop app, and X posts wait for Chrome with the Sourcefold extension. Check with get_add_progress. In Claude Desktop, saving runs in the background, one link after another; YouTube videos are spaced a few seconds apart and wait when YouTube pushes back. Links already saved in the group are reported, not saved twice. Use list_collection first to look at a playlist or publication without saving.`,
    input: {
      group_id: z.string().describe("The group to save into (not a project)."),
      links: z
        .array(z.string())
        .min(1)
        .max(500)
        .describe("The links. Each entry may also be text containing several links."),
      allow_duplicates: z
        .boolean()
        .default(false)
        .describe(
          "Only allows saving a second copy in a different group of the same project. Same-group duplicates are still refused. Default false.",
        ),
      limit_per_collection: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe(
          "Most videos or posts to take from each playlist, channel or publication. Default 50.",
        ),
      published_after: DATE.describe(
        "Substack publications only: save only posts published after this day (YYYY-MM-DD).",
      ),
      published_before: DATE.describe(
        "Substack publications only: save only posts published before this day (YYYY-MM-DD).",
      ),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_SECONDS)
        .optional()
        .describe(
          `How long to wait for the job before answering. Default 25, at most ${MAX_WAIT_SECONDS}.`,
        ),
    },
    openWorld: true,
    run: async (args) => {
      if (ctx.mode === "remote") return addLinksRemote(args, ctx);
      const urls = [...new Set(extractUrls(args.links.join("\n")))];
      if (urls.length === 0)
        throw new Error("No links found. Pass full addresses starting with https://.");
      const group = await resolveGroup(ctx, args.group_id);
      const job = jobs.start(
        group.id,
        group.path,
        urls.map((url) => ({ url, kind: classifyLink(url) })),
        {
          limitPerCollection: args.limit_per_collection ?? 50,
          publishedAfter: args.published_after ?? null,
          publishedBefore: args.published_before ?? null,
          allowDuplicates: args.allow_duplicates ?? false,
        },
      );
      await jobs.waitForEnd(job, (args.wait_seconds ?? 25) * 1000);
      return formatJob(job, Date.now(), jobs.ahead(job));
    },
  });

  defineTool(server, ctx, {
    name: "get_add_progress",
    title: "Add progress",
    description:
      "In Claude Desktop, checks an add_links job by job_id, can wait for it, or stop it after the current link. In the web connector, lists links waiting for or being saved by the desktop app or Chrome; by default it shows open rows. Pass recent=true for rows finished in the last seven days, ids for specific rows, or group_id to filter.",
    input: {
      job_id: z.string().optional().describe("The job id add_links answered with."),
      ids: z
        .array(z.string().uuid())
        .min(1)
        .max(200)
        .optional()
        .describe("Remote connector only: show these link queue rows, in any state."),
      group_id: z
        .string()
        .uuid()
        .optional()
        .describe("Remote connector only: show queue rows in this group."),
      recent: z
        .boolean()
        .optional()
        .describe("Remote connector only: include rows finished in the last seven days."),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_SECONDS)
        .optional()
        .describe(
          `How long to wait for the job to finish before answering. Default 20, at most ${MAX_WAIT_SECONDS}.`,
        ),
      stop: z.boolean().optional().describe("Stop the job. Links still waiting are not saved."),
    },
    // Saving happens in the background; checking on it only reads.
    readOnly: true,
    run: async (args) => {
      if (ctx.mode === "remote") return remoteAddProgress(args, ctx);
      if (!args.job_id) {
        const recent = jobs.list();
        if (recent.length === 0) return "No add jobs.";
        return recent
          .map((job) => {
            const done = job.rows.filter(isRowDone).length;
            return `- job ${job.id}: ${job.state}, ${done} of ${plural(job.rows.length, "link")} done, into ${job.groupPath}`;
          })
          .join("\n");
      }
      const job = jobs.get(args.job_id);
      if (!job) {
        throw new Error(
          `No add job ${args.job_id}. Only the last 20 jobs are kept; call get_add_progress without a job_id to list them.`,
        );
      }
      if (args.stop) {
        jobs.stop(job.id);
        await jobs.waitForEnd(job, 5_000);
      } else {
        await jobs.waitForEnd(job, (args.wait_seconds ?? 20) * 1000);
      }
      return formatJob(job, Date.now(), jobs.ahead(job));
    },
  });

  defineTool(server, ctx, {
    name: "cancel_waiting_links",
    title: "Cancel waiting links",
    description:
      "Cancels open link queue rows that have not finished saving. Pass ids to cancel specific links, or group_id to cancel every open link in that group.",
    input: {
      ids: z.array(z.string().uuid()).min(1).max(200).optional(),
      group_id: z.string().uuid().optional(),
    },
    syncDrive: false,
    run: async (args) => {
      if (Boolean(args.ids) === Boolean(args.group_id)) {
        throw new Error("Give either ids or group_id.");
      }
      return cancelWaitingLinks(args, ctx);
    },
  });

  defineTool(server, ctx, {
    name: "list_collection",
    title: "List a playlist, channel or publication",
    description:
      "Lists the videos of a YouTube playlist or channel (newest first for channels) or the posts of a Substack publication (with date and paid/free), without saving anything. Use it to pick what to pass to add_links.",
    input: {
      url: z
        .string()
        .describe("A YouTube playlist or channel link, or a Substack publication address."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Most entries to list. Default 50."),
      published_after: DATE.describe("Substack only: posts published after this day (YYYY-MM-DD)."),
      published_before: DATE.describe(
        "Substack only: posts published before this day (YYYY-MM-DD).",
      ),
    },
    readOnly: true,
    openWorld: true,
    run: async (args) => {
      const kind = classifyLink(args.url.trim());
      if (kind !== "youtube_list" && kind !== "publication") {
        throw new Error(
          "That isn't a YouTube playlist or channel, or a Substack publication. For single links use add_links.",
        );
      }
      const list = await listCollection(
        args.url.trim(),
        kind,
        {
          limit: args.limit ?? 50,
          publishedAfter: args.published_after ?? null,
          publishedBefore: args.published_before ?? null,
        },
        await linkDepsFactory(ctx)(),
      );
      if (list.links.length === 0)
        return kind === "publication" ? "No posts found." : "No videos found.";
      const what = kind === "publication" ? "post" : "video";
      const head = `${list.title ? `${list.title}: ` : ""}${plural(list.links.length, what)}${list.truncated ? ` (more exist; raise limit to see them)` : ""}.`;
      return [
        head,
        "",
        ...list.links.map(
          (l, i) =>
            `${i + 1}. ${l.title ?? "(untitled)"}${l.detail ? ` · ${l.detail}` : ""} — ${l.url}`,
        ),
      ].join("\n");
    },
  });

  return jobs;
}
